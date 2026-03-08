"use client";

import { useRef, useEffect, useCallback, useMemo } from "react";
import ForceGraph3D from "react-force-graph-3d";
import SpriteText from "three-spritetext";
import * as THREE from "three";
import { FlareNode } from "@/lib/types";
import { SECTOR_ANGLES, CLUSTER_LABELS, CLUSTER_COLORS } from "@/lib/constants";

interface Props {
  flares: FlareNode[];
  newFlareIds: Set<string>;
  phenotypeProbs: Record<string, number>;
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

      fg.cameraPosition({ x: 0, y: 0, z: 400 });

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

        // Floating cluster labels
        const labelGroup = new THREE.Group();
        labelGroup.name = "clusterLabels";
        const labelRadius = 150;
        for (const clusterIdStr of Object.keys(CLUSTER_LABELS)) {
          const clusterId = Number(clusterIdStr);
          const angle = SECTOR_ANGLES[clusterId];
          const label = CLUSTER_LABELS[clusterId];
          const color = CLUSTER_COLORS[clusterId];
          const x = Math.cos(angle) * labelRadius;
          const y = Math.sin(angle) * labelRadius;

          const sprite = new SpriteText(label, 8, color);
          sprite.fontFace = "Orbitron, sans-serif";
          sprite.fontWeight = "700";
          sprite.backgroundColor = "rgba(0,0,0,0.5)";
          sprite.padding = 6;
          sprite.borderRadius = 4;
          sprite.position.set(x, y, 0);
          sprite.material.depthWrite = false;
          sprite.renderOrder = 999;
          labelGroup.add(sprite);
        }
        scene.add(labelGroup);
      }

      // Clustering force — pulls nodes toward their sector, but weakens
      // as they approach so charge repulsion can spread them out
      fg.d3Force("cluster", () => {
        const targetRadius = 120;
        const deadZone = 50; // stop pulling once within this distance of center
        for (const node of flaresRef.current) {
          if (node.clusterId === -1) continue;
          const angle = SECTOR_ANGLES[node.clusterId];
          if (angle === undefined) continue;
          const targetX = Math.cos(angle) * targetRadius;
          const targetY = Math.sin(angle) * targetRadius;
          const dx = targetX - (node.x || 0);
          const dy = targetY - (node.y || 0);
          const dist = Math.sqrt(dx * dx + dy * dy);
          // Only pull if outside the dead zone; strength scales with distance
          if (dist > deadZone) {
            const strength = 0.05 * ((dist - deadZone) / dist);
            node.vx = (node.vx || 0) + dx * strength;
            node.vy = (node.vy || 0) + dy * strength;
          }
          node.vz = (node.vz || 0) + (0 - (node.z || 0)) * 0.02;
        }
      });

      fg.d3Force("charge")?.strength(-80);
      fg.d3ReheatSimulation();

      // Freeze forces after settling
      const timer = setTimeout(() => {
        fg.d3Force("charge", null);
        fg.d3Force("cluster", null);
        fg.d3ReheatSimulation();
      }, 5000);

      // Store timer for cleanup
      (graphRef as { current: { _freezeTimer?: ReturnType<typeof setTimeout> } }).current._freezeTimer = timer;
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

      const sprite = new SpriteText(node.label, 2, "white");
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
