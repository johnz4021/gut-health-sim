"use client";

import { useRef, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { FlareNode, AxisScores, ClusterMetadata } from "@/lib/types";

const FlareGraphInner = dynamic(() => import("./FlareGraphInner"), {
  ssr: false,
});

interface Props {
  flares: FlareNode[];
  newFlareIds: Set<string>;
  draftNodeId: string | null;
  axisScores: AxisScores;
  clusterMetadata: Record<string, ClusterMetadata>;
  currentUserId: string | null;
  onNodeSelect?: (node: FlareNode | null) => void;
}

export default function FlareGraph(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setDims({ width: Math.round(width), height: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full bg-[#000011]">
      {props.flares.length > 0 && <FlareGraphInner {...props} width={dims.width} height={dims.height} />}
    </div>
  );
}
