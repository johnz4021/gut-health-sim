"use client";

import { useRef, useEffect, useCallback, useMemo } from "react";
import ForceGraph3D from "react-force-graph-3d";
import SpriteText from "three-spritetext";
import * as THREE from "three";
import { FlareNode, AxisScores } from "@/lib/types";
import { CLUSTER_LABELS, CLUSTER_COLORS } from "@/lib/constants";

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
  axisScores: AxisScores;
}

export default function FlareGraphInner({ flares, newFlareIds }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const newFlareIdsRef = useRef<Set<string>>(newFlareIds);
  const hoveredNodeRef = useRef<string | null>(null);
  const setupDoneRef = useRef(false);
  const flaresRef = useRef<FlareNode[]>(flares);

  newFlareIdsRef.current = newFlareIds;
  flaresRef.current = flares;

  // Stable graphData — only updates when flares reference changes
  const graphData = useMemo(
    () => ({ nodes: flares, links: [] as never[] }),
    [flares]
  );

  // One-time setup — wait a frame for ForceGraph3D to init its layout
  useEffect(() => {
    if (flares.length === 0) return;

    const raf = requestAnimationFrame(() => {
      const fg = graphRef.current;
      if (!fg || setupDoneRef.current) return;
      setupDoneRef.current = true;

      // Point camera at the centroid of all node data
      const allNodes = flaresRef.current;
      const cx = allNodes.reduce((s, n) => s + (n.x || 0), 0) / allNodes.length;
      const cy = allNodes.reduce((s, n) => s + (n.y || 0), 0) / allNodes.length;
      const cz = allNodes.reduce((s, n) => s + (n.z || 0), 0) / allNodes.length;
      fg.cameraPosition({ x: cx, y: cy, z: cz + 350 }, { x: cx, y: cy, z: cz }, 0);

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
          positions[i * 3] = (Math.random() - 0.5) * 2000;
          positions[i * 3 + 1] = (Math.random() - 0.5) * 2000;
          positions[i * 3 + 2] = (Math.random() - 0.5) * 2000;
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

          const sprite = new SpriteText(label, 8, color);
          sprite.fontFace = "Orbitron, sans-serif";
          sprite.fontWeight = "700";
          sprite.backgroundColor = "rgba(0,0,0,0.5)";
          sprite.padding = 6;
          sprite.borderRadius = 4;
          // Place label above the cluster centroid
          sprite.position.set(centroid.x, centroid.y + 30, centroid.z);
          sprite.material.depthWrite = false;
          sprite.renderOrder = 999;
          labelGroup.add(sprite);
        }
        scene.add(labelGroup);
      }

      // Nullify all forces — UMAP coordinates are pre-computed
      fg.d3Force("charge", null);
      fg.d3Force("link", null);
      fg.d3Force("center", null);

      // Pin each node to its preprocessed coordinates
      for (const node of flaresRef.current) {
        if (node.x !== null && node.x !== undefined) {
          node.fx = node.x;
          node.fy = node.y as number;
          node.fz = node.z as number;
        } else {
          // Live flare with no coordinates — place near cluster centroid
          const centroid = getClusterCentroid(node.clusterId, flaresRef.current);
          node.fx = centroid.x + (Math.random() - 0.5) * 20;
          node.fy = centroid.y + (Math.random() - 0.5) * 20;
          node.fz = centroid.z + (Math.random() - 0.5) * 10;
        }
      }
    });

    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flares.length > 0]);

  // Stable callback — reads from refs, never recreated
  const nodeThreeObject = useCallback(
    (node: FlareNode) => {
      const group = new THREE.Group();
      const isNew = newFlareIdsRef.current.has(node.id);
      const isHovered = hoveredNodeRef.current === node.id;

      const sphereSize = 3;
      const geometry = new THREE.SphereGeometry(sphereSize, 32, 32);
      const material = new THREE.MeshStandardMaterial({
        color: node.color,
        metalness: 0.3,
        roughness: 0.4,
        transparent: true,
        opacity: 0.9,
        emissive: new THREE.Color(isNew ? "#FFD700" : node.color),
        emissiveIntensity: isNew ? 0.8 : 0.15,
      });
      const sphere = new THREE.Mesh(geometry, material);
      group.add(sphere);

      const glowSize = sphereSize * (isNew ? 2.5 : 1.8);
      const glowGeo = new THREE.SphereGeometry(glowSize, 24, 24);
      const glowMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(isNew ? "#FFD700" : node.color),
        transparent: true,
        opacity: isNew ? 0.2 : 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      group.add(glow);

      // Breathing glow on all nodes
      let phase = Math.random() * Math.PI * 2;
      const speed = isNew ? 0.03 : 0.01;
      glow.onBeforeRender = () => {
        phase += speed;
        const scale = 1 + Math.sin(phase) * (isNew ? 0.15 : 0.08);
        glow.scale.setScalar(scale);
        glowMat.opacity =
          (isNew ? 0.2 : 0.1) + Math.sin(phase) * (isNew ? 0.05 : 0.03);
      };

      const labelText = isHovered && node.summary
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
      nodeThreeObject={nodeThreeObject as never}
      nodeThreeObjectExtend={false}
      onNodeClick={handleNodeClick as never}
      onNodeHover={handleNodeHover as never}
      backgroundColor="#000011"
      showNavInfo={false}
      enableNodeDrag={false}
    />
  );
}
