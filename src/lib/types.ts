export interface FlareNode {
  id: string;
  label: string;
  symptoms: string[];
  clusterId: number;
  color: string;
  confidence: number;
  synthetic: boolean;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __threeObj?: any;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface PhenotypeMatch {
  label: string;
  confidence: number;
  triggers: string[];
  population_pct: number;
}

export interface ChatResponse {
  reply: string;
  state: "SYMPTOM_INTAKE" | "QUESTIONING" | "CONVERGED";
  phenotype_probs: Record<string, number>;
  converged: boolean;
  phenotype_match: PhenotypeMatch | null;
}
