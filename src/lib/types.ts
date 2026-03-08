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
  state: "SYMPTOM_INTAKE" | "QUESTIONING" | "CONVERGED";
  axis_scores: AxisScores;
  converged: boolean;
  sensitivity_profile: SensitivityProfile | null;
}
