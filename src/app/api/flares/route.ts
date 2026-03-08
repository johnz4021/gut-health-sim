import { NextResponse } from "next/server";

const SYMPTOMS_A = ["urgency", "bloating", "cramping", "nausea"];
const SYMPTOMS_B = ["bloating", "cramping", "gas", "distension"];
const SYMPTOMS_C = ["pain", "diarrhea", "nausea", "urgency"];

const CLUSTER_COLORS: Record<number, string> = {
  0: "#FF6B6B",
  1: "#4ECDC4",
  2: "#FFE66D",
};

// Sector centers (degrees → radians)
const SECTOR_ANGLES: Record<number, number> = {
  0: (90 * Math.PI) / 180,
  1: (210 * Math.PI) / 180,
  2: (330 * Math.PI) / 180,
};

function gaussian() {
  // Box-Muller transform
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function generateSeedNodes() {
  const nodes = [];
  const radius = 120;
  const spread = 60;

  for (let clusterId = 0; clusterId < 3; clusterId++) {
    const angle = SECTOR_ANGLES[clusterId];
    const centerX = Math.cos(angle) * radius;
    const centerY = Math.sin(angle) * radius;
    const symptoms =
      clusterId === 0 ? SYMPTOMS_A : clusterId === 1 ? SYMPTOMS_B : SYMPTOMS_C;

    for (let i = 0; i < 17; i++) {
      const picked = pickRandom(symptoms, 2);
      nodes.push({
        id: `seed-${clusterId}-${i}`,
        label: picked.join(" + "),
        symptoms: picked,
        clusterId,
        color: CLUSTER_COLORS[clusterId],
        confidence: 0.5 + Math.random() * 0.4,
        synthetic: true,
        x: centerX + gaussian() * spread,
        y: centerY + gaussian() * spread,
        z: gaussian() * 15,
      });
    }
  }

  return nodes;
}

// Cache seed nodes so they're stable across polls
let cachedNodes: ReturnType<typeof generateSeedNodes> | null = null;
// Store dynamically added flares
const addedFlares: ReturnType<typeof generateSeedNodes> = [];

export async function GET() {
  if (!cachedNodes) {
    cachedNodes = generateSeedNodes();
  }
  return NextResponse.json([...cachedNodes, ...addedFlares]);
}

// Allow POST to add a new flare (called by chat route on convergence)
export async function POST(request: Request) {
  const body = await request.json();
  addedFlares.push(body);
  return NextResponse.json({ ok: true });
}
