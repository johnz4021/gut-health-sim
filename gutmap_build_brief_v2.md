# GutMap — IBS Trigger Discovery via Cohort Phenotyping
## Claude Code Build Brief v2

---

## One-Line Pitch
An AI system that uses Bayesian-style Socratic questioning to identify IBS triggers, learning gut-health endotypes from shared flare-up data across a patient cohort.

---

## Core Design Philosophy
**The server drives the investigation, not the user.**

Users don't know what context matters. Instead of asking "what did you eat?", the system:
1. Forms candidate phenotype hypotheses from symptoms alone
2. Asks the single highest-information question to discriminate between them
3. Updates probabilities based on the answer (Bayesian updating)
4. Converges on a phenotype + trigger hypothesis in 3-4 questions

This is how a gastroenterologist actually works.

---

## UI Layout — Single Screen, Two Panels

```
┌─────────────────────┬──────────────────────────┐
│                     │                          │
│   Chat Interface    │    Live 3D Force Graph   │
│   (left ~40%)       │    (right ~60%)          │
│                     │                          │
│  Patient reports    │  Nodes = flare events    │
│  symptoms via       │  Colors = phenotype      │
│  text input         │  clusters                │
│                     │                          │
│  Agent asks smart   │  New node animates in    │
│  follow-up Qs       │  and pulls toward        │
│                     │  nearest cluster         │
│  Phenotype card     │  in real time            │
│  appears on match   │                          │
└─────────────────────┴──────────────────────────┘
```

- Built in React
- 3D graph: `react-force-graph-3d`
- Chat: simple controlled input + message bubble list
- No mobile/SMS integration needed — demo runs from laptop

---

## Tech Stack

### Frontend (React)
- Split layout: chat panel left, 3D graph right
- Chat bubbles (user = right, bot = left)
- Text input at bottom of chat panel
- Graph polls `/api/flares` every 2 seconds for new nodes
- When new flare added: animate node flying in, settling into cluster
- Phenotype card component renders below chat when match is found:
  ```
  ┌─────────────────────────────────┐
  │ 🧬 Sleep/Caffeine-Sensitive IBS │
  │ 18% of cohort · Confidence 0.74 │
  │ Triggers: caffeine before food, │
  │ <6hrs sleep                     │
  └─────────────────────────────────┘
  ```

### Backend (Python / FastAPI)

**Conversation State Machine — per session:**
```
SYMPTOM_INTAKE → HYPOTHESIS_FORMED → QUESTIONING → CONVERGED
```

- `SYMPTOM_INTAKE`: receive free-text symptom description, parse into structured fields
- `HYPOTHESIS_FORMED`: rank top 2-3 candidate phenotypes by prior probability given symptoms
- `QUESTIONING`: ask discriminating questions one at a time, update phenotype probabilities
- `CONVERGED`: top phenotype probability exceeds threshold (e.g. 0.70) → surface result

**Session object:**
```python
@dataclass
class Session:
    session_id: str
    state: ConversationState
    symptoms: list[str]
    context: dict                    # fills in as user answers questions
    phenotype_probs: dict[str, float]  # {"phenotype_A": 0.6, "phenotype_B": 0.3, ...}
    questions_asked: list[str]
    flare_id: str | None             # set when committed to graph
```

### AI Agent (Claude — Anthropic API)
- Model: `claude-sonnet-4-20250514`
- Two distinct agent responsibilities:

**Agent 1 — Symptom Parser**
- Input: free-text flare description
- Output: structured symptom list + initial phenotype probability priors
- System prompt: parse symptoms, return JSON with symptom list and which phenotypes are candidates

**Agent 2 — Socratic Questioner**
- Input: current session state (symptoms, context so far, phenotype_probs, questions already asked)
- Output: the single next best question to ask
- System prompt logic:
  ```
  Given these candidate phenotypes and their current probabilities,
  and the context fields already collected,
  identify which single yes/no question would most reduce uncertainty
  between the top candidates. Ask it conversationally in one sentence.
  Do not ask about something already answered.
  ```
- After each answer, Claude updates the probability distribution and decides:
  - Continue questioning, or
  - Converge (if top phenotype > 0.70 confidence)

**Agent 3 — Summary Generator**
- Input: converged phenotype + full context collected
- Output: 2-3 sentence natural language explanation of likely trigger
- Keep it warm and plain-English, not clinical

### Dimensionality, Clustering + Visualization Pipeline

These are two separate problems solved by two separate algorithms. Do not conflate them.

**Feature Vector (~15 dimensions)**

Normalize all fields to [0, 1] before passing to either algorithm:
```python
def build_feature_vector(flare: dict) -> np.ndarray:
    ctx = flare["context"]
    return np.array([
        float(ctx.get("caffeine_before_food", False)),
        ctx.get("sleep_hours", 7) / 10.0,          # normalize 0–10hrs
        ctx.get("stress_level", 1) / 5.0,           # normalize 1–5
        float(ctx.get("fodmap_onion", False)),
        float(ctx.get("fodmap_garlic", False)),
        float(ctx.get("fodmap_wheat", False)),
        float(ctx.get("meal_skipped", False)),
        float(ctx.get("portion_large", False)),
        float(ctx.get("caffeine", False)),
        ctx.get("meal_timing_delay_hrs", 0) / 8.0,  # normalize
    ])
```

