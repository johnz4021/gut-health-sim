"use client";

import { useRef, useEffect, useCallback, useMemo } from "react";
import ForceGraph3D from "react-force-graph-3d";
import SpriteText from "three-spritetext";
import * as THREE from "three";
import { FlareNode, AxisScores } from "@/lib/types";
import { CLUSTER_LABELS, CLUSTER_COLORS } from "@/lib/constants";

const AXIS_TO_CLUSTER: Record<string, number> = {
  caffeine_sleep: 0,
  fodmap: 1,
  stress_gut: 2,
};

function getDraftTarget(scores: AxisScores, allNodes: FlareNode[]): { x: number; y: number; z: number } {
  let maxAxis = "fodmap";
  let maxScore = 0;
  for (const [axis, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      maxAxis = axis;
    }
  }
  const clusterId = AXIS_TO_CLUSTER[maxAxis] ?? 1;
  const realNodes = allNodes.filter((n) => n.id !== "__draft__");
  return getClusterCentroid(clusterId, realNodes);
}

function getClusterCentroid(clusterId: number, allNodes: FlareNode[]) {
  const members = allNodes.filter(n => n.clusterId === clusterId);
  if (members.length === 0) return { x: 0, y: 0, z: 0 };
  return {
    x: members.reduce((s, n) => s + (n.fx ?? n.x ?? 0), 0) / members.length,
    y: members.reduce((s, n) => s + (n.fy ?? n.y ?? 0), 0) / members.length,
    z: members.reduce((s, n) => s + (n.fz ?? n.z ?? 0), 0) / members.length,
  };
}

interface Props {
  flares: FlareNode[];
  newFlareIds: Set<string>;
  draftNodeId: string | null;
  axisScores: AxisScores;
  width: number;
  height: number;
}

