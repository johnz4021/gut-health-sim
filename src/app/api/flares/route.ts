import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Real flares added during live sessions
const sessionFlares: object[] = [];

export async function GET() {
  const filePath = path.join(process.cwd(), "public/flares_processed.json");

  if (!fs.existsSync(filePath)) {
    return NextResponse.json(
      { error: "Run python preprocess.py first" },
      { status: 503 }
    );
  }

  const base = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return NextResponse.json([...base, ...sessionFlares]);
}

export async function POST(request: Request) {
  const body = await request.json();
  sessionFlares.push(body);
  return NextResponse.json({ ok: true });
}