**Problem 1: Clustering — use HDBSCAN in full-dimensional space**

HDBSCAN over K-Means because:
- No need to specify number of clusters upfront
- Handles outliers (marks as -1, doesn't force them into a cluster)
- Finds irregular cluster shapes — real biological data isn't spherical
- More scientifically defensible for phenotype discovery

```python
import hdbscan

clusterer = hdbscan.HDBSCAN(min_cluster_size=5, metric='euclidean')
cluster_labels = clusterer.fit_predict(feature_matrix)  # -1 = noise/unassigned
```

**Problem 2: 3D Visualization — use UMAP to reduce to 3D**

UMAP over t-SNE because:
- Preserves global structure (distant clusters stay distant in 3D)
- Faster and more stable across runs
- Supports `transform()` for new points without refitting

```python
import umap

reducer = umap.UMAP(n_components=3, random_state=42)
coords_3d = reducer.fit_transform(feature_matrix)
# coords_3d shape: (n_flares, 3) → x, y, z for react-force-graph-3d
```

**Full Pipeline:**
```
Raw flare context dict
        ↓
  Feature vector (~15 dims, normalized)
        ↓
    ┌───┴───┐
    │       │
 HDBSCAN  UMAP
(cluster  (3D coords
 labels)   for graph)
    │       │
    └───┬───┘
        ↓
  { x, y, z, cluster_id, phenotype_label, confidence }
        ↓
  react-force-graph-3d node
```

**CRITICAL: Fit once on seed data, transform new points**

Do NOT refit UMAP/HDBSCAN on every new flare — the whole graph will shift and the demo breaks.

```python
# At server startup — fit on seed data once
feature_matrix = np.array([build_feature_vector(f) for f in seed_flares])
reducer = umap.UMAP(n_components=3, random_state=42).fit(feature_matrix)
clusterer = hdbscan.HDBSCAN(min_cluster_size=5).fit(feature_matrix)

# For each new real flare — transform into existing space
new_vec = build_feature_vector(new_flare).reshape(1, -1)
new_coords = reducer.transform(new_vec)        # → [x, y, z]
new_label, _ = hdbscan.approximate_predict(clusterer, new_vec)
```

**Fallback if UMAP transform is jittery on single points:**

Find the nearest existing node by euclidean distance in full-dim space and place the new node adjacent to it in 3D. Visually identical, zero instability.

```python
def get_stable_coords(new_vec, existing_vecs, existing_coords_3d):
    distances = np.linalg.norm(existing_vecs - new_vec, axis=1)
    nearest_idx = np.argmin(distances)
    base = existing_coords_3d[nearest_idx]
    jitter = np.random.normal(0, 0.3, 3)   # small random offset
    return base + jitter
```

**Node color mapping:**
```python
CLUSTER_COLORS = {
    0: "#FF6B6B",   # Phenotype A — Caffeine/Sleep — red
    1: "#4ECDC4",   # Phenotype B — FODMAP — teal
    2: "#FFE66D",   # Phenotype C — Stress — yellow
   -1: "#888888",   # Noise/unassigned — grey
}
```

---

## Phenotype Definitions (seed these explicitly)

### Phenotype A — Caffeine/Sleep-Sensitive
- Discriminating questions: "Did you have coffee before eating?" / "Less than 6hrs sleep?"
- Symptoms: urgency, bloating
- Triggers: caffeine on empty stomach, sleep <6hrs
- Prior: high if urgency present

### Phenotype B — FODMAP-Sensitive
- Discriminating questions: "Did you eat onion, garlic, or wheat?" / "Large portion?"
- Symptoms: bloating, cramping
- Triggers: high-FODMAP foods (onion, garlic, wheat)
- Prior: high if bloating + cramping without urgency
- Scientific anchor: Monash University FODMAP research

### Phenotype C — Stress/Gut-Brain
- Discriminating questions: "High stress day?" / "Did you skip or delay meals?"
- Symptoms: pain, diarrhea, nausea
- Triggers: psychological stress, irregular meal timing
- Prior: high if pain is dominant symptom
- Scientific anchor: cortisol → gut motility (HPA axis literature)

---

## Bayesian Questioning Logic

```python
def select_next_question(session: Session) -> str:
    """
    Find the question that maximally discriminates between top phenotype candidates.
    Pass to Claude with session context to generate conversational phrasing.
    """
    top_phenotypes = get_top_candidates(session.phenotype_probs, n=2)
    unanswered_discriminators = get_unanswered_discriminating_fields(
        top_phenotypes, 
        already_known=session.context
    )
    # Claude picks the best one and phrases it naturally
    return ask_claude_to_phrase_question(unanswered_discriminators, session)

def update_probabilities(session: Session, question_field: str, answer: bool):
    """
    Simple likelihood update per answer.
    If answer matches phenotype's expected value → boost that phenotype's prob
    If answer contradicts → reduce
    Renormalize after each update.
    """
    for phenotype_id, pheno in PHENOTYPES.items():
        expected = pheno.discriminators.get(question_field)
        if expected is None:
            continue
        if answer == expected:
            session.phenotype_probs[phenotype_id] *= 1.8   # boost
        else:
            session.phenotype_probs[phenotype_id] *= 0.4   # reduce
    normalize(session.phenotype_probs)
```

---

## Seed Data Generation

Generate 50 synthetic flare events programmatically at server startup. Distribute ~16-17 per phenotype with natural variance (not every caffeine-sensitive person had exactly 5hrs sleep).

```python
def generate_seed_flares():
    flares = []
    # Phenotype A cluster — with variance
    for i in range(17):
        flares.append({
            "symptoms": random.sample(["urgency", "bloating", "cramping"], k=2),
            "context": {
                "caffeine_before_food": True,
                "sleep_hours": random.randint(3, 6),
                "high_fodmap": [],
                "stress_level": random.randint(1, 3),
            },
            "phenotype": "A",
            "synthetic": True
        })
    # Phenotype B, C similarly...
    return flares
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/chat` | Send user message, get agent reply + session update |
| GET | `/api/flares` | All flare events + cluster assignments for graph |
| GET | `/api/phenotypes` | Phenotype cluster summaries |
| POST | `/api/session/new` | Start a new flare investigation session |

**`/api/chat` request/response:**
```json
// Request
{ "session_id": "abc123", "message": "I'm having bad bloating and cramping" }

// Response
{
  "reply": "Sorry to hear that. Did you eat any onion, garlic, or wheat in the last 24 hours?",
  "state": "QUESTIONING",
  "phenotype_probs": {"A": 0.2, "B": 0.65, "C": 0.15},
  "converged": false,
  "phenotype_match": null
}

// Response when converged
{
  "reply": "Based on your answers, your symptoms match a FODMAP-sensitive pattern...",
  "state": "CONVERGED",
  "converged": true,
  "phenotype_match": {
    "label": "FODMAP-Sensitive IBS",
    "confidence": 0.74,
    "triggers": ["onion", "garlic", "wheat"],
    "population_pct": 0.22
  }
}
```

---

## Environment Variables
```
ANTHROPIC_API_KEY=
```

## Python Dependencies
```
fastapi uvicorn
hdbscan
umap-learn
numpy scikit-learn
anthropic
```

---

## Build Order (9 hours)

| Time | Task |
|------|------|
| 10:00–11:00 | FastAPI skeleton + session state machine + seed data generation |
| 11:00–12:30 | Claude agents: symptom parser + Socratic questioner + summary |
| 12:30–1:00 | Lunch |
| 1:00–2:00 | Feature vectors + HDBSCAN clustering + UMAP 3D reduction on seed data |
| 2:00–3:30 | React layout: split panel, chat bubbles, phenotype card component |
| 3:30–5:00 | react-force-graph-3d: nodes, colors, animate new node arrival |
| 5:00–5:45 | Wire frontend to backend, test full end-to-end flow |
| 5:45–6:15 | Polish + rehearse demo script |

---

## Demo Script (3 minutes)

**0:00–0:30** — Point at graph: *"Each node is a real flare-up report. Colors are phenotype clusters the system discovered. This is your cohort."*

**0:30–1:30** — Type into chat: *"I'm having bloating and stomach cramping"*
- Agent asks: *"Did you eat onion, garlic, or wheat in the last 24 hours?"* → yes
- Agent asks: *"Was it a larger portion than usual?"* → yes
- New node animates into graph, pulls toward Cluster B

**1:30–2:30** — Phenotype card appears. Walk through it:
*"After 2 questions the system converged. It didn't ask about sleep or stress — it figured out those weren't relevant. That's the Bayesian discrimination working."*

**2:30–3:00** — Pitch: *"IBS affects 15% of people. Trigger discovery today takes months of elimination diets. This gets there in 3 questions by learning from everyone who came before you."*

---
## Scientific Framing for Pitch
- These are **endotypes** not just phenotypes — mechanistic subtypes, not just symptom clusters
- Phenotype B grounded in Monash University FODMAP research
- Phenotype C grounded in HPA axis / cortisol → gut motility literature
- Rome IV IBS criteria (IBS-D, IBS-C, IBS-M) maps directly to discovered clusters
- Confidence score is earned through questioning, not assigned arbitrarily

CRITICAL: Use exactly these phenotype definitions. Do not add or modify:
- Phenotype A: caffeine_before_food=True, sleep_hours<6 → urgency, bloating
- Phenotype B: fodmap_onion/garlic/wheat=True → bloating, cramping  
- Phenotype C: stress_level>3, meal_skipped=True → pain, diarrhea
These are scientifically anchored and must stay consistent across 
the clustering, questioning logic, and summary generation.