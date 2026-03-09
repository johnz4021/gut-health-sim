import { DimensionScores, FlareRecord, UserBackground, UserProfileSummary, migrateLegacyScores } from "./types";
import { DIMENSION_KEYS } from "./constants";

interface UserProfile {
  user_id: string;
  background: UserBackground | null;
  flare_history: FlareRecord[];
  personal_baseline: DimensionScores | null;
  known_triggers: string[];
  high_confidence_dimensions: string[];
  created_at: string;
}

// Use globalThis to survive Next.js HMR in dev mode
const globalStore = globalThis as unknown as { __gutmap_users?: Map<string, UserProfile> };
if (!globalStore.__gutmap_users) {
  globalStore.__gutmap_users = new Map<string, UserProfile>();
}
const users = globalStore.__gutmap_users;

export function getOrCreateUser(user_id: string): UserProfile {
  if (!users.has(user_id)) {
    users.set(user_id, {
      user_id,
      background: null,
      flare_history: [],
      personal_baseline: null,
      known_triggers: [],
      high_confidence_dimensions: [],
      created_at: new Date().toISOString(),
    });
  }
  return users.get(user_id)!;
}

export function updateBackground(user_id: string, bg: UserBackground): void {
  const user = getOrCreateUser(user_id);
  user.background = bg;
}

/** Recompute baseline, known triggers, and high-confidence dimensions from flare history */
function recomputeBaseline(user: UserProfile): void {
  const history = user.flare_history;
  if (history.length === 0) {
    user.personal_baseline = null;
    user.known_triggers = [];
    user.high_confidence_dimensions = [];
    return;
  }

  // Rolling mean of dimension scores
  const sum: Record<string, number> = {};
  for (const key of DIMENSION_KEYS) sum[key] = 0;

  for (const flare of history) {
    // Migrate legacy scores if needed
    const scores = migrateLegacyScores(flare.axis_scores as unknown as Record<string, number>);
    for (const key of DIMENSION_KEYS) {
      sum[key] += scores[key];
    }
  }

  const n = history.length;
  const baseline = {} as Record<string, number>;
  for (const key of DIMENSION_KEYS) {
    baseline[key] = sum[key] / n;
  }
  user.personal_baseline = baseline as unknown as DimensionScores;

  // Known triggers: triggers confirmed in 2+ flares
  const triggerCounts = new Map<string, number>();
  for (const flare of history) {
    for (const trigger of flare.confirmed_triggers) {
      triggerCounts.set(trigger, (triggerCounts.get(trigger) ?? 0) + 1);
    }
  }
  user.known_triggers = Array.from(triggerCounts.entries())
    .filter(([, count]) => count >= 2)
    .map(([trigger]) => trigger);

  // High-confidence dimensions: dimensions consistently scoring > 0.5
  user.high_confidence_dimensions = DIMENSION_KEYS.filter(
    (dim) => user.personal_baseline![dim] > 0.5
  );
}

/** Record a flare and recompute derived stats */
export function recordFlare(user_id: string, record: FlareRecord): void {
  const user = getOrCreateUser(user_id);
  user.flare_history.push(record);
  recomputeBaseline(user);
}

/** Get initial axis scores informed by personal history and background */
export function getInitialAxisScores(user_id: string): DimensionScores {
  const user = getOrCreateUser(user_id);

  // Returning users: start from personal baseline
  const scores: DimensionScores = user.personal_baseline
    ? { ...user.personal_baseline }
    : {
        diet_fodmap: 0.5,
        meal_mechanics: 0.5,
        stress_anxiety: 0.5,
        sleep_caffeine: 0.5,
        routine_travel: 0.5,
        exercise_recovery: 0.5,
      };

  if (!user.background) return scores;
  const bg = user.background;

  // IBS subtype modifiers
  if (bg.ibs_subtype === "IBS-D") {
    scores.sleep_caffeine = Math.min(1, scores.sleep_caffeine + 0.05);
  } else if (bg.ibs_subtype === "IBS-C") {
    scores.diet_fodmap = Math.min(1, scores.diet_fodmap + 0.05);
  }

  // Medication modifiers
  if (bg.active_medications?.some((m) => /ssri|sertraline|fluoxetine|escitalopram|paroxetine/i.test(m))) {
    scores.stress_anxiety = Math.max(0, scores.stress_anxiety - 0.05);
  }

  // Dietary baseline modifiers
  if (bg.dietary_baseline && /low.?fodmap/i.test(bg.dietary_baseline)) {
    scores.diet_fodmap = Math.max(0, scores.diet_fodmap - 0.1);
  }

  // Comorbidity modifiers
  if (bg.diagnosed_comorbidities?.some((c) => /anxiety|gad|panic/i.test(c))) {
    scores.stress_anxiety = Math.min(1, scores.stress_anxiety + 0.1);
  }

  return scores;
}

/** Legacy addFlare — kept for backward compatibility but prefer recordFlare */
export function addFlare(user_id: string, record: FlareRecord): void {
  recordFlare(user_id, record);
}

export function getUserSummary(user_id: string): UserProfileSummary {
  const user = getOrCreateUser(user_id);
  return {
    user_id: user.user_id,
    flare_count: user.flare_history.length,
    has_background: user.background !== null,
    background: user.background ?? undefined,
    personal_baseline: user.personal_baseline ?? undefined,
    known_triggers: user.known_triggers.length > 0 ? user.known_triggers : undefined,
    high_confidence_dimensions: user.high_confidence_dimensions.length > 0 ? user.high_confidence_dimensions : undefined,
    flare_history: user.flare_history.length > 0 ? user.flare_history : undefined,
  };
}
