# GutMap — Migration Plan v3 (Corrected)
## Claude Code Brief — Real Data + High-Dimensional Embedding

---

## Critical Context: What's Already Built

This is a **Next.js 14 app** (TypeScript). There is no FastAPI. All backend logic lives in Next.js API routes. Do not introduce a Python server at runtime.

### Current file structure that matters:
```
src/
  app/
    api/
      chat/route.ts        ← hardcoded 3-step flow, NO Claude API yet
      flares/route.ts      ← generates fake gaussian positions, NO UMAP
      session/new/route.ts ← just returns UUID, keep as-is
  components/
    ChatPanel.tsx          ← DO NOT CHANGE
    ChatMessage.tsx        ← DO NOT CHANGE
    FlareGraph.tsx         ← DO NOT CHANGE
    FlareGraphInner.tsx    ← REMOVE sector force only, keep everything else
    PhenotypeCard.tsx      ← DO NOT CHANGE
    ProbabilityBar.tsx     ← DO NOT CHANGE
  hooks/
    useFlarePolling.ts     ← DO NOT CHANGE
  lib/
    api.ts                 ← DO NOT CHANGE
    constants.ts           ← DO NOT CHANGE
    types.ts               ← ADD novel_factors and summary fields only
```

---

## Architecture: Offline Preprocessing + Static JSON

All ML work (Reddit scraping, Claude extraction, OpenAI embeddings, HDBSCAN, UMAP) runs **once** in a Python script before the app starts. Output is a static JSON file that Next.js serves directly. No Python process runs alongside Next.js at demo time.

```
python preprocess.py
        ↓
  public/flares_processed.json    ← UMAP coords + cluster labels baked in
        ↓
  Next.js /api/flares serves it
        ↓
  react-force-graph-3d renders it
```

This means zero ML dependencies in Next.js, zero runtime risk, and a fast server restart if needed during the demo.

---

## Step 1: Python Preprocessing Script

Create `preprocess.py` in the project root. This is the only Python file. Run it once before the demo.

