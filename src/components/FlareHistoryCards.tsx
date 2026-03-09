"use client";

import { motion } from "framer-motion";
import { FlareRecord } from "@/lib/types";
import { AXIS_KEYS, AXIS_COLORS, AXIS_LABELS } from "@/lib/constants";

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export default function FlareHistoryCards({ history }: { history: FlareRecord[] }) {
  if (history.length === 0) return null;

  return (
    <div className="mt-4 space-y-2 px-2">
      <p className="font-display text-[11px] tracking-widest text-[#C084FC]/70 text-center mb-2">
        PAST FLARES
      </p>
      {history.map((flare, i) => (
        <motion.div
          key={flare.session_id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.08 }}
          className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#C084FC]/15 border border-[#C084FC]/30 text-[#C084FC] font-medium tracking-wide">
              {flare.primary_trigger}
            </span>
            <span className="text-[10px] text-white/30">
              {relativeDate(flare.timestamp)}
            </span>
          </div>

          {/* Axis bars */}
          <div className="space-y-1 mb-2">
            {AXIS_KEYS.map((key) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-[9px] text-white/30 w-20 text-right truncate">
                  {AXIS_LABELS[key]}
                </span>
                <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(flare.axis_scores[key] ?? 0.5) * 100}%`,
                      backgroundColor: AXIS_COLORS[key],
                      opacity: 0.7,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Symptom tags */}
          {flare.symptoms.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {flare.symptoms.slice(0, 3).map((s) => (
                <span
                  key={s}
                  className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.04] text-white/30"
                >
                  {s}
                </span>
              ))}
            </div>
          )}
        </motion.div>
      ))}
    </div>
  );
}
