export interface AxisScores {
  fodmap: number;
  stress_gut: number;
  caffeine_sleep: number;
}

export interface SensitivityProfile {
  axis_scores: AxisScores;
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
}

export interface UserProfileSummary {
  user_id: string;
  flare_count: number;
  has_background: boolean;
  background?: UserBackground;
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
  axis_scores?: AxisScores;
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

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface ChatResponse {
  reply: string;
  state: "SYMPTOM_INTAKE" | "QUESTIONING" | "ONBOARDING" | "CONVERGED";
  axis_scores: AxisScores;
  converged: boolean;
  sensitivity_profile: SensitivityProfile | null;
}