```python
# preprocess.py
# Run: python preprocess.py
# Output: public/flares_processed.json
# Requirements: pip install anthropic openai hdbscan umap-learn numpy requests

import os, json, time, pickle, requests
import numpy as np
import hdbscan
import umap
import anthropic
from openai import OpenAI

anthropic_client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
openai_client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

CLUSTER_COLORS = {0: "#FF6B6B", 1: "#4ECDC4", 2: "#FFE66D", -1: "#888888"}

# ── CACHE HELPERS ──────────────────────────────────────────────────────────────

def load_cache(path):
    if os.path.exists(path):
        print(f"Loading cache: {path}")
        with open(path) as f:
            return json.load(f)
    return None

def save_cache(data, path):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f)
    print(f"Saved cache: {path}")

def load_np_cache(path):
    return np.load(path) if os.path.exists(path) else None

def save_np_cache(arr, path):
    np.save(path, arr)
    print(f"Saved numpy cache: {path}")

# ── STEP 1: SYNTHETIC SEED DATA ────────────────────────────────────────────────

def generate_seed_flares():
    import random
    seed_flares = []

    phenotype_configs = [
        {
            "phenotype": "A",
            "known_triggers": {"caffeine_before_food": True, "sleep_hours": None,
                               "stress_level": None, "fodmap_load": 0.1,
                               "alcohol": False, "meal_skipped": False,
                               "anxiety_level": None, "travel": False},
            "symptoms": ["urgency", "bloating"],
            "narrative_templates": [
                "Had coffee before breakfast, only slept {sleep}hrs, bad urgency and bloating all morning",
                "Skipped breakfast, had espresso, then got hit with bloating and urgency",
                "Poor sleep last night maybe {sleep}hrs, caffeine first thing, GI was terrible",
            ]
        },
        {
            "phenotype": "B",
            "known_triggers": {"caffeine_before_food": False, "sleep_hours": None,
                               "stress_level": None, "fodmap_load": 0.85,
                               "alcohol": False, "meal_skipped": False,
                               "anxiety_level": None, "travel": False},
            "symptoms": ["bloating", "cramping", "gas"],
            "narrative_templates": [
                "Ate {food} for dinner, woke up with terrible bloating and cramps",
                "Had {food} at a restaurant, cramping and distension started about 2hrs later",
                "Big portion of {food}, couldn't leave the house next morning because of cramping",
            ]
        },
        {
            "phenotype": "C",
            "known_triggers": {"caffeine_before_food": False, "sleep_hours": None,
                               "stress_level": None, "fodmap_load": 0.2,
                               "alcohol": False, "meal_skipped": True,
                               "anxiety_level": None, "travel": False},
            "symptoms": ["pain", "diarrhea", "nausea"],
            "narrative_templates": [
                "Super stressful day at work, skipped lunch, stomach pain and diarrhea by evening",
                "Anxiety was high all day, forgot to eat until 3pm, gut was a mess",
                "Presentation at work, stress through the roof, irregular meals, bad flare",
            ]
        }
    ]

    FODMAP_FOODS = ["pasta with garlic", "onion soup", "wheat bread", "garlic naan"]

    for config in phenotype_configs:
        for i in range(16):
            sleep = round(random.uniform(3.5, 6.5), 1) if config["phenotype"] in ("A", "C") else round(random.uniform(5, 8), 1)
            stress = round(random.uniform(3, 5), 1) if config["phenotype"] == "C" else round(random.uniform(1, 3), 1)
            anxiety = round(random.uniform(3, 5), 1) if config["phenotype"] == "C" else round(random.uniform(1, 2.5), 1)

            template = random.choice(config["narrative_templates"])
            narrative = template.format(
                sleep=sleep,
                food=random.choice(FODMAP_FOODS)
            )

            triggers = dict(config["known_triggers"])
            triggers["sleep_hours"] = sleep
            triggers["stress_level"] = stress
            triggers["anxiety_level"] = anxiety

            seed_flares.append({
                "id": f"seed-{config['phenotype']}-{i}",
                "narrative": narrative,
                "synthetic": True,
                "phenotype_label": config["phenotype"],
                "extracted": {
                    "symptoms": config["symptoms"],
                    "known_triggers": triggers,
                    "dietary_details": [],
                    "physiological_details": [],
                    "psychological_details": [],
                    "behavioral_details": [],
                    "novel_factors": [],
                    "open_narrative_summary": narrative
                }
            })

    return seed_flares

# ── STEP 2: REDDIT SCRAPING ────────────────────────────────────────────────────

def scrape_reddit(total=150, cache_path="cache/reddit_raw.json"):
    cached = load_cache(cache_path)
    if cached:
        return cached

    HEADERS = {"User-Agent": "gutmap-ibs-research/1.0"}
    QUERIES = [
        "flare up food trigger ate",
        "bad IBS attack what caused",
        "flare stress sleep symptoms",
        "what triggered my IBS",
        "IBS flare after eating"
    ]

    posts = []
    seen = set()

    for query in QUERIES:
        try:
            r = requests.get(
                "https://www.reddit.com/r/ibs/search.json",
                params={"q": query, "sort": "relevance", "limit": 50, "t": "year"},
                headers=HEADERS,
                timeout=10
            )
            for post in r.json()["data"]["children"]:
                p = post["data"]
                if p["id"] in seen:
                    continue
                seen.add(p["id"])
                narrative = f"{p.get('title', '')} {p.get('selftext', '')}".strip()
                if len(narrative) < 60:
                    continue
                posts.append({
                    "id": f"reddit-{p['id']}",
                    "narrative": narrative[:1200],  # cap length for embedding cost
                    "synthetic": False,
                    "source": "reddit_r_ibs"
                })
        except Exception as e:
            print(f"Reddit scrape failed for '{query}': {e}")
        time.sleep(1.2)

        if len(posts) >= total:
            break

    save_cache(posts[:total], cache_path)
    return posts[:total]

# ── STEP 3: CLAUDE EXTRACTION ──────────────────────────────────────────────────

EXTRACTION_PROMPT = """You are analyzing an IBS patient's flare-up account.
Extract ALL relevant factors. Be exhaustive. For unknown fields use null.
Return ONLY valid JSON, no markdown, no preamble.

{
  "symptoms": [],
  "known_triggers": {
    "fodmap_load": null,
    "fat_content": null,
    "alcohol": null,
    "carbonated": null,
    "meal_size": null,
    "eating_speed": null,
    "sleep_hours": null,
    "sleep_quality": null,
    "stress_level": null,
    "anxiety_level": null,
    "recent_antibiotics": null,
    "exercise_today": null,
    "caffeine_before_food": null,
    "meal_skipped": null,
    "travel": null,
    "disrupted_routine": null
  },
  "dietary_details": [],
  "physiological_details": [],
  "psychological_details": [],
  "behavioral_details": [],
  "novel_factors": [],
  "open_narrative_summary": "1-2 sentence plain English summary of context"
}

Post:
"""

def extract_flares(posts, cache_path="cache/extracted.json"):
    cached = load_cache(cache_path)
    if cached:
        return cached

    extracted = []
    for i, post in enumerate(posts):
        print(f"Extracting {i+1}/{len(posts)}: {post['id']}")
        try:
            resp = anthropic_client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1000,
                messages=[{"role": "user", "content": EXTRACTION_PROMPT + post["narrative"]}]
            )
            text = resp.content[0].text.strip().replace("```json", "").replace("```", "").strip()
            factors = json.loads(text)
            extracted.append({**post, "extracted": factors})
        except Exception as e:
            print(f"Extraction failed for {post['id']}: {e}")
        time.sleep(0.4)

    save_cache(extracted, cache_path)
    return extracted

# ── STEP 4: FEATURE VECTORS ────────────────────────────────────────────────────

FEATURE_MEANS = {
    "fodmap_load": 0.35, "fat_content": 0.4, "alcohol": 0.15,
    "carbonated": 0.2, "meal_size": 0.5, "eating_speed": 0.4,
    "sleep_hours": 0.65, "sleep_quality": 0.5, "stress_level": 0.4,
    "anxiety_level": 0.35, "recent_antibiotics": 0.05, "exercise_today": 0.3,
    "caffeine_before_food": 0.3, "meal_skipped": 0.25, "travel": 0.1,
    "disrupted_routine": 0.2
}
FEATURE_KEYS = list(FEATURE_MEANS.keys())

def normalize(key, val):
    if val is None:
        return FEATURE_MEANS[key]
    if isinstance(val, bool):
        return float(val)
    if key == "sleep_hours":
        return min(float(val), 10.0) / 10.0
    if key in ("stress_level", "anxiety_level"):
        return float(val) / 5.0
    return float(val)

def build_layer1(flare):
    kt = flare.get("extracted", {}).get("known_triggers", {})
    return np.array([normalize(k, kt.get(k)) for k in FEATURE_KEYS])

def embed_text(text):
    resp = openai_client.embeddings.create(
        model="text-embedding-3-small",
        input=text[:2000]
    )
    return np.array(resp.data[0].embedding)

def build_vectors(flares, cache_path="cache/vectors.npy"):
    cached = load_np_cache(cache_path)
    if cached is not None:
        return cached

    vecs = []
    for i, flare in enumerate(flares):
        print(f"Embedding {i+1}/{len(flares)}: {flare['id']}")
        ex = flare.get("extracted", {})

        layer1 = build_layer1(flare) * 3.0  # structured features — highest weight

        open_text = " ".join([
            *ex.get("dietary_details", []),
            *ex.get("physiological_details", []),
            *ex.get("psychological_details", []),
            *ex.get("behavioral_details", []),
            *ex.get("novel_factors", [])
        ]).strip()
        layer2 = embed_text(open_text) * 1.0 if open_text else np.zeros(1536)

        raw = flare.get("narrative", "") or ex.get("open_narrative_summary", "")
        layer3 = embed_text(raw) * 0.5 if raw else np.zeros(1536)

        vecs.append(np.concatenate([layer1, layer2, layer3]))
        time.sleep(0.1)  # light rate limiting

    matrix = np.array(vecs)
    save_np_cache(matrix, cache_path)
    return matrix

# ── STEP 5: CLUSTER + REDUCE ───────────────────────────────────────────────────

def fit_pipeline(matrix, pipeline_path="cache/pipeline.pkl"):
    if os.path.exists(pipeline_path):
        print("Loading cached pipeline...")
        with open(pipeline_path, "rb") as f:
            obj = pickle.load(f)
        reducer = obj["reducer"]
        clusterer = obj["clusterer"]
        coords = reducer.transform(matrix)
        labels = clusterer.labels_
        return reducer, clusterer, coords, labels

    print("Fitting UMAP...")
    reducer = umap.UMAP(
        n_components=3,
        n_neighbors=15,
        min_dist=0.1,
        metric="cosine",
        random_state=42
    ).fit(matrix)
    coords = reducer.transform(matrix)

    print("Fitting HDBSCAN...")
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=5,
        metric="euclidean",
        prediction_data=True
    ).fit(matrix)
    labels = clusterer.labels_

    with open(pipeline_path, "wb") as f:
        pickle.dump({"reducer": reducer, "clusterer": clusterer}, f)
    print(f"Pipeline cached. Discovered {len(set(labels)) - (1 if -1 in labels else 0)} clusters")

    return reducer, clusterer, coords, labels

# ── STEP 6: WRITE OUTPUT ───────────────────────────────────────────────────────

def write_output(flares, coords, labels, clusterer, output_path="public/flares_processed.json"):
    # Scale UMAP coords to graph-friendly range
    coords_scaled = coords.copy()
    for dim in range(3):
        r = coords_scaled[:, dim].max() - coords_scaled[:, dim].min()
        if r > 0:
            coords_scaled[:, dim] = (coords_scaled[:, dim] - coords_scaled[:, dim].min()) / r
            coords_scaled[:, dim] = (coords_scaled[:, dim] - 0.5) * 200  # spread across 200 units
    coords_scaled[:, 2] *= 0.15  # flatten Z so graph isn't too deep

    output = []
    for i, flare in enumerate(flares):
        ex = flare.get("extracted", {})
        symptoms = ex.get("symptoms", [])
        cluster_id = int(labels[i])
        confidence = float(clusterer.probabilities_[i]) if cluster_id != -1 else 0.0

        output.append({
            "id": flare["id"],
            "x": float(coords_scaled[i][0]),
            "y": float(coords_scaled[i][1]),
            "z": float(coords_scaled[i][2]),
            "clusterId": cluster_id,
            "color": CLUSTER_COLORS.get(cluster_id, "#888888"),
            "confidence": confidence,
            "synthetic": flare.get("synthetic", False),
            "symptoms": symptoms[:3],
            "label": " + ".join(symptoms[:2]) if symptoms else "flare",
            "summary": ex.get("open_narrative_summary", ""),
            "novel_factors": ex.get("novel_factors", [])
        })

    os.makedirs("public", exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(output, f)
    print(f"Written {len(output)} nodes to {output_path}")
    print(f"Cluster distribution: { {k: list(labels).count(k) for k in sorted(set(labels))} }")

# ── MAIN ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=== Step 1: Seed data ===")
    seed_flares = generate_seed_flares()
    print(f"Generated {len(seed_flares)} synthetic seed flares")

    print("\n=== Step 2: Reddit scraping ===")
    reddit_posts = scrape_reddit(total=150)
    print(f"Scraped {len(reddit_posts)} Reddit posts")

    print("\n=== Step 3: Claude extraction ===")
    extracted_reddit = extract_flares(reddit_posts)
    print(f"Extracted {len(extracted_reddit)} posts")

    all_flares = seed_flares + extracted_reddit
    print(f"\nTotal flares: {len(all_flares)} ({len(seed_flares)} synthetic + {len(extracted_reddit)} real)")

    print("\n=== Step 4: Building vectors ===")
    matrix = build_vectors(all_flares)
    print(f"Vector matrix shape: {matrix.shape}")

    print("\n=== Step 5: Clustering + UMAP ===")
    reducer, clusterer, coords, labels = fit_pipeline(matrix)

    print("\n=== Step 6: Writing output ===")
    write_output(all_flares, coords, labels, clusterer)

    print("\n✅ Done. Start the app with: npm run dev")
```

