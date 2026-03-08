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

// 3 phenotypes at 120-degree intervals (radians)
export const SECTOR_ANGLES: Record<number, number> = {
  0: (90 * Math.PI) / 180,   // top
  1: (210 * Math.PI) / 180,  // bottom-left
  2: (330 * Math.PI) / 180,  // bottom-right
};

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";
