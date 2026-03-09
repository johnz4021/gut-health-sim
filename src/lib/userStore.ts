import { AxisScores, FlareRecord, UserBackground, UserProfileSummary } from "./types";

interface UserProfile {
  user_id: string;
  background: UserBackground | null;
  flare_history: FlareRecord[];
  personal_baseline: AxisScores | null;
  known_triggers: string[];
  high_confidence_axes: string[];
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
      high_confidence_axes: [],
      created_at: new Date().toISOString(),
    });
  }
  return users.get(user_id)!;
}

export function updateBackground(user_id: string, bg: UserBackground): void {
  const user = getOrCreateUser(user_id);
  user.background = bg;
}

/** Recompute baseline, known triggers, and high-confidence axes from flare history */
function recomputeBaseline(user: UserProfile): void {
  const history = user.flare_history;
  if (history.length === 0) {
    user.personal_baseline = null;
    user.known_triggers = [];
    user.high_confidence_axes = [];
    return;
  }

  // Rolling mean of axis scores
  const sum: AxisScores = { fodmap: 0, stress_gut: 0, caffeine_sleep: 0 };
  for (const flare of history) {
    sum.fodmap += flare.axis_scores.fodmap;
    sum.stress_gut += flare.axis_scores.stress_gut;
    sum.caffeine_sleep += flare.axis_scores.caffeine_sleep;
  }
  const n = history.length;
  user.personal_baseline = {
    fodmap: sum.fodmap / n,
    stress_gut: sum.stress_gut / n,
    caffeine_sleep: sum.caffeine_sleep / n,
  };

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

  // High-confidence axes: axes consistently scoring > 0.5
  const axes: (keyof AxisScores)[] = ["fodmap", "stress_gut", "caffeine_sleep"];
  user.high_confidence_axes = axes.filter(
    (axis) => user.personal_baseline![axis] > 0.5
  );
}

/** Record a flare and recompute derived stats */
export function recordFlare(user_id: string, record: FlareRecord): void {
  const user = getOrCreateUser(user_id);
  user.flare_history.push(record);
  recomputeBaseline(user);
}

/** Get initial axis scores informed by personal history and background */
export function getInitialAxisScores(user_id: string): AxisScores {
  const user = getOrCreateUser(user_id);

  // Returning users: start from personal baseline
  const scores: AxisScores = user.personal_baseline
    ? { ...user.personal_baseline }
    : { fodmap: 0.5, stress_gut: 0.5, caffeine_sleep: 0.5 };

  if (!user.background) return scores;
  const bg = user.background;

  // IBS subtype modifiers
  if (bg.ibs_subtype === "IBS-D") {
    scores.caffeine_sleep = Math.min(1, scores.caffeine_sleep + 0.05);
  } else if (bg.ibs_subtype === "IBS-C") {
    scores.fodmap = Math.min(1, scores.fodmap + 0.05);
  }

  // Medication modifiers
  if (bg.active_medications?.some((m) => /ssri|sertraline|fluoxetine|escitalopram|paroxetine/i.test(m))) {
    scores.stress_gut = Math.max(0, scores.stress_gut - 0.05);
  }

  // Dietary baseline modifiers
  if (bg.dietary_baseline && /low.?fodmap/i.test(bg.dietary_baseline)) {
    scores.fodmap = Math.max(0, scores.fodmap - 0.1);
  }

  // Comorbidity modifiers
  if (bg.diagnosed_comorbidities?.some((c) => /anxiety|gad|panic/i.test(c))) {
    scores.stress_gut = Math.min(1, scores.stress_gut + 0.1);
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
    high_confidence_axes: user.high_confidence_axes.length > 0 ? user.high_confidence_axes : undefined,
    flare_history: user.flare_history.length > 0 ? user.flare_history : undefined,
  };
}