---

## Step 2: Update `/api/flares/route.ts`

Replace the entire file. Serve from the preprocessed JSON. Keep the POST handler for new flares added during a session.

```typescript
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Real flares added during live sessions
const sessionFlares: object[] = [];

export async function GET() {
  const filePath = path.join(process.cwd(), "public/flares_processed.json");
  
  if (!fs.existsSync(filePath)) {
    return NextResponse.json(
      { error: "Run python preprocess.py first" },
      { status: 503 }
    );
  }

  const base = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return NextResponse.json([...base, ...sessionFlares]);
}

export async function POST(request: Request) {
  const body = await request.json();
  sessionFlares.push(body);
  return NextResponse.json({ ok: true });
}
```

---

## Step 3: Update `/api/chat/route.ts`

Replace the hardcoded QUESTIONS array with real Claude API calls. Keep the session state machine structure.

```typescript
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import crypto from "crypto";

const client = new Anthropic();

type ConversationState = "SYMPTOM_INTAKE" | "QUESTIONING" | "CONVERGED";

interface Session {
  state: ConversationState;
  symptoms: string[];
  context: Record<string, unknown>;
  phenotype_probs: Record<string, number>;
  questions_asked: string[];
  history: Array<{ role: "user" | "assistant"; content: string }>;
}

const sessions = new Map<string, Session>();

const PHENOTYPE_DEFINITIONS = `
PHENOTYPE A — Caffeine/Sleep-Sensitive IBS
  Key discriminators: caffeine_before_food=true, sleep_hours<6
  Symptoms: urgency, bloating
  Scientific basis: caffeine stimulates colonic motility; sleep deprivation elevates cortisol

