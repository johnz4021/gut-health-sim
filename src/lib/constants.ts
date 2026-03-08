export const CLUSTER_COLORS: Record<number, string> = {
  0: "#FF6B6B",  // Caffeine / Sleep — red
  1: "#4ECDC4",  // FODMAP — teal
  2: "#FFE66D",  // Stress / Gut-Brain — yellow
  [-1]: "#888888", // Noise / unassigned — grey
};

export const CLUSTER_LABELS: Record<number, string> = {
  0: "CAFFEINE / SLEEP",
  1: "FODMAP",
  2: "STRESS / GUT-BRAIN",
};

// Sensitivity axes (independent, not competing)
export const AXIS_KEYS = ["fodmap", "stress_gut", "caffeine_sleep"] as const;

export const AXIS_COLORS: Record<string, string> = {
  fodmap: "#4ECDC4",        // teal
  stress_gut: "#FFE66D",    // yellow
  caffeine_sleep: "#FF6B6B", // red
};

export const AXIS_LABELS: Record<string, string> = {
  fodmap: "FODMAP",
  stress_gut: "STRESS / GUT",
  caffeine_sleep: "CAFFEINE / SLEEP",
};

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";
