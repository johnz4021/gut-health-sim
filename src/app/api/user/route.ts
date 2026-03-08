import { NextResponse } from "next/server";
import { getUserSummary } from "@/lib/userStore";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const user_id = searchParams.get("user_id");

  if (!user_id) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }

  return NextResponse.json(getUserSummary(user_id));
}
