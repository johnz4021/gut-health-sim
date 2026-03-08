import { FlareNode, UserBackground, UserProfileSummary } from "./types";

interface UserProfile {
  user_id: string;
  background: UserBackground | null;
  flare_history: FlareNode[];
  created_at: string;
}

const users = new Map<string, UserProfile>();

export function getOrCreateUser(user_id: string): UserProfile {
  if (!users.has(user_id)) {
    users.set(user_id, {
      user_id,
      background: null,
      flare_history: [],
      created_at: new Date().toISOString(),
    });
  }
  return users.get(user_id)!;
}

export function updateBackground(user_id: string, bg: UserBackground): void {
  const user = getOrCreateUser(user_id);
  user.background = bg;
}

export function addFlare(user_id: string, flare: FlareNode): void {
  const user = getOrCreateUser(user_id);
  user.flare_history.push(flare);
}

export function getUserSummary(user_id: string): UserProfileSummary {
  const user = getOrCreateUser(user_id);
  return {
    user_id: user.user_id,
    flare_count: user.flare_history.length,
    has_background: user.background !== null,
    background: user.background ?? undefined,
  };
}