export default function FlareGraphInner({ flares, newFlareIds, draftNodeId, axisScores, width, height }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const newFlareIdsRef = useRef<Set<string>>(newFlareIds);
  const hoveredNodeRef = useRef<string | null>(null);
  const setupDoneRef = useRef(false);
  const flaresRef = useRef<FlareNode[]>(flares);
  const draftNodeIdRef = useRef(draftNodeId);
  const axisScoresRef = useRef(axisScores);

  newFlareIdsRef.current = newFlareIds;
  flaresRef.current = flares;
  draftNodeIdRef.current = draftNodeId;
  axisScoresRef.current = axisScores;

  // Pre-pin nodes before ForceGraph3D sees them — prevents d3-force race condition
  const SPREAD = 3;
  const INTRA_CLUSTER_EXPAND = 12; // expand within-cluster distances
  const graphData = useMemo(() => {
    // First pass: compute cluster centroids from raw UMAP coords
    const clusterSums: Record<number, { sx: number; sy: number; sz: number; count: number }> = {};
    for (const node of flares) {
      if (node.id === draftNodeId || node.x == null) continue;
      const cid = node.clusterId;
      if (!clusterSums[cid]) clusterSums[cid] = { sx: 0, sy: 0, sz: 0, count: 0 };
      clusterSums[cid].sx += node.x;
      clusterSums[cid].sy += node.y ?? 0;
      clusterSums[cid].sz += node.z ?? 0;
      clusterSums[cid].count++;
    }

    // Second pass: pin each node — global spread + intra-cluster expansion
    for (const node of flares) {
      if (node.id === draftNodeId) {
        // Draft handled by rAF loop
        if (node.fx === undefined) { node.fx = 0; node.fy = 0; node.fz = 0; node.x = 0; node.y = 0; node.z = 0; }
      } else if (node.fx === undefined && node.x != null) {
        const c = clusterSums[node.clusterId];
        if (c && c.count > 1) {
          const cx = c.sx / c.count;
          const cy = c.sy / c.count;
          const cz = c.sz / c.count;
          // Offset from centroid, expanded
          const dx = (node.x - cx) * INTRA_CLUSTER_EXPAND;
          const dy = ((node.y ?? 0) - cy) * INTRA_CLUSTER_EXPAND;
          const dz = ((node.z ?? 0) - cz) * INTRA_CLUSTER_EXPAND;
          // Final position = scaled centroid + expanded offset
          node.fx = cx * SPREAD + dx;
          node.fy = cy * SPREAD + dy;
          node.fz = cz * SPREAD + dz;
        } else {
          node.fx = node.x * SPREAD;
          node.fy = (node.y ?? 0) * SPREAD;
          node.fz = (node.z ?? 0) * SPREAD;
        }
        // Also set x/y/z so ForceGraph3D renders at correct positions immediately
        node.x = node.fx;
        node.y = node.fy;
        node.z = node.fz;
      }
    }
    return { nodes: flares, links: [] as never[] };
  }, [flares, draftNodeId]);

  // One-time setup — wait a frame for ForceGraph3D to init its layout
  useEffect(() => {
    if (flares.length === 0) return;

    const raf = requestAnimationFrame(() => {
      const fg = graphRef.current;
      if (!fg || setupDoneRef.current) return;
      setupDoneRef.current = true;

      // Point camera at the centroid of all node data (use fx which is pre-set)
      const allNodes = flaresRef.current;
      const cx = allNodes.reduce((s, n) => s + (n.fx ?? 0), 0) / allNodes.length;
      const cy = allNodes.reduce((s, n) => s + (n.fy ?? 0), 0) / allNodes.length;
      const cz = allNodes.reduce((s, n) => s + (n.fz ?? 0), 0) / allNodes.length;
      fg.cameraPosition({ x: cx, y: cy, z: cz + 1200 }, { x: cx, y: cy, z: cz }, 0);

      const controls = fg.controls();
      if (controls) {
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.5;
      }

      const renderer = fg.renderer();
      if (renderer) {
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.4;
      }

      const scene = fg.scene();
      if (scene) {
        // Star field
        const starCount = 600;
        const starGeo = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        for (let i = 0; i < starCount; i++) {
          positions[i * 3] = (Math.random() - 0.5) * 4000;
          positions[i * 3 + 1] = (Math.random() - 0.5) * 4000;
          positions[i * 3 + 2] = (Math.random() - 0.5) * 4000;
        }
        starGeo.setAttribute(
          "position",
          new THREE.BufferAttribute(positions, 3)
        );
        const starMat = new THREE.PointsMaterial({
          color: 0xffffff,
          size: 0.8,
          transparent: true,
          opacity: 0.6,
          sizeAttenuation: true,
        });
        const stars = new THREE.Points(starGeo, starMat);
        stars.name = "starField";
        scene.add(stars);

        // Floating cluster labels — placed at actual cluster centroids
        const labelGroup = new THREE.Group();
        labelGroup.name = "clusterLabels";
        for (const clusterIdStr of Object.keys(CLUSTER_LABELS)) {
          const clusterId = Number(clusterIdStr);
          const centroid = getClusterCentroid(clusterId, allNodes);
          const label = CLUSTER_LABELS[clusterId];
          const color = CLUSTER_COLORS[clusterId];

          const sprite = new SpriteText(label, 10, color);
          sprite.fontFace = "Orbitron, sans-serif";
          sprite.fontWeight = "700";
          sprite.backgroundColor = "rgba(0,0,0,0.5)";
          sprite.padding = 6;
          sprite.borderRadius = 4;
          // Place label above the cluster centroid (scaled to match SPREAD)
          sprite.position.set(centroid.x, centroid.y + 60, centroid.z);
          sprite.material.depthWrite = false;
          sprite.renderOrder = 999;
          labelGroup.add(sprite);
        }
        scene.add(labelGroup);
      }

    });

    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flares.length > 0]);

  // rAF animation loop — lerp draft node toward dominant cluster + camera follow
  useEffect(() => {
    if (!draftNodeId) return;
    let animId: number;
    const CAM_LERP = 0.02; // smooth camera follow
    const CAM_DISTANCE = 200; // how far the camera sits behind the node
    const animate = () => {
      const draft = flaresRef.current.find((n) => n.id === draftNodeIdRef.current);
      if (!draft || !draftNodeIdRef.current) return;
      const target = getDraftTarget(axisScoresRef.current, flaresRef.current);
      const LERP = 0.03;
      draft.fx = (draft.fx ?? 0) + (target.x - (draft.fx ?? 0)) * LERP;
      draft.fy = (draft.fy ?? 0) + (target.y - (draft.fy ?? 0)) * LERP;
      draft.fz = (draft.fz ?? 0) + (target.z - (draft.fz ?? 0)) * LERP;
      if (draft.__threeObj) {
        draft.__threeObj.position.set(draft.fx, draft.fy, draft.fz);
      }

      // Smoothly follow draft node with camera
      const fg = graphRef.current;
      if (fg) {
        const camera = fg.camera();
        if (camera) {
          const dx = draft.fx ?? 0;
          const dy = draft.fy ?? 0;
          const dz = (draft.fz ?? 0) + CAM_DISTANCE;
          camera.position.x += (dx - camera.position.x) * CAM_LERP;
          camera.position.y += (dy - camera.position.y) * CAM_LERP;
          camera.position.z += (dz - camera.position.z) * CAM_LERP;
          // Keep looking at the draft node
          const controls = fg.controls();
          if (controls) {
            controls.target.x += ((draft.fx ?? 0) - controls.target.x) * CAM_LERP;
            controls.target.y += ((draft.fy ?? 0) - controls.target.y) * CAM_LERP;
            controls.target.z += ((draft.fz ?? 0) - controls.target.z) * CAM_LERP;
            controls.update();
          }
        }
      }

      animId = requestAnimationFrame(animate);
    };

    // Disable auto-rotate while following draft
    const fg = graphRef.current;
    if (fg) {
      const controls = fg.controls();
      if (controls) controls.autoRotate = false;
    }

    animId = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(animId);
      // Re-enable auto-rotate when draft is removed
      const fg = graphRef.current;
      if (fg) {
        const controls = fg.controls();
        if (controls) controls.autoRotate = true;
      }
    };
  }, [draftNodeId]);

  // Stable callback — reads from refs, never recreated
  const nodeThreeObject = useCallback(
    (node: FlareNode) => {
      const group = new THREE.Group();
      const isNew = newFlareIdsRef.current.has(node.id);
      const isDraft = node.id === draftNodeIdRef.current;
      const isHovered = hoveredNodeRef.current === node.id;

      const sphereSize = 3;
      const geometry = new THREE.SphereGeometry(sphereSize, 32, 32);
      const material = new THREE.MeshStandardMaterial({
        color: isDraft ? "#C084FC" : node.color,
        metalness: 0.3,
        roughness: isDraft ? 0.2 : 0.4,
        transparent: true,
        opacity: 0.9,
        emissive: new THREE.Color(isDraft ? "#C084FC" : isNew ? "#FFD700" : node.color),
        emissiveIntensity: isDraft ? 1.0 : isNew ? 0.8 : 0.15,
      });
      const sphere = new THREE.Mesh(geometry, material);
      group.add(sphere);

      const glowSize = sphereSize * (isDraft ? 3 : isNew ? 2.5 : 1.8);
      const glowGeo = new THREE.SphereGeometry(glowSize, 24, 24);
      const glowMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(isDraft ? "#C084FC" : isNew ? "#FFD700" : node.color),
        transparent: true,
        opacity: isDraft ? 0.25 : isNew ? 0.2 : 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      group.add(glow);

      // Breathing glow on all nodes
      let phase = Math.random() * Math.PI * 2;
      const speed = isDraft ? 0.05 : isNew ? 0.03 : 0.01;
      const amplitude = isDraft ? 0.2 : isNew ? 0.15 : 0.08;
      glow.onBeforeRender = () => {
        phase += speed;
        const scale = 1 + Math.sin(phase) * amplitude;
        glow.scale.setScalar(scale);
        glowMat.opacity =
          (isDraft ? 0.25 : isNew ? 0.2 : 0.1) + Math.sin(phase) * (isDraft ? 0.08 : isNew ? 0.05 : 0.03);
      };

      const labelText = isDraft
        ? "Analyzing..."
        : isHovered && node.summary
          ? node.summary.slice(0, 60) + "..."
          : node.label;
      const sprite = new SpriteText(labelText, isHovered ? 3 : 2, "white");
      sprite.fontFace = "Space Grotesk, sans-serif";
      sprite.fontWeight = "600";
      sprite.backgroundColor = "rgba(0,0,0,0.5)";
      sprite.padding = 2;
      sprite.borderRadius = 3;
      sprite.position.y = sphereSize + 3;
      group.add(sprite);

      if (isHovered) {
        group.scale.setScalar(1.4);
      }

      return group;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const handleNodeClick = useCallback((node: FlareNode) => {
    const fg = graphRef.current;
    if (fg) {
      const controls = fg.controls();
      if (controls) controls.autoRotate = false;
      const distance = 120;
      const distRatio =
        1 + distance / Math.hypot(node.x || 0, node.y || 0, node.z || 0);
      fg.cameraPosition(
        {
          x: (node.x || 0) * distRatio,
          y: (node.y || 0) * distRatio,
          z: (node.z || 0) * distRatio,
        },
        node,
        2000
      );
    }
  }, []);

  const handleNodeHover = useCallback((node: FlareNode | null) => {
    hoveredNodeRef.current = node?.id ?? null;
    const el = document.querySelector("canvas");
    if (el) {
      el.style.cursor = node ? "pointer" : "default";
    }
  }, []);

  return (
    <ForceGraph3D
      ref={graphRef}
      graphData={graphData}
      width={width}
      height={height}
      nodeThreeObject={nodeThreeObject as never}
      nodeThreeObjectExtend={false}
      onNodeClick={handleNodeClick as never}
      onNodeHover={handleNodeHover as never}
      backgroundColor="#000011"
      showNavInfo={false}
      enableNodeDrag={false}
      cooldownTicks={0}
      warmupTicks={0}
    />
  );
}
