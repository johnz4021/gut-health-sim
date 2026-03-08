"use client";

import { CLUSTER_COLORS, CLUSTER_LABELS } from "@/lib/constants";

interface Props {
  probs: Record<string, number>;
}

const PROB_KEYS = ["A", "B", "C"];
const CLUSTER_MAP: Record<string, number> = { A: 0, B: 1, C: 2 };

export default function ProbabilityBar({ probs }: Props) {
  return (
    <div className="px-4 py-3">
      {/* Stacked bar */}
      <div className="flex h-3 rounded-full overflow-hidden bg-white/5">
        {PROB_KEYS.map((key) => {
          const pct = (probs[key] || 0) * 100;
          const clusterId = CLUSTER_MAP[key];
          return (
            <div
              key={key}
              style={{
                width: `${pct}%`,
                backgroundColor: CLUSTER_COLORS[clusterId],
                transition: "width 0.5s ease",
              }}
            />
          );
        })}
      </div>
      {/* Labels */}
      <div className="flex justify-between mt-1.5 text-[10px] text-white/50">
        {PROB_KEYS.map((key) => {
          const pct = Math.round((probs[key] || 0) * 100);
          const clusterId = CLUSTER_MAP[key];
          return (
            <span key={key} style={{ color: CLUSTER_COLORS[clusterId] }}>
              {CLUSTER_LABELS[clusterId]} {pct}%
            </span>
          );
        })}
      </div>
    </div>
  );
}
