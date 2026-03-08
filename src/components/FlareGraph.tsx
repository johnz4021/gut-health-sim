"use client";

import dynamic from "next/dynamic";
import { FlareNode } from "@/lib/types";

const FlareGraphInner = dynamic(() => import("./FlareGraphInner"), {
  ssr: false,
});

interface Props {
  flares: FlareNode[];
  newFlareIds: Set<string>;
  phenotypeProbs: Record<string, number>;
}

export default function FlareGraph(props: Props) {
  return (
    <div className="w-full h-full bg-[#000011]">
      {props.flares.length > 0 && <FlareGraphInner {...props} />}
    </div>
  );
}
