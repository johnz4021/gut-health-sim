"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { FlareNode } from "@/lib/types";
import { fetchFlares } from "@/lib/api";

export function useFlarePolling(intervalMs = 2000) {
  const [flares, setFlares] = useState<FlareNode[]>([]);
  const [newFlareIds, setNewFlareIds] = useState<Set<string>>(new Set());
  const knownIdsRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    try {
      const data = await fetchFlares();
      const incoming = new Set<string>();

      for (const node of data) {
        if (!knownIdsRef.current.has(node.id)) {
          incoming.add(node.id);
        }
      }

      // Update known IDs
      for (const node of data) {
        knownIdsRef.current.add(node.id);
      }

      setFlares(data);

      if (incoming.size > 0) {
        setNewFlareIds(incoming);
        // Clear new IDs after 3 seconds
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
    poll(); // initial fetch
    const interval = setInterval(poll, intervalMs);
    return () => {
      clearInterval(interval);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [poll, intervalMs]);

  return { flares, newFlareIds };
}
