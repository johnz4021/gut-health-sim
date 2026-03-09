export const DEFAULT_NOISE_COLOR = "#888888";

// Sensitivity dimensions (independent, not competing)
export const DIMENSION_KEYS = [
  "diet_fodmap",
  "meal_mechanics",
  "stress_anxiety",
  "sleep_caffeine",
  "routine_travel",
  "exercise_recovery",
] as const;

export const DIMENSION_COLORS: Record<string, string> = {
  diet_fodmap: "#4ECDC4",        // teal
  meal_mechanics: "#FF9F43",     // orange
  stress_anxiety: "#FFE66D",     // yellow
  sleep_caffeine: "#FF6B6B",     // red
  routine_travel: "#A55EEA",     // purple
  exercise_recovery: "#26DE81",  // green
};

export const DIMENSION_LABELS: Record<string, string> = {
  diet_fodmap: "DIET / FODMAP",
  meal_mechanics: "MEAL MECHANICS",
  stress_anxiety: "STRESS / ANXIETY",
  sleep_caffeine: "SLEEP / CAFFEINE",
  routine_travel: "ROUTINE / TRAVEL",
  exercise_recovery: "EXERCISE",
};

// Legacy aliases for backward compatibility during migration
export const AXIS_KEYS = DIMENSION_KEYS;
export const AXIS_COLORS = DIMENSION_COLORS;
export const AXIS_LABELS = DIMENSION_LABELS;

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";
