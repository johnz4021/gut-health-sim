import { API_BASE } from "./constants";
import { ChatResponse, FlaresResponse, UserProfileSummary } from "./types";

interface SessionResponse {
  session_id: string;
  flare_count?: number;
  has_history?: boolean;
  has_background?: boolean;
}

export async function createSession(user_id?: string): Promise<SessionResponse> {
  const res = await fetch(`${API_BASE}/api/session/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(user_id ? { user_id } : {}),
  });
  return res.json();
}

export async function sendMessage(
  sessionId: string,
  message: string,
  user_id?: string
): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, message, user_id }),
  });
  return res.json();
}

export async function fetchFlares(): Promise<FlaresResponse> {
  const res = await fetch(`${API_BASE}/api/flares`);
  return res.json();
}

export async function fetchUserProfile(user_id: string): Promise<UserProfileSummary> {
  const res = await fetch(`${API_BASE}/api/user?user_id=${encodeURIComponent(user_id)}`);
  return res.json();
}
