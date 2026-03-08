"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import dynamic from "next/dynamic";
import SpriteText from "three-spritetext";
import * as THREE from "three";
import { FlareNode } from "@/lib/types";
import { SECTOR_ANGLES, CLUSTER_LABELS, CLUSTER_COLORS } from "@/lib/constants";

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
  ssr: false,
});

interface Props {
  flares: FlareNode[];
  newFlareIds: Set<string>;
  phenotypeProbs: Record<string, number>;
}

export default function FlareGraph({ flares, newFlareIds }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const [hoveredNode, setHoveredNode] = useState<FlareNode | null>(null);

  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) return;

    // Camera position
    fg.cameraPosition({ x: 0, y: 0, z: 400 });

    // Auto-rotation
    const controls = fg.controls();
    if (controls) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.5;
    }

    // Renderer enhancements
    const renderer = fg.renderer();
    if (renderer) {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.4;
    }

    // Star field
    const scene = fg.scene();
    if (scene) {
      const starCount = 600;
      const starGeo = new THREE.BufferGeometry();
      const positions = new Float32Array(starCount * 3);
      for (let i = 0; i < starCount; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 2000;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 2000;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 2000;
      }
      starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
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
    }

    // Custom clustering force — push nodes toward their sector
    fg.d3Force("cluster", () => {
      const strength = 0.12;
      const targetRadius = 100;
      for (const node of flares) {
        if (node.clusterId === -1) continue;
        const angle = SECTOR_ANGLES[node.clusterId];
        if (angle === undefined) continue;
        const targetX = Math.cos(angle) * targetRadius;
        const targetY = Math.sin(angle) * targetRadius;
        node.vx = (node.vx || 0) + (targetX - (node.x || 0)) * strength;
        node.vy = (node.vy || 0) + (targetY - (node.y || 0)) * strength;
        node.vz = (node.vz || 0) + (0 - (node.z || 0)) * 0.02;
      }
    });

    fg.d3Force("charge")?.strength(-30);
    fg.d3ReheatSimulation();

    // Freeze forces after settling
    const timer = setTimeout(() => {
      fg.d3Force("charge", null);
      fg.d3Force("cluster", null);
      fg.d3ReheatSimulation();
    }, 5000);

    return () => {
      clearTimeout(timer);
      if (scene) {
        const stars = scene.getObjectByName("starField");
        if (stars) scene.remove(stars);
      }
    };
  }, [flares]);

  // Floating cluster labels
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) return;

    const scene = fg.scene();
    if (!scene) return;

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

    return () => {
      scene.remove(labelGroup);
    };
  }, [flares]);

  const nodeThreeObject = useCallback(
    (node: FlareNode) => {
      const group = new THREE.Group();

      const isNew = newFlareIds.has(node.id);
      const isHovered = hoveredNode?.id === node.id;

      // Sphere
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

      // Outer glow halo
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

      // Pulsing glow for new nodes
      if (isNew) {
        let phase = Math.random() * Math.PI * 2;
        glow.onBeforeRender = () => {
          phase += 0.03;
          const scale = 1 + Math.sin(phase) * 0.15;
          glow.scale.setScalar(scale);
          glowMat.opacity = 0.2 + Math.sin(phase) * 0.05;
        };
      }

      // Label
      const sprite = new SpriteText(node.label, 2, "white");
      sprite.fontFace = "Space Grotesk, sans-serif";
      sprite.fontWeight = "600";
      sprite.backgroundColor = "rgba(0,0,0,0.5)";
      sprite.padding = 2;
      sprite.borderRadius = 3;
      sprite.position.y = sphereSize + 3;
      group.add(sprite);

      // Scale up on hover
      if (isHovered) {
        group.scale.setScalar(1.4);
      }

      return group;
    },
    [newFlareIds, hoveredNode]
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
    setHoveredNode(node);
    const el = document.querySelector("canvas");
    if (el) {
      el.style.cursor = node ? "pointer" : "default";
    }
  }, []);

  return (
    <div className="w-full h-full">
      {typeof window !== "undefined" && (
        <ForceGraph3D
          ref={graphRef}
          graphData={{ nodes: flares, links: [] }}
          nodeThreeObject={nodeThreeObject as never}
          nodeThreeObjectExtend={false}
          onNodeClick={handleNodeClick as never}
          onNodeHover={handleNodeHover as never}
          backgroundColor="#000011"
          showNavInfo={false}
          enableNodeDrag={false}
        />
      )}
    </div>
  );
}
