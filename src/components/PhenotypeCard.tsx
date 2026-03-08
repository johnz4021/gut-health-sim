"use client";

import { motion } from "framer-motion";
import { PhenotypeMatch } from "@/lib/types";

interface Props {
  match: PhenotypeMatch;
}

const LABEL_COLORS: Record<string, string> = {
  "Caffeine/Sleep-Sensitive IBS": "#FF6B6B",
  "FODMAP-Sensitive IBS": "#4ECDC4",
  "Stress/Gut-Brain IBS": "#FFE66D",
};

export default function PhenotypeCard({ match }: Props) {
  const color = LABEL_COLORS[match.label] || "#4ECDC4";

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
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">&#x1F9EC;</span>
        <h3
          className="font-display text-sm tracking-wider"
          style={{ color }}
        >
          {match.label}
        </h3>
      </div>
      <p className="text-xs text-white/60 mb-2">
        {Math.round(match.population_pct * 100)}% of cohort &middot; Confidence{" "}
        {(match.confidence * 100).toFixed(0)}%
      </p>
      <p className="text-xs text-white/80">
        <span className="text-white/40">Triggers: </span>
        {match.triggers.join(", ")}
      </p>
    </motion.div>
  );
}
