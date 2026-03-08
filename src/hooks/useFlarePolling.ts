"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { FlareNode, ClusterMetadata } from "@/lib/types";
import { fetchFlares } from "@/lib/api";

export function useFlarePolling(intervalMs = 2000) {
  const [flares, setFlares] = useState<FlareNode[]>([]);
  const [newFlareIds, setNewFlareIds] = useState<Set<string>>(new Set());
  const [clusterMetadata, setClusterMetadata] = useState<Record<string, ClusterMetadata>>({});
  const knownIdsRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstPollRef = useRef(true);

  const poll = useCallback(async () => {
    try {
      const response = await fetchFlares();
      const data = response.flares;
      const meta = response.cluster_metadata;
      const isFirst = isFirstPollRef.current;
      isFirstPollRef.current = false;

      if (meta) {
        setClusterMetadata(meta);
      }

      const incoming = new Set<string>();

      for (const node of data) {
        if (!knownIdsRef.current.has(node.id) && !isFirst) {
          incoming.add(node.id);
        }
        knownIdsRef.current.add(node.id);
      }

      // Only update flares state if the count changed (new node added)
      // This prevents ForceGraph3D from rebuilding all nodes every poll
      if (incoming.size > 0 || isFirst) {
        setFlares(data);
      }

      if (incoming.size > 0) {
        setNewFlareIds(incoming);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          setNewFlareIds(new Set());
        }, 3000);
      }
    } catch {
      // silently ignore polling errors
    }
  }, []);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, intervalMs);
    return () => {
      clearInterval(interval);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [poll, intervalMs]);

  return { flares, newFlareIds, clusterMetadata };
}
