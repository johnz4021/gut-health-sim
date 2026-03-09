"use client";

import { DIMENSION_KEYS, DIMENSION_COLORS, DIMENSION_LABELS } from "@/lib/constants";
import { AxisScores, migrateLegacyScores } from "@/lib/types";

interface Props {
  axisScores: AxisScores;
}

export default function SensitivityBar({ axisScores }: Props) {
  const scores = migrateLegacyScores(axisScores as unknown as Record<string, number>);
  return (
    <div className="px-4 py-3 space-y-2">
      {DIMENSION_KEYS.map((key) => {
        const score = scores[key] || 0;
        const pct = Math.round(score * 100);
        const color = DIMENSION_COLORS[key];
        return (
          <div key={key}>
            <div className="flex justify-between items-center mb-0.5">
              <span className="text-[10px] tracking-wider text-white/50">
                {DIMENSION_LABELS[key]}
              </span>
              <span className="text-[10px] font-mono" style={{ color }}>
                {pct}%
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden bg-white/5">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  backgroundColor: color,
                  transition: "width 0.5s ease",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
