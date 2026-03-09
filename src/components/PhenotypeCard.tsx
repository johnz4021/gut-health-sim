"use client";

import { motion } from "framer-motion";
import { SensitivityProfile, migrateLegacyScores } from "@/lib/types";
import { DIMENSION_KEYS, DIMENSION_COLORS, DIMENSION_LABELS } from "@/lib/constants";

interface Props {
  profile: SensitivityProfile;
}

export default function ProfileCard({ profile }: Props) {
  const scores = migrateLegacyScores(profile.axis_scores as unknown as Record<string, number>);

  // Find highest dimension for gradient color
  let maxDim = "diet_fodmap";
  let maxScore = 0;
  for (const key of DIMENSION_KEYS) {
    if (scores[key] > maxScore) {
      maxScore = scores[key];
      maxDim = key;
    }
  }
  const color = DIMENSION_COLORS[maxDim];

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="mx-4 mb-4 rounded-xl p-4"
      style={{
        background: `linear-gradient(135deg, ${color}15, ${color}08)`,
        border: `1px solid ${color}40`,
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">&#x1F9EC;</span>
        <h3
          className="font-display text-sm tracking-wider"
          style={{ color }}
        >
          YOUR SENSITIVITY PROFILE
        </h3>
      </div>

      {/* Dimension score bars */}
      <div className="space-y-1.5 mb-3">
        {DIMENSION_KEYS.map((key) => {
          const score = scores[key] || 0;
          const pct = Math.round(score * 100);
          const dimColor = DIMENSION_COLORS[key];
          return (
            <div key={key}>
              <div className="flex justify-between items-center mb-0.5">
                <span className="text-[10px] tracking-wider text-white/50">
                  {DIMENSION_LABELS[key]}
                </span>
                <span className="text-[10px] font-mono" style={{ color: dimColor }}>
                  {pct}%
                </span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden bg-white/5">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: dimColor,
                    transition: "width 0.5s ease",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Primary trigger */}
      <p className="text-xs text-white/80 mb-1">
        <span className="text-white/40">Primary: </span>
        {profile.primary_trigger}
      </p>

      {/* Amplifiers */}
      {profile.amplifiers.length > 0 && (
        <p className="text-xs text-white/60 mb-1">
          <span className="text-white/40">Amplifiers: </span>
          {profile.amplifiers.join("; ")}
        </p>
      )}

      {/* Confidence & triggers */}
      <p className="text-xs text-white/60">
        Confidence {(profile.confidence * 100).toFixed(0)}%
        {profile.triggers.length > 0 && (
          <span>
            {" "}&middot; Triggers: {profile.triggers.join(", ")}
          </span>
        )}
      </p>
    </motion.div>
  );
}