PHENOTYPE B — FODMAP-Sensitive IBS  
  Key discriminators: high fodmap foods (onion, garlic, wheat, lactose, fructose)
  Symptoms: bloating, cramping, gas, distension
  Scientific basis: Monash University FODMAP research, fermentation by gut bacteria

PHENOTYPE C — Stress/Gut-Brain IBS
  Key discriminators: stress_level>3, meal_skipped=true, anxiety high
  Symptoms: pain, diarrhea, nausea
  Scientific basis: HPA axis — cortisol directly affects gut motility
`;

function buildSystemPrompt(session: Session): string {
  return `You are GutMap, an AI investigating IBS flare-up triggers using Bayesian hypothesis testing.

${PHENOTYPE_DEFINITIONS}

CURRENT SESSION STATE:
- Symptoms reported: ${session.symptoms.join(", ") || "none yet"}
- Context collected: ${JSON.stringify(session.context)}
- Phenotype probabilities: ${JSON.stringify(session.phenotype_probs)}
- Questions already asked: ${session.questions_asked.join("; ") || "none"}
- State: ${session.state}

RULES:
1. In SYMPTOM_INTAKE state: parse symptoms from the user's message, set initial phenotype probs, transition to QUESTIONING, ask the first discriminating question
2. In QUESTIONING state: ask ONE targeted yes/no question that best discriminates between the top 2 phenotype candidates. Never repeat a question already asked. Update probs mentally based on prior answers.
3. CONVERGE when top phenotype probability would exceed 0.70 after this round (max 4 questions)
4. Keep responses SHORT — 1-2 sentences max. This is a chat interface.
5. Be warm and conversational, not clinical.

