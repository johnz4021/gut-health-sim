"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FlareNode, ClusterMetadata, Persona, migrateLegacyScores } from "@/lib/types";
import { fetchPersona } from "@/lib/api";
import { DIMENSION_KEYS, DIMENSION_COLORS, DIMENSION_LABELS } from "@/lib/constants";

interface Props {
  node: FlareNode;
  clusterMetadata: Record<string, ClusterMetadata>;
  onClose: () => void;
}

export default function NodeDetailPanel({ node, clusterMetadata, onClose }: Props) {
  const [persona, setPersona] = useState<Persona | null>(null);
  const [, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const cluster = clusterMetadata[String(node.clusterId)];
  const clusterColor = cluster?.color || "#888";
  const clusterLabel = cluster?.label || "Unknown";
  const isSynthetic = node.synthetic;
  const ready = !isSynthetic || !!persona || error;

  useEffect(() => {
    if (!isSynthetic) return;
    setLoading(true);
    setError(false);
    setPersona(null);
    fetchPersona(node, clusterLabel)
      .then((p) => setPersona(p))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [node.id, clusterLabel, isSynthetic, node]);

  // Migrate legacy scores if present on synthetic nodes
  const nodeScores = node.axis_scores
    ? migrateLegacyScores(node.axis_scores as unknown as Record<string, number>)
    : null;

  return (
    <AnimatePresence>
      <motion.div
        key={node.id}
        initial={{ x: 320, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 320, opacity: 0 }}
        transition={{ type: "spring", damping: 28, stiffness: 300 }}
        className="absolute top-0 right-0 w-[320px] h-full bg-[#0a0a1a]/95 backdrop-blur-md border-l border-white/[0.06] overflow-y-auto z-50"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: clusterColor }} />
            <h3 className="text-white font-semibold text-sm truncate">
              {!ready ? "Loading profile..." : persona?.display_name || node.label}
            </h3>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-lg leading-none px-1">×</button>
        </div>

        <div className="p-4 space-y-4">
          {/* Full-panel loading skeleton — shown until everything is ready */}
          {!ready && (
            <div className="space-y-4 animate-pulse">
              {/* Bio placeholder */}
              <div className="space-y-1.5">
                <div className="h-3 bg-white/10 rounded w-full" />
                <div className="h-3 bg-white/10 rounded w-3/4" />
              </div>
              {/* Background grid placeholder */}
              <div>
                <div className="h-2 bg-white/8 rounded w-20 mb-2" />
                <div className="grid grid-cols-2 gap-2">
                  {[...Array(4)].map((_, i) => <div key={i} className="h-6 bg-white/5 rounded" />)}
                </div>
              </div>
              {/* Cluster placeholder */}
              <div className="h-5 bg-white/5 rounded-full w-24" />
              {/* Symptoms placeholder */}
              <div>
                <div className="h-2 bg-white/8 rounded w-16 mb-2" />
                <div className="flex gap-1">
                  {[...Array(3)].map((_, i) => <div key={i} className="h-5 bg-white/5 rounded-full w-16" />)}
                </div>
              </div>
              {/* Dimension bars placeholder */}
              <div className="space-y-2">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="h-2 bg-white/8 rounded w-20" />
                    <div className="flex-1 h-1.5 bg-white/5 rounded-full" />
                  </div>
                ))}
              </div>
              {/* Summary placeholder */}
              <div className="space-y-1.5">
                <div className="h-2 bg-white/8 rounded w-14 mb-1" />
                <div className="h-3 bg-white/5 rounded w-full" />
                <div className="h-3 bg-white/5 rounded w-5/6" />
              </div>
              {/* What Helps placeholder */}
              <div>
                <div className="h-2 bg-white/8 rounded w-20 mb-2" />
                <div className="flex gap-1">
                  {[...Array(3)].map((_, i) => <div key={i} className="h-5 bg-emerald-500/5 rounded-full w-20" />)}
                </div>
              </div>
            </div>
          )}

          {error && <p className="text-red-400 text-xs">Failed to generate profile. Try again.</p>}

          {/* Full content — only shown once everything is ready */}
          {ready && !error && (
            <>
              {/* Bio */}
              {persona?.bio && (
                <p className="text-white/60 text-xs leading-relaxed">{persona.bio}</p>
              )}

              {/* Background grid */}
              {persona?.background && (
                <div>
                  <h4 className="text-white/30 text-[10px] uppercase tracking-wider mb-2">Background</h4>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                    {persona.background.age_range && <Field label="Age" value={persona.background.age_range} />}
                    {persona.background.sex && <Field label="Sex" value={persona.background.sex} />}
                    {persona.background.ibs_subtype && <Field label="Subtype" value={persona.background.ibs_subtype} />}
                    {persona.background.onset_period && <Field label="Onset" value={persona.background.onset_period} />}
                    {persona.background.diagnosed !== undefined && <Field label="Diagnosed" value={persona.background.diagnosed ? "Yes" : "No"} />}
                  </div>
                </div>
              )}

              {/* Cluster */}
              <div>
                <h4 className="text-white/30 text-[10px] uppercase tracking-wider mb-2">Cluster</h4>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: clusterColor + "22", color: clusterColor }}>
                  {clusterLabel}
                </span>
              </div>

              {/* Symptoms */}
              {node.symptoms && node.symptoms.length > 0 && (
                <div>
                  <h4 className="text-white/30 text-[10px] uppercase tracking-wider mb-2">Symptoms</h4>
                  <div className="flex flex-wrap gap-1">
                    {node.symptoms.map((s) => (
                      <span key={s} className="text-[11px] px-2 py-0.5 rounded-full bg-white/[0.06] text-white/70">{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Dimension scores */}
              {nodeScores && (
                <div>
                  <h4 className="text-white/30 text-[10px] uppercase tracking-wider mb-2">Trigger Dimensions</h4>
                  <div className="space-y-1.5">
                    {DIMENSION_KEYS.map((key) => {
                      const val = nodeScores[key] ?? 0;
                      return (
                        <div key={key} className="flex items-center gap-2">
                          <span className="text-[10px] text-white/40 w-24 truncate">{DIMENSION_LABELS[key]}</span>
                          <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${val * 100}%`, backgroundColor: DIMENSION_COLORS[key] }} />
                          </div>
                          <span className="text-[10px] text-white/30 w-6 text-right">{(val * 100).toFixed(0)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Summary */}
              {node.summary && (
                <div>
                  <h4 className="text-white/30 text-[10px] uppercase tracking-wider mb-2">Summary</h4>
                  <p className="text-white/50 text-xs leading-relaxed">{node.summary}</p>
                </div>
              )}

              {/* What Helps */}
              {persona?.what_helps && persona.what_helps.length > 0 && (
                <div>
                  <h4 className="text-white/30 text-[10px] uppercase tracking-wider mb-2">What Helps</h4>
                  <div className="flex flex-wrap gap-1">
                    {persona.what_helps.map((s) => (
                      <span key={s} className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400/80">{s}</span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-white/30">{label}: </span>
      <span className="text-white/60">{value}</span>
    </div>
  );
}
