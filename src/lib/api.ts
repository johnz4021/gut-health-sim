import { API_BASE } from "./constants";
import { ChatResponse, FlareNode } from "./types";

export async function createSession(): Promise<{ session_id: string }> {
  const res = await fetch(`${API_BASE}/api/session/new`, { method: "POST" });
  return res.json();
}

export async function sendMessage(
  sessionId: string,
  message: string
): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, message }),
  });
  return res.json();
}

export async function fetchFlares(): Promise<FlareNode[]> {
  const res = await fetch(`${API_BASE}/api/flares`);
  return res.json();
}