RESPONSE FORMAT — respond with ONLY this JSON:
{
  "reply": "your message to the user",
  "state": "SYMPTOM_INTAKE | QUESTIONING | CONVERGED",
  "phenotype_probs": {"A": 0.0, "B": 0.0, "C": 0.0},
  "converged": false,
  "phenotype_match": null,
  "context_update": {},
  "question_field": "field name you just asked about or null"
}

If converged=true, phenotype_match must be:
{
  "label": "FODMAP-Sensitive IBS | Caffeine/Sleep-Sensitive IBS | Stress/Gut-Brain IBS",
  "confidence": 0.0,
  "triggers": [],
  "population_pct": 0.0
}`;
}

export async function POST(request: Request) {
  const { session_id, message } = await request.json();

  if (!sessions.has(session_id)) {
    sessions.set(session_id, {
      state: "SYMPTOM_INTAKE",
      symptoms: [],
      context: {},
      phenotype_probs: { A: 0.33, B: 0.33, C: 0.34 },
      questions_asked: [],
      history: [],
    });
  }

  const session = sessions.get(session_id)!;

  if (session.state === "CONVERGED") {
    return NextResponse.json({
      reply: "Your session is complete. Refresh to investigate a new flare.",
      state: "CONVERGED",
      phenotype_probs: session.phenotype_probs,
      converged: true,
      phenotype_match: null,
    });
  }

  // Add user message to history
  session.history.push({ role: "user", content: message });

  // Call Claude
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    system: buildSystemPrompt(session),
    messages: session.history,
  });

  const rawText = response.content[0].type === "text" ? response.content[0].text : "";
  
  let parsed;
  try {
    const clean = rawText.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(clean);
  } catch {
    parsed = {
      reply: "Sorry, something went wrong. Could you describe your symptoms again?",
      state: session.state,
      phenotype_probs: session.phenotype_probs,
      converged: false,
      phenotype_match: null,
      context_update: {},
      question_field: null,
    };
  }

  // Update session state
  session.state = parsed.state;
  session.phenotype_probs = parsed.phenotype_probs || session.phenotype_probs;
  if (parsed.context_update) {
    session.context = { ...session.context, ...parsed.context_update };
  }
  if (parsed.question_field) {
    session.questions_asked.push(parsed.question_field);
  }

  // Add assistant reply to history
  session.history.push({ role: "assistant", content: parsed.reply });

  // If converged, add flare to graph
  if (parsed.converged && parsed.phenotype_match) {
    const CLUSTER_IDS: Record<string, number> = {
      "Caffeine/Sleep-Sensitive IBS": 0,
      "FODMAP-Sensitive IBS": 1,
      "Stress/Gut-Brain IBS": 2,
    };
    const CLUSTER_COLORS: Record<number, string> = {
      0: "#FF6B6B", 1: "#4ECDC4", 2: "#FFE66D",
    };
    const clusterId = CLUSTER_IDS[parsed.phenotype_match.label] ?? -1;

    try {
      const origin = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";
      await fetch(`${origin}/api/flares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: `live-${session_id}-${Date.now()}`,
          label: session.symptoms.slice(0, 2).join(" + ") || "new flare",
          symptoms: session.symptoms,
          clusterId,
          color: CLUSTER_COLORS[clusterId],
          confidence: parsed.phenotype_match.confidence,
          synthetic: false,
          summary: `Live session: ${parsed.phenotype_match.label}`,
          novel_factors: [],
          // Coordinates will be null — frontend places near cluster centroid
          x: null, y: null, z: null,
        }),
      });
    } catch {
      // non-fatal
    }
  }

  return NextResponse.json({
    reply: parsed.reply,
    state: parsed.state,
    phenotype_probs: parsed.phenotype_probs,
    converged: parsed.converged,
    phenotype_match: parsed.phenotype_match,
  });
}
```

---

## Step 4: Update `FlareGraphInner.tsx` — Remove Sector Forces

The UMAP coordinates from preprocessing already place nodes in the right spatial positions. The hardcoded sector force will **fight against** the real coordinates.

**Remove only this block** from the `useEffect` in `FlareGraphInner.tsx`:

```typescript
// DELETE THIS ENTIRE BLOCK:
fg.d3Force("cluster", () => {
  const targetRadius = 120;
  const deadZone = 50;
  for (const node of flaresRef.current) {
    if (node.clusterId === -1) continue;
    const angle = SECTOR_ANGLES[node.clusterId];
    if (angle === undefined) continue;
    const targetX = Math.cos(angle) * targetRadius;
    const targetY = Math.sin(angle) * targetRadius;
    const dx = targetX - (node.x || 0);
    const dy = targetY - (node.y || 0);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > deadZone) {
      const strength = 0.05 * ((dist - deadZone) / dist);
      node.vx = (node.vx || 0) + dx * strength;
      node.vy = (node.vy || 0) + dy * strength;
    }
    node.vz = (node.vz || 0) + (0 - (node.z || 0)) * 0.02;
  }
});

