import { NextResponse } from "next/server";
import crypto from "crypto";

export async function POST() {
  return NextResponse.json({ session_id: crypto.randomUUID() });
}
