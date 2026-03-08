# preprocess.py
# Run (cloud):  modal run preprocess.py
# Run (local):  python preprocess.py
# Output: public/flares_processed.json
# Requirements: pip install modal anthropic openai hdbscan umap-learn numpy

import os, json, time, pickle
import numpy as np

# ── MODAL SETUP ──────────────────────────────────────────────────────────────

import modal

app = modal.App("gutmap-preprocess")

image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "anthropic", "openai", "hdbscan", "umap-learn", "numpy"
)

cache_vol = modal.Volume.from_name("gutmap-cache", create_if_missing=True)
MODAL_CACHE_DIR = "/cache"

# ── CACHE HELPERS ────────────────────────────────────────────────────────────

def _cache_dir():
    """Return the cache directory — Modal volume mount or local."""
    if os.path.exists(MODAL_CACHE_DIR) and os.path.isdir(MODAL_CACHE_DIR):
        return MODAL_CACHE_DIR
    return "cache"

def load_cache(name):
    path = os.path.join(_cache_dir(), name)
    if os.path.exists(path):
        print(f"Loading cache: {path}")
        with open(path) as f:
            return json.load(f)
    return None

def save_cache(data, name):
    path = os.path.join(_cache_dir(), name)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f)
    print(f"Saved cache: {path}")

def load_np_cache(name):
    path = os.path.join(_cache_dir(), name)
    return np.load(path) if os.path.exists(path) else None

def save_np_cache(arr, name):
    path = os.path.join(_cache_dir(), name)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    np.save(path, arr)
    print(f"Saved numpy cache: {path}")

CLUSTER_COLORS = {0: "#FF6B6B", 1: "#4ECDC4", 2: "#FFE66D", -1: "#888888"}

# ── STEP 1: SYNTHETIC SEED DATA ─────────────────────────────────────────────

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

# ── STEP 2: GENERATE REALISTIC NARRATIVES (replaces Reddit scraping) ─────────

NARRATIVE_PROMPT = """Generate {n} realistic IBS patient flare-up narratives as a JSON array of strings.

Ground them in established clinical research:
- Rome IV IBS criteria (IBS-D, IBS-C, IBS-M subtypes)
- Monash University FODMAP trigger categories
- HPA axis stress-gut interaction research
- Caffeine and colonic motility research

Distribute across 3 endotypes (~{per_group} each, with ~{ambiguous} ambiguous/mixed):

1. FODMAP-sensitive: onion, garlic, wheat, lactose, legume triggers. Bloating, gas,
   cramping 1-4hrs after eating. Varies by food amount and combination.

2. Caffeine/Sleep-sensitive: coffee on empty stomach, <6hrs sleep, irregular meal
   timing. Urgency, loose stools, morning flares. Some overlap with stress.

3. Stress/Gut-Brain axis: high anxiety, work pressure, skipped meals, disrupted
   routine, travel. Pain, nausea, diarrhea. Delayed onset, sometimes next-day.

Requirements for each narrative:
- 2-4 sentences, casual first-person patient language (not clinical)
- Mention specific foods, times, situations
- Natural variance within each endotype — no two are identical
- Some should mention what helped or made it worse
- Include ambiguous cases where the trigger isn't obvious
- Mix demographics, lifestyles, eating habits
- Some narratives should mention multiple potential triggers

Return ONLY a JSON array of strings. No markdown, no preamble."""


def generate_narratives(total=150):
    """Use Claude to generate clinically-grounded IBS flare narratives."""
    cached = load_cache("generated_narratives.json")
    if cached:
        return cached

    import anthropic
    anthropic_client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    per_group = total // 3
    ambiguous = total - (per_group * 3) + 5  # ~5 ambiguous cases

    # Generate in batches to stay within output limits
    BATCH_SIZE = 50
    all_narratives = []

    for batch_start in range(0, total, BATCH_SIZE):
        batch_n = min(BATCH_SIZE, total - batch_start)
        print(f"Generating narratives {batch_start+1}-{batch_start+batch_n}...")

        resp = anthropic_client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=8000,
            messages=[{"role": "user", "content": NARRATIVE_PROMPT.format(
                n=batch_n, per_group=batch_n // 3, ambiguous=max(2, batch_n // 10)
            )}]
        )
        text = resp.content[0].text.strip()
        # Strip markdown fences if present
        text = text.replace("```json", "").replace("```", "").strip()
        narratives = json.loads(text)
        all_narratives.extend(narratives)
        time.sleep(0.5)

    # Convert to post-like dicts matching the pipeline format
    posts = []
    for i, narrative in enumerate(all_narratives[:total]):
        posts.append({
            "id": f"gen-{i:03d}",
            "narrative": narrative[:1200],
            "synthetic": True,
            "source": "claude_generated"
        })

    save_cache(posts, "generated_narratives.json")
    return posts