// ALSO DELETE:
fg.d3Force("charge")?.strength(-80);
```

**Also replace** `fg.d3ReheatSimulation()` calls with pinned coordinates. Since UMAP provides real positions, freeze nodes in place:

```typescript
// After loading graphData, pin all existing nodes to their UMAP positions
// Add this after the setup block:
fg.d3Force("charge", null);
fg.d3Force("link", null);
fg.d3Force("center", null);

// Pin each node to its preprocessed coordinates
for (const node of flaresRef.current) {
  if (node.x !== null && node.x !== undefined) {
    node.fx = node.x;
    node.fy = node.y;
    node.fz = node.z;
  }
}
```

**For new live flares** (x=null from session), place them near their cluster centroid with slight jitter:

```typescript
// Add this helper to FlareGraphInner.tsx:
function getClusterCentroid(clusterId: number, allNodes: FlareNode[]) {
  const members = allNodes.filter(n => n.clusterId === clusterId && n.fx !== undefined);
  if (members.length === 0) return { x: 0, y: 0, z: 0 };
  return {
    x: members.reduce((s, n) => s + (n.fx || 0), 0) / members.length,
    y: members.reduce((s, n) => s + (n.fy || 0), 0) / members.length,
    z: members.reduce((s, n) => s + (n.fz || 0), 0) / members.length,
  };
}

