import { DimensionScores, ClusterMetadata } from "./types";

/** Maps each dimension → weighted feature keys used by the HDBSCAN clustering */
export const DIMENSION_FEATURE_MAP: Record<keyof DimensionScores, string[]> = {
  diet_fodmap: ["fodmap_load", "fat_content", "alcohol"],
  meal_mechanics: ["meal_size", "eating_speed", "carbonated", "meal_skipped"],
  stress_anxiety: ["stress_level", "anxiety_level"],
  sleep_caffeine: ["sleep_hours", "sleep_quality", "caffeine_before_food"],
  routine_travel: ["travel", "disrupted_routine", "recent_antibiotics"],
  exercise_recovery: ["exercise_today"],
};

/** Expand 6 dimension scores → 16 features + 3 interaction terms */
export function expandToFeatureVector(
  scores: DimensionScores
): Record<string, number> {
  const features: Record<string, number> = {};

  for (const [dim, featureKeys] of Object.entries(DIMENSION_FEATURE_MAP)) {
    const dimScore = scores[dim as keyof DimensionScores];
    for (const fk of featureKeys) {
      features[fk] = dimScore;
    }
  }

  // Interaction terms (computed from dimension scores)
  features.stress_x_fodmap = scores.stress_anxiety * scores.diet_fodmap;
  features.caffeine_x_sleep = scores.sleep_caffeine * scores.sleep_caffeine; // self-interaction intensity
  features.anxiety_x_fodmap = scores.stress_anxiety * scores.diet_fodmap;

  return features;
}

/** Dot-product scoring of dimension scores against cluster centroids. Returns best cluster ID. */
export function matchCluster(
  scores: DimensionScores,
  clusterMeta: Record<string, ClusterMetadata>
): number {
  const features = expandToFeatureVector(scores);

  let bestCluster = -1;
  let bestScore = -Infinity;

  for (const [clusterIdStr, meta] of Object.entries(clusterMeta)) {
    const cid = Number(clusterIdStr);
    if (cid === -1) continue;
    const cf = meta.centroid_features;
    if (!cf) continue;

    let score = 0;
    for (const [fk, fv] of Object.entries(features)) {
      score += (cf[fk] ?? 0) * fv;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCluster = cid;
    }
  }

  return bestCluster;
}