# ── STEP 3: CLAUDE EXTRACTION ───────────────────────────────────────────────

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

def extract_flares(posts):
    cached = load_cache("extracted.json")
    if cached:
        return cached

    import anthropic
    anthropic_client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

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

    save_cache(extracted, "extracted.json")
    return extracted

# ── STEP 4: FEATURE VECTORS ─────────────────────────────────────────────────

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
    from openai import OpenAI
    openai_client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    resp = openai_client.embeddings.create(
        model="text-embedding-3-small",
        input=text[:2000]
    )
    return np.array(resp.data[0].embedding)

def build_vectors(flares):
    cached = load_np_cache("vectors.npy")
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
    save_np_cache(matrix, "vectors.npy")
    return matrix

# ── STEP 5: CLUSTER + REDUCE ────────────────────────────────────────────────

def fit_pipeline(matrix):
    import hdbscan as hdbscan_mod
    import umap as umap_mod

    pipeline_path = os.path.join(_cache_dir(), "pipeline.pkl")
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
    reducer = umap_mod.UMAP(
        n_components=3,
        n_neighbors=15,
        min_dist=0.1,
        metric="cosine",
        random_state=42
    ).fit(matrix)
    coords = reducer.transform(matrix)

    print("Fitting HDBSCAN...")
    clusterer = hdbscan_mod.HDBSCAN(
        min_cluster_size=5,
        metric="euclidean",
        prediction_data=True
    ).fit(matrix)
    labels = clusterer.labels_

    with open(pipeline_path, "wb") as f:
        pickle.dump({"reducer": reducer, "clusterer": clusterer}, f)
    print(f"Pipeline cached. Discovered {len(set(labels)) - (1 if -1 in labels else 0)} clusters")

    return reducer, clusterer, coords, labels

# ── STEP 6: BUILD OUTPUT ────────────────────────────────────────────────────

def build_output(flares, coords, labels, clusterer):
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

    return output

# ── PIPELINE ─────────────────────────────────────────────────────────────────

def run_pipeline():
    """Run the full preprocessing pipeline, return JSON-serializable output."""
    print("=== Step 1: Seed data ===")
    seed_flares = generate_seed_flares()
    print(f"Generated {len(seed_flares)} synthetic seed flares")

    print("\n=== Step 2: Generate realistic narratives ===")
    generated_posts = generate_narratives(total=150)
    print(f"Generated {len(generated_posts)} narratives")

    print("\n=== Step 3: Claude extraction ===")
    extracted_posts = extract_flares(generated_posts)
    print(f"Extracted {len(extracted_posts)} posts")

    all_flares = seed_flares + extracted_posts
    print(f"\nTotal flares: {len(all_flares)} ({len(seed_flares)} seed + {len(extracted_posts)} generated)")

    print("\n=== Step 4: Building vectors ===")
    matrix = build_vectors(all_flares)
    print(f"Vector matrix shape: {matrix.shape}")

    print("\n=== Step 5: Clustering + UMAP ===")
    reducer, clusterer, coords, labels = fit_pipeline(matrix)

    print("\n=== Step 6: Building output ===")
    output = build_output(all_flares, coords, labels, clusterer)
    print(f"Built {len(output)} nodes")
    print(f"Cluster distribution: { {k: list(labels).count(k) for k in sorted(set(labels))} }")

    return output

# ── MODAL REMOTE FUNCTION ───────────────────────────────────────────────────

@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("anthropic-secret"),
        modal.Secret.from_name("openai-secret"),
    ],
    volumes={MODAL_CACHE_DIR: cache_vol},
    timeout=1800,
)
def run_pipeline_modal():
    """Run the full pipeline on Modal and return the JSON output."""
    result = run_pipeline()
    cache_vol.commit()  # persist cache to volume
    return result

@app.local_entrypoint()
def main():
    """Modal entrypoint — calls the remote function and writes the result locally."""
    print("Running pipeline on Modal...")
    output = run_pipeline_modal.remote()
    os.makedirs("public", exist_ok=True)
    with open("public/flares_processed.json", "w") as f:
        json.dump(output, f)
    print(f"\nWritten {len(output)} nodes to public/flares_processed.json")
    print("Done. Start the app with: npm run dev")

# ── LOCAL EXECUTION ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    output = run_pipeline()
    os.makedirs("public", exist_ok=True)
    with open("public/flares_processed.json", "w") as f:
        json.dump(output, f)
    print(f"\nWritten {len(output)} nodes to public/flares_processed.json")
    print("Done. Start the app with: npm run dev")
