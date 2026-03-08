import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Real flares added during live sessions
const sessionFlares: object[] = [];

// Cache cluster metadata at module level
let clusterMetadataCache: Record<string, unknown> | null = null;

function loadClusterMetadata(): Record<string, unknown> {
  if (clusterMetadataCache) return clusterMetadataCache;
  const metaPath = path.join(process.cwd(), "public/cluster_metadata.json");
  if (fs.existsSync(metaPath)) {
    clusterMetadataCache = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  } else {
    clusterMetadataCache = {};
  }
  return clusterMetadataCache!;
}

export async function GET() {
  const filePath = path.join(process.cwd(), "public/flares_processed.json");

  if (!fs.existsSync(filePath)) {
    return NextResponse.json(
      { error: "Run python preprocess.py first" },
      { status: 503 }
    );
  }

  const base = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const cluster_metadata = loadClusterMetadata();

  return NextResponse.json({
    flares: [...base, ...sessionFlares],
    cluster_metadata,
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  sessionFlares.push(body);
  return NextResponse.json({ ok: true });
}
