import { NextResponse } from "next/server";
import crypto from "crypto";
import { getOrCreateUser } from "@/lib/userStore";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const user_id = body.user_id as string | undefined;

  const session_id = crypto.randomUUID();

  if (user_id) {
    const user = getOrCreateUser(user_id);
    return NextResponse.json({
      session_id,
      flare_count: user.flare_history.length,
      has_history: user.flare_history.length > 0,
      has_background: user.background !== null,
    });
  }

  return NextResponse.json({ session_id });
}
