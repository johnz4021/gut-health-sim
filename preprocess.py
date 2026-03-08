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

VECTOR_VERSION = 3  # Bump when feature vector shape/weights change — invalidates stale caches

AGE_RANGES = ["18-25", "26-35", "36-45", "46-60", "60+"]
SEXES = ["male", "female"]
IBS_SUBTYPES = ["IBS-D", "IBS-C", "IBS-M", "IBS-U"]
ONSET_PERIODS = ["<1yr", "1-3yr", "3-5yr", "5-10yr", "10yr+"]

DEFAULT_CLUSTER_PALETTE = [
    "#FF6B6B", "#4ECDC4", "#FFE66D", "#A78BFA", "#F97316",
    "#34D399", "#F472B6", "#60A5FA", "#FBBF24", "#6EE7B7",
]

# ── STEP 1: SYNTHETIC SEED DATA ─────────────────────────────────────────────

def _random_background():
    import random
    return {
        "age_range": random.choice(AGE_RANGES),
        "sex": random.choice(SEXES),
        "ibs_subtype": random.choice(IBS_SUBTYPES),
        "diagnosed": random.choice([True, False]),
        "onset_period": random.choice(ONSET_PERIODS),
    }

def generate_seed_flares():
    import random
    seed_flares = []

    # Diverse phenotype configs — not limited to the original 3 axes.
    # HDBSCAN will discover natural clusters from this richer signal.
    phenotype_configs = [
        # ── Classic core phenotypes ──
        {
            "phenotype": "caffeine_sleep",
            "count": 10,
            "known_triggers": {"caffeine_before_food": True, "sleep_hours": None,
                               "stress_level": None, "fodmap_load": 0.1,
                               "alcohol": False, "meal_skipped": False,
                               "anxiety_level": None, "travel": False,
                               "fat_content": None, "carbonated": False,
                               "meal_size": None, "eating_speed": None,
                               "sleep_quality": None, "recent_antibiotics": False,
                               "exercise_today": None, "disrupted_routine": False},
            "symptoms": ["urgency", "bloating", "loose stools"],
            "narrative_templates": [
                "Had coffee before breakfast, only slept {sleep}hrs, bad urgency and bloating all morning",
                "Skipped breakfast, had espresso, then got hit with bloating and urgency",
                "Poor sleep last night maybe {sleep}hrs, caffeine first thing, GI was terrible",
            ]
        },
        {
            "phenotype": "fodmap",
            "count": 10,
            "known_triggers": {"caffeine_before_food": False, "sleep_hours": None,
                               "stress_level": None, "fodmap_load": 0.85,
                               "alcohol": False, "meal_skipped": False,
                               "anxiety_level": None, "travel": False,
                               "fat_content": None, "carbonated": False,
                               "meal_size": None, "eating_speed": None,
                               "sleep_quality": None, "recent_antibiotics": False,
                               "exercise_today": None, "disrupted_routine": False},
            "symptoms": ["bloating", "cramping", "gas"],
            "narrative_templates": [
                "Ate {food} for dinner, woke up with terrible bloating and cramps",
                "Had {food} at a restaurant, cramping and distension started about 2hrs later",
                "Big portion of {food}, couldn't leave the house next morning because of cramping",
            ]
        },
        {
            "phenotype": "stress_gut",
            "count": 10,
            "known_triggers": {"caffeine_before_food": False, "sleep_hours": None,
                               "stress_level": None, "fodmap_load": 0.2,
                               "alcohol": False, "meal_skipped": True,
                               "anxiety_level": None, "travel": False,
                               "fat_content": None, "carbonated": False,
                               "meal_size": None, "eating_speed": None,
                               "sleep_quality": None, "recent_antibiotics": False,
                               "exercise_today": None, "disrupted_routine": True},
            "symptoms": ["pain", "diarrhea", "nausea"],
            "narrative_templates": [
                "Super stressful day at work, skipped lunch, stomach pain and diarrhea by evening",
                "Anxiety was high all day, forgot to eat until 3pm, gut was a mess",
                "Presentation at work, stress through the roof, irregular meals, bad flare",
            ]
        },
        # ── New distinct phenotypes for richer clustering ──
        {
            "phenotype": "alcohol_fat",
            "count": 8,
            "known_triggers": {"caffeine_before_food": False, "sleep_hours": None,
                               "stress_level": None, "fodmap_load": 0.3,
                               "alcohol": True, "meal_skipped": False,
                               "anxiety_level": None, "travel": False,
                               "fat_content": 0.8, "carbonated": True,
                               "meal_size": 0.8, "eating_speed": 0.7,
                               "sleep_quality": None, "recent_antibiotics": False,
                               "exercise_today": False, "disrupted_routine": False},
            "symptoms": ["diarrhea", "cramping", "nausea", "urgency"],
            "narrative_templates": [
                "Went out for beers and wings last night, greasy food plus {drinks} drinks, stomach was wrecked by morning",
                "Had a big fatty meal with wine at dinner, woke up with cramps and urgency",
                "Pizza and beer night, felt terrible — cramping and diarrhea hit around 3am",
            ]
        },
        {
            "phenotype": "travel_disruption",
            "count": 8,
            "known_triggers": {"caffeine_before_food": None, "sleep_hours": None,
                               "stress_level": None, "fodmap_load": 0.3,
                               "alcohol": False, "meal_skipped": True,
                               "anxiety_level": None, "travel": True,
                               "fat_content": None, "carbonated": False,
                               "meal_size": None, "eating_speed": None,
                               "sleep_quality": None, "recent_antibiotics": False,
                               "exercise_today": False, "disrupted_routine": True},
            "symptoms": ["constipation", "bloating", "pain", "irregular BMs"],
            "narrative_templates": [
                "Three-day business trip, different time zone, irregular meals — completely stopped up",
                "Flew cross-country, barely ate, jet lag destroyed my sleep and my gut",
                "Road trip, ate fast food, disrupted routine, bloating and constipation for days",
            ]
        },
        {
            "phenotype": "post_antibiotics",
            "count": 6,
            "known_triggers": {"caffeine_before_food": False, "sleep_hours": None,
                               "stress_level": None, "fodmap_load": 0.4,
                               "alcohol": False, "meal_skipped": False,
                               "anxiety_level": None, "travel": False,
                               "fat_content": None, "carbonated": False,
                               "meal_size": None, "eating_speed": None,
                               "sleep_quality": None, "recent_antibiotics": True,
                               "exercise_today": None, "disrupted_routine": False},
            "symptoms": ["diarrhea", "bloating", "gas", "urgency"],
            "narrative_templates": [
                "Finished a course of antibiotics last week, gut has been a disaster since — constant loose stools",
                "Doctor put me on amoxicillin for a sinus infection, IBS flared up hard afterwards",
                "Post-antibiotic GI chaos, everything I eat causes gas and urgency now",
            ]
        },
        {
            "phenotype": "large_meal_speed",
            "count": 6,
            "known_triggers": {"caffeine_before_food": False, "sleep_hours": None,
                               "stress_level": None, "fodmap_load": 0.4,
                               "alcohol": False, "meal_skipped": False,
                               "anxiety_level": None, "travel": False,
                               "fat_content": 0.6, "carbonated": False,
                               "meal_size": 0.9, "eating_speed": 0.9,
                               "sleep_quality": None, "recent_antibiotics": False,
                               "exercise_today": None, "disrupted_routine": False},
            "symptoms": ["bloating", "pain", "fullness", "nausea"],
            "narrative_templates": [
                "Ate way too much at Thanksgiving, shoveled it down fast, felt like a balloon for hours",
                "Huge lunch at a buffet, ate too quickly, stomach pain and bloating kicked in within 30 min",
                "Wolfed down a massive burrito in 5 minutes, immediate regret — bloating and nausea",
            ]
        },
        {
            "phenotype": "exercise_related",
            "count": 6,
            "known_triggers": {"caffeine_before_food": False, "sleep_hours": None,
                               "stress_level": None, "fodmap_load": 0.2,
                               "alcohol": False, "meal_skipped": False,
                               "anxiety_level": None, "travel": False,
                               "fat_content": None, "carbonated": False,
                               "meal_size": None, "eating_speed": None,
                               "sleep_quality": None, "recent_antibiotics": False,
                               "exercise_today": True, "disrupted_routine": False},
            "symptoms": ["cramping", "urgency", "diarrhea"],
            "narrative_templates": [
                "Went for a hard run after eating, 20 minutes in got terrible cramping and urgency",
                "HIIT class on a full stomach, had to stop mid-workout because of GI distress",
                "Morning jog triggered urgency and cramping, barely made it back home in time",
            ]
        },
        {
            "phenotype": "anxiety_dominant",
            "count": 6,
            "known_triggers": {"caffeine_before_food": False, "sleep_hours": None,
                               "stress_level": None, "fodmap_load": 0.15,
                               "alcohol": False, "meal_skipped": False,
                               "anxiety_level": None, "travel": False,
                               "fat_content": None, "carbonated": False,
                               "meal_size": None, "eating_speed": None,
                               "sleep_quality": None, "recent_antibiotics": False,
                               "exercise_today": None, "disrupted_routine": False},
            "symptoms": ["nausea", "pain", "loss of appetite", "diarrhea"],
            "narrative_templates": [
                "Panic attack at work, couldn't eat all day, waves of nausea and stomach pain",
                "Severe anxiety about a medical appointment, gut completely shut down, no appetite and diarrhea",
                "Generalized anxiety flare, constant nausea and abdominal pain even though I ate fine",
            ]
        },
    ]

    FODMAP_FOODS = ["pasta with garlic", "onion soup", "wheat bread", "garlic naan",
                    "lentil soup", "apple and honey", "mushroom risotto", "cauliflower stir-fry"]

    for config in phenotype_configs:
        pheno = config["phenotype"]
        count = config.get("count", 10)

        for i in range(count):
            # Randomize continuous triggers based on phenotype
            if pheno in ("caffeine_sleep", "stress_gut", "anxiety_dominant"):
                sleep = round(random.uniform(3.5, 6.5), 1)
            else:
                sleep = round(random.uniform(5, 8), 1)

            if pheno in ("stress_gut", "anxiety_dominant"):
                stress = round(random.uniform(3, 5), 1)
                anxiety = round(random.uniform(3.5, 5), 1)
            elif pheno == "travel_disruption":
                stress = round(random.uniform(2.5, 4), 1)
                anxiety = round(random.uniform(2, 3.5), 1)
            else:
                stress = round(random.uniform(1, 3), 1)
                anxiety = round(random.uniform(1, 2.5), 1)

            template = random.choice(config["narrative_templates"])
            narrative = template.format(
                sleep=sleep,
                food=random.choice(FODMAP_FOODS),
                drinks=random.randint(3, 6),
            )

            triggers = dict(config["known_triggers"])
            triggers["sleep_hours"] = sleep
            if triggers.get("stress_level") is None:
                triggers["stress_level"] = stress
            if triggers.get("anxiety_level") is None:
                triggers["anxiety_level"] = anxiety

            seed_flares.append({
                "id": f"seed-{pheno}-{i}",
                "narrative": narrative,
                "synthetic": True,
                "phenotype_label": pheno,
                "background": _random_background(),
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

    # ── Bridge / multi-axis seed flares ──
    bridge_configs = [
        {
            "bridge": "fodmap_stress",
            "count": 4,
            "known_triggers": {"caffeine_before_food": False, "sleep_hours": None,
                               "stress_level": 4.0, "fodmap_load": 0.75,
                               "alcohol": False, "meal_skipped": False,
                               "anxiety_level": None, "travel": False,
                               "fat_content": None, "carbonated": False,
                               "meal_size": None, "eating_speed": None,
                               "sleep_quality": None, "recent_antibiotics": False,
                               "exercise_today": None, "disrupted_routine": False},
            "symptoms": ["bloating", "cramping", "pain"],
            "narrative_templates": [
                "Ate garlic bread during a stressful work week, symptoms were way worse than usual",
                "Had onion soup while dealing with family stress, cramps were 10x worse than normal",
                "Stressful deadline week and ate wheat pasta — bloating and pain were off the charts",
                "Work crisis plus a big bowl of lentil soup, stomach was destroyed for two days",
            ]
        },
        {
            "bridge": "caffeine_stress",
            "count": 4,
            "known_triggers": {"caffeine_before_food": True, "sleep_hours": None,
                               "stress_level": 4.0, "fodmap_load": 0.1,
                               "alcohol": False, "meal_skipped": True,
                               "anxiety_level": None, "travel": False,
                               "fat_content": None, "carbonated": False,
                               "meal_size": None, "eating_speed": None,
                               "sleep_quality": None, "recent_antibiotics": False,
                               "exercise_today": None, "disrupted_routine": False},
            "symptoms": ["urgency", "diarrhea", "nausea"],
            "narrative_templates": [
                "Didn't sleep, slammed coffee, super anxious about deadline — stomach was a disaster",
                "Pulled an all-nighter, espresso first thing, presentation anxiety, couldn't leave the bathroom",
                "Terrible sleep and three cups of coffee during a high-stress day, GI was wrecked",
                "Barely slept, chugged coffee to cope with work pressure, urgency and nausea all morning",
            ]
        },
        {
            "bridge": "fodmap_caffeine",
            "count": 4,
            "known_triggers": {"caffeine_before_food": True, "sleep_hours": None,
                               "stress_level": None, "fodmap_load": 0.7,
                               "alcohol": False, "meal_skipped": False,
                               "anxiety_level": None, "travel": False,
                               "fat_content": None, "carbonated": False,
                               "meal_size": None, "eating_speed": None,
                               "sleep_quality": None, "recent_antibiotics": False,
                               "exercise_today": None, "disrupted_routine": False},
            "symptoms": ["bloating", "urgency", "gas"],
            "narrative_templates": [
                "Had coffee and wheat toast on little sleep, bloating and urgency all morning",
                "Espresso with garlic bread for breakfast on 5hrs sleep, gas and urgency hit hard",
                "Coffee first thing then a big bowl of onion soup, barely slept — bloating was insane",
                "Double shot latte plus pasta lunch on bad sleep, spent the afternoon in the bathroom",
            ]
        },
        {
            "bridge": "alcohol_stress",
            "count": 4,
            "known_triggers": {"caffeine_before_food": False, "sleep_hours": None,
                               "stress_level": 4.0, "fodmap_load": 0.3,
                               "alcohol": True, "meal_skipped": False,
                               "anxiety_level": None, "travel": False,
                               "fat_content": 0.7, "carbonated": True,
                               "meal_size": 0.7, "eating_speed": None,
                               "sleep_quality": None, "recent_antibiotics": False,
                               "exercise_today": False, "disrupted_routine": False},
            "symptoms": ["diarrhea", "pain", "nausea", "urgency"],
            "narrative_templates": [
                "Stressful week so I drank more than usual — greasy bar food and beers, terrible flare next day",
                "Went out drinking to cope with work stress, woke up with cramping and diarrhea",
                "High anxiety week, had wine with a rich dinner, GI paid the price all night",
                "Stress eating plus cocktails at a work event, couldn't function the next morning",
            ]
        },
        {
            "bridge": "travel_fodmap",
            "count": 4,
            "known_triggers": {"caffeine_before_food": False, "sleep_hours": None,
                               "stress_level": None, "fodmap_load": 0.7,
                               "alcohol": False, "meal_skipped": True,
                               "anxiety_level": None, "travel": True,
                               "fat_content": None, "carbonated": False,
                               "meal_size": None, "eating_speed": None,
                               "sleep_quality": None, "recent_antibiotics": False,
                               "exercise_today": False, "disrupted_routine": True},
            "symptoms": ["bloating", "constipation", "cramping", "gas"],
            "narrative_templates": [
                "Business trip, ate airport food with lots of wheat and onion, plus jet lag — terrible bloating",
                "Traveling and had no safe food options, ended up eating garlic-heavy restaurant meals, gut was wrecked",
                "Conference trip, disrupted schedule, hotel breakfast was all wheat and dairy — bloated for days",
                "Vacation abroad, couldn't avoid FODMAPs in local cuisine, travel stress made it worse",
            ]
        },
    ]

    for config in bridge_configs:
        count = config.get("count", 4)
        for i in range(count):
            sleep = round(random.uniform(4.0, 5.5), 1)
            stress = config["known_triggers"].get("stress_level") or round(random.uniform(1.5, 3.0), 1)
            anxiety = round(random.uniform(3.0, 4.5), 1) if "stress" in config["bridge"] else round(random.uniform(1.5, 3.0), 1)

            narrative = config["narrative_templates"][i % len(config["narrative_templates"])]

            triggers = dict(config["known_triggers"])
            triggers["sleep_hours"] = sleep
            if triggers.get("stress_level") is None:
                triggers["stress_level"] = stress
            if triggers.get("anxiety_level") is None:
                triggers["anxiety_level"] = anxiety

            seed_flares.append({
                "id": f"seed-bridge-{config['bridge']}-{i}",
                "narrative": narrative,
                "synthetic": True,
                "phenotype_label": f"bridge_{config['bridge']}",
                "background": _random_background(),
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
- Gut microbiome disruption (post-antibiotic, post-illness)
- Exercise-induced GI distress
- Alcohol and fat tolerance thresholds

Generate a DIVERSE range of trigger patterns — do NOT limit to 3 categories. Real IBS patients
have many different trigger profiles. Aim for a wide spread across these trigger dimensions:

- FODMAP foods (onion, garlic, wheat, lactose, legumes, fructose, polyols)
- Caffeine timing and sleep deprivation
- Stress, anxiety, and emotional triggers
- Alcohol and high-fat meals
- Travel, jet lag, routine disruption
- Post-antibiotic or post-illness gut changes
- Meal size, eating speed, skipped meals
- Exercise timing relative to eating
- Carbonated drinks
- Hormonal / menstrual cycle connections
- Multi-trigger combinations and cross-trigger amplification

Distribution guidelines (approximate):
- ~30% should have a single dominant trigger pattern
- ~40% should involve 2 trigger dimensions interacting
- ~30% should be complex cases with 3+ factors, ambiguous triggers, or unusual patterns

Include patients across IBS subtypes (IBS-D, IBS-C, IBS-M), ages, sexes, and lifestyles.
Some should mention their diagnosed status, how long they've had IBS, or past treatments.

Requirements for each narrative:
- 2-4 sentences, casual first-person patient language (not clinical)
- Mention specific foods, times, situations, quantities where relevant
- Natural variance — no two should feel like the same person
- Some should mention what helped or made it worse
- Include ambiguous cases where the trigger isn't obvious
- Some should express frustration, confusion, or surprise about their patterns

Return ONLY a JSON array of strings. No markdown, no preamble."""


def generate_narratives(total=150):
    """Use Claude to generate clinically-grounded IBS flare narratives."""
    cached = load_cache("generated_narratives.json")
    if cached:
        return cached

    import anthropic
    anthropic_client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

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
                n=batch_n
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

QUALITATIVE_MAP = {
    "none": 0.0, "low": 0.25, "moderate": 0.5, "medium": 0.5,
    "high": 0.75, "very high": 1.0, "extreme": 1.0,
    "yes": 1.0, "no": 0.0, "true": 1.0, "false": 0.0,
}

def normalize(key, val):
    if val is None:
        return FEATURE_MEANS[key]
    if isinstance(val, bool):
        return float(val)
    if isinstance(val, str):
        mapped = QUALITATIVE_MAP.get(val.strip().lower())
        if mapped is not None:
            return mapped
        try:
            val = float(val)
        except ValueError:
            return FEATURE_MEANS[key]
    if key == "sleep_hours":
        return min(float(val), 10.0) / 10.0
    if key in ("stress_level", "anxiety_level"):
        return float(val) / 5.0
    return float(val)

def _encode_background(flare):
    """Encode background fields into a fixed-length numeric vector (18 dims)."""
    bg = flare.get("background", {}) or {}

    # age_bucket: 4-dim one-hot
    age = bg.get("age_range", "")
    age_vec = [1.0 if a == age else 0.0 for a in AGE_RANGES[:4]]  # 4 dims (60+ merged with 46-60)

    # sex: 1 binary
    sex_vec = [1.0 if bg.get("sex") == "female" else 0.0]

    # ibs_subtype: 4-dim one-hot
    subtype = bg.get("ibs_subtype", "")
    subtype_vec = [1.0 if s == subtype else 0.0 for s in IBS_SUBTYPES]

    # diagnosed: 1 binary
    diagnosed_vec = [1.0 if bg.get("diagnosed") else 0.0]

    # onset_period: 5-dim one-hot
    onset = bg.get("onset_period", "")
    onset_vec = [1.0 if o == onset else 0.0 for o in ONSET_PERIODS]

    return np.array(age_vec + sex_vec + subtype_vec + diagnosed_vec + onset_vec)  # 15 dims


def _interaction_features(flare):
    """Compute cross-axis interaction terms (3 dims)."""
    kt = flare.get("extracted", {}).get("known_triggers", {})
    stress = normalize("stress_level", kt.get("stress_level"))
    fodmap = normalize("fodmap_load", kt.get("fodmap_load"))
    caffeine = float(kt.get("caffeine_before_food", False) == True)
    sleep_deficit = 1.0 - normalize("sleep_hours", kt.get("sleep_hours"))
    anxiety = normalize("anxiety_level", kt.get("anxiety_level"))

    return np.array([
        stress * fodmap,            # stress × fodmap
        caffeine * sleep_deficit,   # caffeine × sleep_deficit
        anxiety * fodmap,           # anxiety × fodmap
    ])


def build_layer1(flare):
    kt = flare.get("extracted", {}).get("known_triggers", {})
    base = np.array([normalize(k, kt.get(k)) for k in FEATURE_KEYS])  # 16 dims
    bg = _encode_background(flare)       # 15 dims
    interactions = _interaction_features(flare)  # 3 dims
    return np.concatenate([base, bg, interactions])  # 34 dims total

def embed_text(text):
    from openai import OpenAI
    openai_client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    resp = openai_client.embeddings.create(
        model="text-embedding-3-small",
        input=text[:2000]
    )
    return np.array(resp.data[0].embedding)

def build_vectors(flares):
    # Check vector version to auto-invalidate stale caches
    version_path = os.path.join(_cache_dir(), "vector_version.txt")
    cached_version = None
    if os.path.exists(version_path):
        with open(version_path) as f:
            cached_version = f.read().strip()

    if cached_version == str(VECTOR_VERSION):
        cached = load_np_cache("vectors.npy")
        if cached is not None:
            return cached
    elif cached_version is not None:
        print(f"Vector version changed ({cached_version} → {VECTOR_VERSION}), invalidating caches...")
        for stale in ["vectors.npy", "pipeline.pkl"]:
            p = os.path.join(_cache_dir(), stale)
            if os.path.exists(p):
                os.remove(p)
                print(f"  Deleted {p}")

    vecs = []
    for i, flare in enumerate(flares):
        print(f"Embedding {i+1}/{len(flares)}: {flare['id']}")
        ex = flare.get("extracted", {})

        layer1 = build_layer1(flare) * 8.0  # structured features — dominant weight

        open_text = " ".join([
            *ex.get("dietary_details", []),
            *ex.get("physiological_details", []),
            *ex.get("psychological_details", []),
            *ex.get("behavioral_details", []),
            *ex.get("novel_factors", [])
        ]).strip()
        layer2 = embed_text(open_text) * 0.5 if open_text else np.zeros(1536)

        raw = flare.get("narrative", "") or ex.get("open_narrative_summary", "")
        layer3 = embed_text(raw) * 0.25 if raw else np.zeros(1536)

        vecs.append(np.concatenate([layer1, layer2, layer3]))
        time.sleep(0.1)  # light rate limiting

    matrix = np.array(vecs)
    save_np_cache(matrix, "vectors.npy")
    # Save version marker
    version_path = os.path.join(_cache_dir(), "vector_version.txt")
    os.makedirs(os.path.dirname(version_path) or ".", exist_ok=True)
    with open(version_path, "w") as f:
        f.write(str(VECTOR_VERSION))
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
        labels, _ = hdbscan_mod.approximate_predict(clusterer, coords)
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

    print("Fitting HDBSCAN on UMAP coordinates...")
    clusterer = hdbscan_mod.HDBSCAN(
        min_cluster_size=15,
        min_samples=3,
        metric="euclidean",
        cluster_selection_method="leaf",
        prediction_data=True
    ).fit(coords)
    labels = clusterer.labels_

    with open(pipeline_path, "wb") as f:
        pickle.dump({"reducer": reducer, "clusterer": clusterer}, f)
    print(f"Pipeline cached. Discovered {len(set(labels)) - (1 if -1 in labels else 0)} clusters")

    return reducer, clusterer, coords, labels

# ── AXIS SCORES ────────────────────────────────────────────────────────────

def compute_axis_scores(flare):
    """Compute independent sensitivity axis scores (0-1 each) from structured features."""
    kt = flare.get("extracted", {}).get("known_triggers", {})
    fodmap = normalize("fodmap_load", kt.get("fodmap_load"))
    stress = max(
        normalize("stress_level", kt.get("stress_level")),
        normalize("anxiety_level", kt.get("anxiety_level"))
    )
    caffeine_sleep = max(
        float(kt.get("caffeine_before_food", False) == True),
        1.0 - normalize("sleep_hours", kt.get("sleep_hours"))  # low sleep → high score
    )
    return {
        "fodmap": round(fodmap, 2),
        "stress_gut": round(stress, 2),
        "caffeine_sleep": round(caffeine_sleep, 2)
    }

# ── STEP 5B: DYNAMIC CLUSTER LABELING ─────────────────────────────────────

def label_clusters(flares, labels, skip_labeling=False):
    """Generate descriptive labels for each discovered cluster using Claude."""
    unique_labels = sorted(set(labels))
    cluster_metadata = {}

    # Compute centroid of structured features (first 34 dims of layer1) per cluster
    cluster_centroids = {}
    for cluster_id in unique_labels:
        members = [f for f, l in zip(flares, labels) if l == cluster_id]
        if not members:
            continue
        vecs = np.array([build_layer1(f) for f in members])
        centroid = vecs.mean(axis=0)

        # Build feature summary from centroid
        feature_names = FEATURE_KEYS + [
            "age_18-25", "age_26-35", "age_36-45", "age_46-60",
            "sex_female",
            "ibs_D", "ibs_C", "ibs_M", "ibs_U",
            "diagnosed",
            "onset_<1yr", "onset_1-3yr", "onset_3-5yr", "onset_5-10yr", "onset_10yr+",
            "stress_x_fodmap", "caffeine_x_sleep", "anxiety_x_fodmap",
        ]
        centroid_features = {name: round(float(centroid[i]), 3) for i, name in enumerate(feature_names)}
        cluster_centroids[cluster_id] = centroid_features

    # Noise cluster
    if -1 in unique_labels:
        noise_count = list(labels).count(-1)
        cluster_metadata["-1"] = {
            "label": "UNCLASSIFIED",
            "color": "#888888",
            "description": "Flares that don't fit neatly into any discovered cluster pattern",
            "size": noise_count,
            "centroid_features": cluster_centroids.get(-1, {}),
        }

    non_noise = [l for l in unique_labels if l != -1]

    if skip_labeling or not non_noise:
        # Fallback labels
        for i, cluster_id in enumerate(non_noise):
            cluster_metadata[str(cluster_id)] = {
                "label": f"Cluster {cluster_id}",
                "color": DEFAULT_CLUSTER_PALETTE[i % len(DEFAULT_CLUSTER_PALETTE)],
                "description": f"Auto-discovered cluster {cluster_id}",
                "size": list(labels).count(cluster_id),
                "centroid_features": cluster_centroids.get(cluster_id, {}),
            }
        return cluster_metadata

    # Use Claude to generate descriptive labels
    try:
        import anthropic
        anthropic_client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

        summaries = []
        for cluster_id in non_noise:
            cf = cluster_centroids.get(cluster_id, {})
            top_features = sorted(cf.items(), key=lambda x: abs(x[1]), reverse=True)[:5]
            size = list(labels).count(cluster_id)
            summaries.append(f"Cluster {cluster_id} (n={size}): top features = {top_features}")

        prompt = f"""You are analyzing IBS flare-up clusters discovered by HDBSCAN. Each cluster has a centroid with these features.

{chr(10).join(summaries)}

For each cluster, provide a JSON object with:
- "label": short uppercase name (2-4 words, e.g. "CAFFEINE / SLEEP")
- "color": hex color code (distinct from other clusters)
- "description": 1 sentence describing this phenotype

Return ONLY a JSON array of objects in cluster order. No markdown, no preamble."""

        resp = anthropic_client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1000,
            messages=[{"role": "user", "content": prompt}]
        )
        text = resp.content[0].text.strip().replace("```json", "").replace("```", "").strip()
        label_data = json.loads(text)

        for i, cluster_id in enumerate(non_noise):
            entry = label_data[i] if i < len(label_data) else {}
            cluster_metadata[str(cluster_id)] = {
                "label": entry.get("label", f"Cluster {cluster_id}"),
                "color": entry.get("color", DEFAULT_CLUSTER_PALETTE[i % len(DEFAULT_CLUSTER_PALETTE)]),
                "description": entry.get("description", f"Auto-discovered cluster {cluster_id}"),
                "size": list(labels).count(cluster_id),
                "centroid_features": cluster_centroids.get(cluster_id, {}),
            }
    except Exception as e:
        print(f"Cluster labeling failed, using fallback labels: {e}")
        for i, cluster_id in enumerate(non_noise):
            cluster_metadata[str(cluster_id)] = {
                "label": f"Cluster {cluster_id}",
                "color": DEFAULT_CLUSTER_PALETTE[i % len(DEFAULT_CLUSTER_PALETTE)],
                "description": f"Auto-discovered cluster {cluster_id}",
                "size": list(labels).count(cluster_id),
                "centroid_features": cluster_centroids.get(cluster_id, {}),
            }

    return cluster_metadata


# ── STEP 6: BUILD OUTPUT ────────────────────────────────────────────────────

def build_output(flares, coords, labels, clusterer, cluster_metadata=None):
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

        # Use dynamic cluster metadata color if available, fall back to hardcoded
        if cluster_metadata and str(cluster_id) in cluster_metadata:
            color = cluster_metadata[str(cluster_id)]["color"]
        else:
            color = CLUSTER_COLORS.get(cluster_id, "#888888")

        output.append({
            "id": flare["id"],
            "x": float(coords_scaled[i][0]),
            "y": float(coords_scaled[i][1]),
            "z": float(coords_scaled[i][2]),
            "clusterId": cluster_id,
            "color": color,
            "confidence": confidence,
            "synthetic": flare.get("synthetic", False),
            "symptoms": symptoms[:3],
            "label": " + ".join(symptoms[:2]) if symptoms else "flare",
            "summary": ex.get("open_narrative_summary", ""),
            "novel_factors": ex.get("novel_factors", []),
            "axis_scores": compute_axis_scores(flare)
        })

    return output

# ── PIPELINE ─────────────────────────────────────────────────────────────────

def run_pipeline(skip_labeling=False):
    """Run the full preprocessing pipeline, return JSON-serializable output and cluster metadata."""
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

    print("\n=== Step 5B: Cluster labeling ===")
    cluster_metadata = label_clusters(all_flares, labels, skip_labeling=skip_labeling)
    print(f"Labeled {len(cluster_metadata)} clusters")

    print("\n=== Step 6: Building output ===")
    output = build_output(all_flares, coords, labels, clusterer, cluster_metadata)
    print(f"Built {len(output)} nodes")
    print(f"Cluster distribution: { {k: list(labels).count(k) for k in sorted(set(labels))} }")

    return output, cluster_metadata

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

def _write_outputs(output, cluster_metadata):
    """Write both output files to public/."""
    os.makedirs("public", exist_ok=True)
    with open("public/flares_processed.json", "w") as f:
        json.dump(output, f)
    with open("public/cluster_metadata.json", "w") as f:
        json.dump(cluster_metadata, f, indent=2)
    print(f"\nWritten {len(output)} nodes to public/flares_processed.json")
    print(f"Written cluster metadata ({len(cluster_metadata)} clusters) to public/cluster_metadata.json")

@app.local_entrypoint()
def main():
    """Modal entrypoint — calls the remote function and writes the result locally."""
    print("Running pipeline on Modal...")
    output, cluster_metadata = run_pipeline_modal.remote()
    _write_outputs(output, cluster_metadata)
    print("Done. Start the app with: npm run dev")

# ── LOCAL EXECUTION ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-labeling", action="store_true",
                        help="Skip Claude cluster labeling for fast iteration")
    args = parser.parse_args()

    output, cluster_metadata = run_pipeline(skip_labeling=args.skip_labeling)
    _write_outputs(output, cluster_metadata)
    print("Done. Start the app with: npm run dev")
