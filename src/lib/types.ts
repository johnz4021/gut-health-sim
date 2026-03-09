export interface DimensionScores {
  diet_fodmap: number;
  meal_mechanics: number;
  stress_anxiety: number;
  sleep_caffeine: number;
  routine_travel: number;
  exercise_recovery: number;
}

/** Legacy 3-axis scores from before the 6-dimension expansion */
export interface LegacyAxisScores {
  fodmap: number;
  stress_gut: number;
  caffeine_sleep: number;
}

/** Type alias — all new code should use DimensionScores directly */
export type AxisScores = DimensionScores;

export function isLegacyScores(
  scores: Record<string, number>
): boolean {
  return "fodmap" in scores && "stress_gut" in scores && !("diet_fodmap" in scores);
}

/** Convert old 3-axis records to 6-dimension format (new dims default to 0.5) */
export function migrateLegacyScores(scores: Record<string, number>): DimensionScores {
  if (!isLegacyScores(scores)) return scores as unknown as DimensionScores;
  return {
    diet_fodmap: scores.fodmap,
    meal_mechanics: 0.5,
    stress_anxiety: scores.stress_gut,
    sleep_caffeine: scores.caffeine_sleep,
    routine_travel: 0.5,
    exercise_recovery: 0.5,
  };
}

export interface SensitivityProfile {
  axis_scores: DimensionScores;
  primary_trigger: string;
  amplifiers: string[];
  confidence: number;
  triggers: string[];
}

export interface UserBackground {
  age_range?: string;
  sex?: string;
  ibs_subtype?: string;
  diagnosed?: boolean;
  onset_period?: string;
  known_triggers?: string[];
  active_medications?: string[];
  dietary_baseline?: string | null;
  tracks_menstrual_cycle?: boolean | null;
  diagnosed_comorbidities?: string[];
}

export interface FlareRecord {
  session_id: string;
  timestamp: string;
  axis_scores: DimensionScores;
  symptoms: string[];
  confirmed_triggers: string[];
  primary_trigger: string;
  amplifiers: string[];
  summary: string;
}

export interface UserProfileSummary {
  user_id: string;
  flare_count: number;
  has_background: boolean;
  background?: UserBackground;
  personal_baseline?: DimensionScores;
  known_triggers?: string[];
  high_confidence_dimensions?: string[];
  flare_history?: FlareRecord[];
}

export interface ClusterMetadata {
  label: string;
  color: string;
  description: string;
  size: number;
  centroid_features?: Record<string, number>;
}

export interface FlaresResponse {
  flares: FlareNode[];
  cluster_metadata: Record<string, ClusterMetadata>;
}

export interface FlareNode {
  id: string;
  label: string;
  symptoms: string[];
  clusterId: number;
  color: string;
  confidence: number;
  synthetic: boolean;
  summary?: string;
  novel_factors?: string[];
  axis_scores?: DimensionScores;
  user_id?: string;
  created_at?: string;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  fx?: number;
  fy?: number;
  fz?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __threeObj?: any;
}

export interface Persona {
  display_name: string;
  bio: string;
  background: Partial<UserBackground>;
  what_helps: string[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface ChatResponse {
  reply: string;
  state: "SYMPTOM_INTAKE" | "QUESTIONING" | "ONBOARDING" | "CONVERGED";
  axis_scores: DimensionScores;
  converged: boolean;
  sensitivity_profile: SensitivityProfile | null;
}