// When a new node has no coordinates, pin it near its cluster:
if (node.x === null || node.x === undefined) {
  const centroid = getClusterCentroid(node.clusterId, flaresRef.current);
  node.fx = centroid.x + (Math.random() - 0.5) * 20;
  node.fy = centroid.y + (Math.random() - 0.5) * 20;
  node.fz = centroid.z + (Math.random() - 0.5) * 10;
}
```

---

## Step 5: Update `src/lib/types.ts`

Add two fields to `FlareNode`:

```typescript
export interface FlareNode {
  id: string;
  label: string;
  symptoms: string[];
  clusterId: number;
  color: string;
  confidence: number;
  synthetic: boolean;
  summary?: string;        // ADD THIS
  novel_factors?: string[] // ADD THIS
  x?: number | null;
  y?: number | null;
  z?: number | null;
  vx?: number;
  vy?: number;
  vz?: number;
  fx?: number;             // ADD THIS — pinned x
  fy?: number;             // ADD THIS — pinned y
  fz?: number;             // ADD THIS — pinned z
  __threeObj?: any;
}
```

---

## Step 6: Update Node Tooltip in `FlareGraphInner.tsx`

Now that nodes have `summary` and `novel_factors`, surface them on hover. Update the sprite label or add a tooltip:

```typescript
// In nodeThreeObject, update the sprite text to show summary on hover:
const labelText = isHovered && node.summary
  ? node.summary.slice(0, 60) + "..."
  : node.label;

const sprite = new SpriteText(labelText, isHovered ? 3 : 2, "white");
```

---

## Environment Variables

Add to `.env.local`:
```
ANTHROPIC_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
```

---

## Python Dependencies

```bash
pip install anthropic openai hdbscan umap-learn numpy requests
```

---

## Execution Order

```bash
# 1. Install Python deps
pip install anthropic openai hdbscan umap-learn numpy requests

# 2. Run preprocessing (do this first, before anything else)
python preprocess.py
# Takes ~5-10 mins first run (scraping + Claude extraction + embeddings)
# Subsequent runs use cache — instant

# 3. Verify output exists
ls public/flares_processed.json
# Should be ~200 nodes with x,y,z,clusterId etc

# 4. Start Next.js
npm run dev

# 5. Verify graph loads with real data at localhost:3000
```

---

## What Does NOT Change

| File | Status |
|------|--------|
| `ChatPanel.tsx` | No changes |
| `ChatMessage.tsx` | No changes |
| `FlareGraph.tsx` | No changes |
| `PhenotypeCard.tsx` | No changes |
| `ProbabilityBar.tsx` | No changes |
| `useFlarePolling.ts` | No changes |
| `api.ts` | No changes |
| `constants.ts` | No changes |
| `layout.tsx` | No changes |
| `globals.css` | No changes |
| `session/new/route.ts` | No changes |

---

## Cache Files (Never Commit These)

Add to `.gitignore`:
```
cache/
public/flares_processed.json
```

---

## Demo Pitch Upgrade

Before: *"50 synthetic flares in 3 hardcoded clusters"*

After: *"200 real patient reports from r/ibs, structured by Claude, embedded in high-dimensional space, clustered by HDBSCAN — phenotypes emerged from the data, we didn't define them."*
