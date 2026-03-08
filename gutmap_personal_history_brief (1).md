# GutMap — Personal History + Background Integration
## Claude Code Build Brief

---

## What This Brief Covers

Everything needed to add longitudinal user tracking and clinical background to GutMap. This includes: server-side user profiles, client-side persistent identity, conversational onboarding, background-informed axis priors, personal history injection into the Socratic agent, flare history persistence across browser sessions, background-enriched preprocessing pipeline, and trajectory visualization in the 3D graph.

This does NOT include the patient archetype graph (second graph view). That is a separate brief.

---

## Architecture Overview

```
FIRST VISIT:
  localStorage generates user_id
       ↓
  POST /api/session/new { user_id }
       ↓
  Server creates UserProfile (background: null)
       ↓
  Chat route detects background === null → ONBOARDING state
       ↓
  Agent asks 3-4 background questions conversationally
       ↓
  Background saved to UserProfile
       ↓
  State transitions to SYMPTOM_INTAKE → normal Socratic flow
       ↓
  On convergence: flare saved to UserProfile.flare_history
       ↓
  Post-convergence message: "This flare has been added to your profile."

RETURN VISIT (page refresh or new tab):
  localStorage provides same user_id
       ↓
  POST /api/session/new { user_id } → returns flare_count, has_history
       ↓
  Server loads existing UserProfile (background populated, flare_history populated)
       ↓
  Chat route detects background !== null → skips onboarding → SYMPTOM_INTAKE
       ↓
  System prompt includes personal history + background context
       ↓
  Agent starts axis scores at personal baseline, references known triggers
       ↓
  Agent converges faster (2-3 questions instead of 4-5)
```

**Critical constraint:** The server-side user store is in-memory (a `Map`). It survives page refreshes but NOT Next.js server restarts. This is fine for the demo. For production you'd swap the Map for a database — the interface is the same.

---

## File Changes — Complete List

### New Files (create these)

| File | Purpose |
|------|---------|
| `src/lib/userStore.ts` | Server-side user profile store (in-memory Map) |
| `src/app/api/user/route.ts` | GET endpoint to retrieve user profile summary |

### Modified Files (replace these)

| File | What Changes |
|------|-------------|
| `src/lib/types.ts` | Add `UserBackground`, `UserProfileSummary`, `user_id` on FlareNode |
| `src/lib/api.ts` | Pass `user_id` through session creation and chat; add `fetchUserProfile` |
| `src/app/api/session/new/route.ts` | Accept `user_id`, return flare_count and has_history |
| `src/app/api/chat/route.ts` | Add ONBOARDING state, background-informed priors, personal history injection, flare recording on convergence |
| `src/app/page.tsx` | Persistent user_id via localStorage, pass user_id/flareCount/converged to ChatPanel |
| `src/components/ChatPanel.tsx` | History badge, welcome-back empty state, post-convergence message, accept flareCount + converged props |
| `src/components/FlareGraphInner.tsx` | Trajectory links between same-user flares, purple ring on user flares |
| `preprocess.py` | Add synthetic backgrounds to seed data, background features + interaction terms in feature vectors |

### Unchanged Files (do NOT modify)

| File | Status |
|------|--------|
| `src/components/FlareGraph.tsx` | No changes |
| `src/components/ChatMessage.tsx` | No changes |
| `src/components/PhenotypeCard.tsx` | No changes |
| `src/components/ProbabilityBar.tsx` | No changes |
| `src/hooks/useFlarePolling.ts` | No changes |
| `src/lib/constants.ts` | No changes |
| `src/app/layout.tsx` | No changes |
| `src/app/globals.css` | No changes |
| `src/app/api/flares/route.ts` | No changes |

---

## Step 1: Create `src/lib/userStore.ts`

This is the core data layer. All user state lives here. Every other change reads from or writes to this store.

```typescript
import { AxisScores } from "./types";

// ── Background Interface ────────────────────────────────────────────────────

export interface UserBackground {
  sex: "female" | "male" | "other" | null;
  age_range: "18-25" | "26-35" | "36-45" | "46-55" | "56+" | null;
  ibs_subtype: "IBS-D" | "IBS-C" | "IBS-M" | "unsure" | null;
  active_medications: string[];        // e.g. ["SSRI", "PPI", "hormonal birth control"]
  dietary_baseline: string | null;     // e.g. "already low-FODMAP", "vegetarian", "no restrictions"
  tracks_menstrual_cycle: boolean | null;
  diagnosed_comorbidities: string[];   // e.g. ["anxiety disorder", "endometriosis"]
}

// ── Flare Record ────────────────────────────────────────────────────────────

export interface FlareRecord {
  flare_id: string;
  session_id: string;
  timestamp: number;
  axis_scores: AxisScores;
  confirmed_triggers: string[];
  symptoms: string[];
  primary_trigger: string;
  amplifiers: string[];
  summary: string;
}

// ── User Profile ────────────────────────────────────────────────────────────

export interface UserProfile {
  user_id: string;
  background: UserBackground | null;    // null until onboarding complete
  flare_history: FlareRecord[];
  personal_baseline: AxisScores;        // rolling mean of axis scores
  known_triggers: string[];             // triggers confirmed in 2+ flares
  high_confidence_axes: string[];       // axes consistently scoring high
  created_at: number;
}

// ── Store ───────────────────────────────────────────────────────────────────

const users = new Map<string, UserProfile>();

export function getOrCreateUser(userId: string): UserProfile {
  if (!users.has(userId)) {
    users.set(userId, {
      user_id: userId,
      background: null,
      flare_history: [],
      personal_baseline: { fodmap: 0.5, stress_gut: 0.5, caffeine_sleep: 0.5 },
      known_triggers: [],
      high_confidence_axes: [],
      created_at: Date.now(),
    });
  }
  return users.get(userId)!;
}

export function getUser(userId: string): UserProfile | null {
  return users.get(userId) ?? null;
}

export function saveBackground(userId: string, background: UserBackground): UserProfile {
  const user = getOrCreateUser(userId);
  user.background = background;
  return user;
}

export function recordFlare(userId: string, record: FlareRecord): UserProfile {
  const user = getOrCreateUser(userId);
  user.flare_history.push(record);
  recomputeBaseline(user);
  return user;
}

// ── Baseline Recomputation ──────────────────────────────────────────────────

function recomputeBaseline(user: UserProfile): void {
  const history = user.flare_history;
  if (history.length === 0) return;

  // Rolling mean of axis scores
  const sum: AxisScores = { fodmap: 0, stress_gut: 0, caffeine_sleep: 0 };
  for (const f of history) {
    sum.fodmap += f.axis_scores.fodmap;
    sum.stress_gut += f.axis_scores.stress_gut;
    sum.caffeine_sleep += f.axis_scores.caffeine_sleep;
  }
  const n = history.length;
  user.personal_baseline = {
    fodmap: Math.round((sum.fodmap / n) * 100) / 100,
    stress_gut: Math.round((sum.stress_gut / n) * 100) / 100,
    caffeine_sleep: Math.round((sum.caffeine_sleep / n) * 100) / 100,
  };

  // Known triggers — appear in 2+ flares (or all triggers if only 1 flare)
  const triggerCounts = new Map<string, number>();
  for (const f of history) {
    for (const t of f.confirmed_triggers) {
      triggerCounts.set(t, (triggerCounts.get(t) || 0) + 1);
    }
  }
  user.known_triggers = history.length === 1
    ? [...triggerCounts.keys()]
    : [...triggerCounts.entries()].filter(([, c]) => c >= 2).map(([t]) => t);

  // High-confidence axes — sorted by baseline, filtered to > 0.5
  const axes = Object.entries(user.personal_baseline) as [string, number][];
  axes.sort((a, b) => b[1] - a[1]);
  user.high_confidence_axes = axes.filter(([, s]) => s > 0.5).map(([a]) => a);
}

// ── Background-Informed Initial Axis Scores ─────────────────────────────────

export function getInitialAxisScores(user: UserProfile): AxisScores {
  // Start from personal history baseline if available
  const base = user.flare_history.length > 0
    ? { ...user.personal_baseline }
    : { fodmap: 0.5, stress_gut: 0.5, caffeine_sleep: 0.5 };

  // If no background, return base
  if (!user.background) return base;

  const bg = user.background;

  // IBS subtype modifiers (only apply if no flare history to override)
  if (user.flare_history.length === 0) {
    if (bg.ibs_subtype === "IBS-D") {
      base.caffeine_sleep = Math.min(base.caffeine_sleep + 0.1, 1.0);
      // Urgency is baseline for IBS-D, so caffeine/sleep axis starts slightly elevated
    } else if (bg.ibs_subtype === "IBS-C") {
      base.fodmap = Math.min(base.fodmap + 0.1, 1.0);
      // Bloating/constipation dominant — FODMAP axis starts slightly elevated
    }
  }

  // Medication modifiers
  if (bg.active_medications.some(m => m.toLowerCase().includes("ssri"))) {
    // SSRIs modulate serotonin which affects gut motility — dampen stress axis slightly
    // because serotonin is already being managed pharmacologically
    base.stress_gut = Math.max(base.stress_gut - 0.05, 0.0);
  }

  // Dietary baseline modifier
  if (bg.dietary_baseline?.toLowerCase().includes("low-fodmap")) {
    // Already following low-FODMAP — if they're still flaring, FODMAP is less likely
    // to be the primary driver. Lower the prior.
    base.fodmap = Math.max(base.fodmap - 0.1, 0.0);
  }

  // Anxiety comorbidity modifier
  if (bg.diagnosed_comorbidities.some(c => c.toLowerCase().includes("anxiety"))) {
    base.stress_gut = Math.min(base.stress_gut + 0.1, 1.0);
  }

  return base;
}
```

---

## Step 2: Update `src/lib/types.ts`

Add `UserBackground`, `UserProfileSummary`, and `user_id` to `FlareNode`.

```typescript
export interface AxisScores {
  fodmap: number;
  stress_gut: number;
  caffeine_sleep: number;
}

export interface SensitivityProfile {
  axis_scores: AxisScores;
  primary_trigger: string;
  amplifiers: string[];
  confidence: number;
  triggers: string[];
}

export interface FlareNode {
  id: string;
  label: string;
  symptoms: string[];
  clusterId: number;
  color: string;
  confidence: number;
  synthetic: boolean;
  summary?: string;
  novel_factors?: string[];
  axis_scores?: AxisScores;
  user_id?: string;          // ADD — links flares from same user for trajectory lines
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  fx?: number;
  fy?: number;
  fz?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __threeObj?: any;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface ChatResponse {
  reply: string;
  state: "ONBOARDING" | "SYMPTOM_INTAKE" | "QUESTIONING" | "CONVERGED";  // ADD ONBOARDING
  axis_scores: AxisScores;
  converged: boolean;
  sensitivity_profile: SensitivityProfile | null;
}

// ADD — for client-side profile display
export interface UserProfileSummary {
  user_id: string;
  flare_count: number;
  personal_baseline: AxisScores;
  known_triggers: string[];
  high_confidence_axes: string[];
  has_background: boolean;
}
```

---

## Step 3: Update `src/lib/api.ts`

Pass `user_id` through all API calls. Add `fetchUserProfile`.

```typescript
import { API_BASE } from "./constants";
import { ChatResponse, FlareNode, UserProfileSummary } from "./types";

export async function createSession(userId?: string): Promise<{
  session_id: string;
  user_id: string;
  flare_count: number;
  has_history: boolean;
  has_background: boolean;
}> {
  const res = await fetch(`${API_BASE}/api/session/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId }),
  });
  return res.json();
}

export async function sendMessage(
  sessionId: string,
  message: string,
  userId?: string
): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, message, user_id: userId }),
  });
  return res.json();
}

export async function fetchFlares(): Promise<FlareNode[]> {
  const res = await fetch(`${API_BASE}/api/flares`);
  return res.json();
}

export async function fetchUserProfile(userId: string): Promise<UserProfileSummary> {
  const res = await fetch(`${API_BASE}/api/user?user_id=${encodeURIComponent(userId)}`);
  return res.json();
}
```

---

## Step 4: Create `src/app/api/user/route.ts`

New endpoint for retrieving user profile data.

```typescript
import { NextResponse } from "next/server";
import { getUser } from "@/lib/userStore";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("user_id");

  if (!userId) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }

  const user = getUser(userId);
  if (!user) {
    return NextResponse.json({
      user_id: userId,
      flare_count: 0,
      personal_baseline: { fodmap: 0.5, stress_gut: 0.5, caffeine_sleep: 0.5 },
      known_triggers: [],
      high_confidence_axes: [],
      has_background: false,
      flare_history: [],
    });
  }

  return NextResponse.json({
    user_id: user.user_id,
    flare_count: user.flare_history.length,
    personal_baseline: user.personal_baseline,
    known_triggers: user.known_triggers,
    high_confidence_axes: user.high_confidence_axes,
    has_background: user.background !== null,
    flare_history: user.flare_history.map((f) => ({
      flare_id: f.flare_id,
      timestamp: f.timestamp,
      axis_scores: f.axis_scores,
      symptoms: f.symptoms,
      primary_trigger: f.primary_trigger,
    })),
  });
}
```

---

## Step 5: Update `src/app/api/session/new/route.ts`

Accept `user_id`, return profile summary.

```typescript
import { NextResponse } from "next/server";
import crypto from "crypto";
import { getOrCreateUser } from "@/lib/userStore";

export async function POST(request: Request) {
  let userId = "anonymous";
  try {
    const body = await request.json();
    if (body.user_id) userId = body.user_id;
  } catch {
    // no body — use anonymous
  }

  const user = getOrCreateUser(userId);

  return NextResponse.json({
    session_id: crypto.randomUUID(),
    user_id: userId,
    flare_count: user.flare_history.length,
    has_history: user.flare_history.length > 0,
    has_background: user.background !== null,
  });
}
```

---

## Step 6: Update `src/app/api/chat/route.ts`

This is the largest change. The state machine gains an `ONBOARDING` state. The system prompt gains personal history and background context blocks.

### State Machine

```
New user (no background):     ONBOARDING → SYMPTOM_INTAKE → QUESTIONING → CONVERGED
Returning user (has background): SYMPTOM_INTAKE → QUESTIONING → CONVERGED
```

### Key Behaviors

**ONBOARDING state:**
- Agent asks 3-4 background questions conversationally, one at a time
- Claude returns structured `background_update` fields in its JSON response
- After enough background is collected (at minimum: ibs_subtype), transition to SYMPTOM_INTAKE
- Store background via `saveBackground()` from userStore

**SYMPTOM_INTAKE with history:**
- System prompt includes `PERSONAL HISTORY` block with baseline, known triggers, recent flares
- System prompt includes `USER BACKGROUND` block with clinical implications
- Initial axis scores come from `getInitialAxisScores()` instead of flat 0.5/0.5/0.5
- Agent can converge faster (after 2 questions) if pattern matches confirmed trigger

**On convergence:**
- Call `recordFlare()` to save to user profile
- POST the flare to `/api/flares` with `user_id` field for trajectory visualization

### Session Interface Change

```typescript
type ConversationState = "ONBOARDING" | "SYMPTOM_INTAKE" | "QUESTIONING" | "CONVERGED";

interface Session {
  state: ConversationState;
  symptoms: string[];
  context: Record<string, unknown>;
  axis_scores: AxisScores;
  questions_asked: string[];
  history: Array<{ role: "user" | "assistant"; content: string }>;
  user_id: string;
  onboarding_fields_collected: string[];  // tracks which bg fields have been asked
}
```

### System Prompt — ONBOARDING Block

When `session.state === "ONBOARDING"`, use this system prompt instead of the normal one:

```
You are GutMap, an AI for IBS trigger discovery. Before we investigate flares,
you need to understand this patient's background.

Ask ONE question at a time. Be warm and conversational.

Questions to ask (in this order, skip any already collected):
1. IBS subtype: "Do you know your IBS subtype? For example, IBS-D (diarrhea-dominant), IBS-C (constipation-dominant), or IBS-M (mixed)? It's also fine if you're not sure."
2. Sex + cycle: "What's your biological sex? If female, do you track your menstrual cycle?"
3. Medications: "Are you currently taking any medications that might affect your gut? Things like SSRIs, PPIs (acid reducers), or hormonal birth control?"
4. Diet: "Do you follow any specific dietary protocol? For example, low-FODMAP, vegetarian, or no particular restrictions?"

ALREADY COLLECTED: ${session.onboarding_fields_collected.join(", ") || "none"}

After collecting at least ibs_subtype AND one other field, you may transition
to SYMPTOM_INTAKE by setting state to "SYMPTOM_INTAKE" and asking the user
to describe their symptoms.

RESPONSE FORMAT — respond with ONLY this JSON:
{
  "reply": "your conversational message",
  "state": "ONBOARDING | SYMPTOM_INTAKE",
  "background_update": {
    "field": "ibs_subtype | sex | tracks_menstrual_cycle | active_medications | dietary_baseline | diagnosed_comorbidities",
    "value": "the extracted value"
  },
  "axis_scores": {"fodmap": 0.5, "stress_gut": 0.5, "caffeine_sleep": 0.5},
  "converged": false,
  "sensitivity_profile": null
}
```

### System Prompt — Personal History Block

When the user has flare history, inject this into the normal system prompt (after the SENSITIVITY_AXES block):

```
PERSONAL HISTORY (${n} previous flares on file):
- Baseline sensitivity: FODMAP ${baseline.fodmap}, Stress/Gut ${baseline.stress_gut}, Caffeine/Sleep ${baseline.caffeine_sleep}
- Previously confirmed triggers: ${known_triggers.join(", ") || "none yet"}
- Most sensitive axis historically: ${high_confidence_axes[0] || "not enough data"}

Recent flare history:
  Flare 1: [FODMAP=0.8, Stress=0.3, Caffeine/Sleep=0.2] → bloating, cramping | Triggers: garlic, onion
  Flare 2: [FODMAP=0.6, Stress=0.7, Caffeine/Sleep=0.3] → bloating, pain | Triggers: wheat, work stress
  ...

PERSONAL HISTORY INSTRUCTIONS:
- Start axis scores at their historical baseline instead of 0.5/0.5/0.5.
- Prioritize questions about their historically sensitive axes FIRST.
- If the current symptoms match a previously confirmed trigger, FLAG IT explicitly:
  "This matches a pattern we've seen before — last time [trigger] was the key factor."
- You can ask FEWER questions if the pattern clearly matches a previous flare.
  Can converge after 2 questions if high confidence.
- Reference their history naturally.
```

### System Prompt — Background Block

When the user has background data, inject this after the personal history block:

```
USER BACKGROUND:
- Sex: ${bg.sex}${bg.tracks_menstrual_cycle ? ", tracks menstrual cycle" : ""}
- IBS subtype: ${bg.ibs_subtype}
- Active medications: ${bg.active_medications.join(", ") || "none reported"}
- Dietary baseline: ${bg.dietary_baseline || "no restrictions reported"}
- Diagnosed comorbidities: ${bg.diagnosed_comorbidities.join(", ") || "none reported"}

CLINICAL IMPLICATIONS (use these to guide your questioning):
${bg.ibs_subtype === "IBS-D" ? "- IBS-D: urgency is their baseline, not a strong discriminator. Focus on SEVERITY changes." : ""}
${bg.ibs_subtype === "IBS-C" ? "- IBS-C: constipation-dominant. Bloating is expected. Look for what makes it WORSE." : ""}
${bg.active_medications.some(m => m.toLowerCase().includes("ssri")) ? "- SSRI: serotonin modulation affects motility — meal timing signals less reliable." : ""}
${bg.dietary_baseline?.toLowerCase().includes("low-fodmap") ? "- Low-FODMAP adherent: if FODMAP axis is high, look for specific sub-categories (fructans vs polyols) rather than broad FODMAP sensitivity." : ""}
${bg.tracks_menstrual_cycle ? "- Cycle tracking available: ask about cycle phase — hormonal fluctuations directly affect stress/gut axis." : ""}
${bg.diagnosed_comorbidities.some(c => c.toLowerCase().includes("anxiety")) ? "- Diagnosed anxiety: stress/gut baseline is elevated. A stress score of 0.7 is less remarkable for this patient." : ""}
```

### Convergence Handler — Record Flare

When the session converges, save the flare and post it with `user_id`:

```typescript
if (parsed.converged && parsed.sensitivity_profile) {
  const scores = parsed.sensitivity_profile.axis_scores || parsed.axis_scores;

  // Save to user profile
  const flareRecord: FlareRecord = {
    flare_id: `live-${session_id}-${Date.now()}`,
    session_id,
    timestamp: Date.now(),
    axis_scores: scores,
    confirmed_triggers: parsed.sensitivity_profile.triggers || [],
    symptoms: session.symptoms,
    primary_trigger: parsed.sensitivity_profile.primary_trigger || "",
    amplifiers: parsed.sensitivity_profile.amplifiers || [],
    summary: parsed.sensitivity_profile.primary_trigger || "",
  };
  recordFlare(session.user_id, flareRecord);

  // POST to /api/flares with user_id for trajectory visualization
  // ... (existing logic, but add user_id to the body)
  body: JSON.stringify({
    // ... existing fields ...
    user_id: session.user_id,  // ← ADD THIS
  })
}
```

### Onboarding Handler — Process Background Updates

When in ONBOARDING state and Claude returns a `background_update`:

```typescript
if (session.state === "ONBOARDING" && parsed.background_update) {
  const { field, value } = parsed.background_update;
  session.onboarding_fields_collected.push(field);

  // Accumulate background fields in session context
  session.context[`bg_${field}`] = value;

  // When transitioning to SYMPTOM_INTAKE, compile and save background
  if (parsed.state === "SYMPTOM_INTAKE") {
    const background: UserBackground = {
      sex: session.context.bg_sex as any || null,
      age_range: session.context.bg_age_range as any || null,
      ibs_subtype: session.context.bg_ibs_subtype as any || null,
      active_medications: (session.context.bg_active_medications as string[]) || [],
      dietary_baseline: session.context.bg_dietary_baseline as string || null,
      tracks_menstrual_cycle: session.context.bg_tracks_menstrual_cycle as boolean || null,
      diagnosed_comorbidities: (session.context.bg_diagnosed_comorbidities as string[]) || [],
    };
    saveBackground(session.user_id, background);

    // Recalculate initial axis scores now that background is available
    const user = getOrCreateUser(session.user_id);
    session.axis_scores = getInitialAxisScores(user);
  }
}
```

---

## Step 7: Update `src/app/page.tsx`

### Changes:
1. Generate persistent `user_id` via `localStorage` on mount
2. Pass `user_id` to `createSession()` and `sendMessage()`
3. Track `flareCount` and `converged` state
4. Pass `flareCount` and `converged` to `ChatPanel`
5. Handle `ONBOARDING` state from chat responses (treat it like `SYMPTOM_INTAKE` for draft node logic — no draft during onboarding)

### Key Implementation Details

```typescript
function getOrCreateUserId(): string {
  if (typeof window === "undefined") return "anonymous";
  let id = localStorage.getItem("gutmap_user_id");
  if (!id) {
    id = `user-${crypto.randomUUID().slice(0, 8)}`;
    localStorage.setItem("gutmap_user_id", id);
  }
  return id;
}
```

**State type expansion:**
```typescript
const [chatState, setChatState] = useState<"ONBOARDING" | "SYMPTOM_INTAKE" | "QUESTIONING" | "CONVERGED">("SYMPTOM_INTAKE");
```

**Draft node logic — do NOT create draft during onboarding:**
```typescript
const draftActive = chatState === "QUESTIONING" && !converged;
// Previously was: chatState !== "SYMPTOM_INTAKE" && !converged
// Now excludes ONBOARDING too
```

**ChatPanel props — add flareCount, converged, remove onNewFlare:**
```typescript
<ChatPanel
  messages={messages}
  axisScores={axisScores}
  sensitivityProfile={sensitivityProfile}
  onSend={handleSend}
  isLoading={isLoading}
  flareCount={flareCount}
  converged={converged}
/>
```

**Increment flareCount on convergence:**
```typescript
if (response.converged) {
  setConverged(true);
  setFlareCount((prev) => prev + 1);
  // ...
}
```

---

## Step 8: Update `src/components/ChatPanel.tsx`

### Props Change

```typescript
interface Props {
  messages: ChatMessageType[];
  axisScores: AxisScores;
  sensitivityProfile: SensitivityProfile | null;
  onSend: (message: string) => void;
  isLoading: boolean;
  flareCount: number;     // ADD
  converged: boolean;     // ADD
}
```

### UI Changes

**Header — add history badge (right side):**
```
{flareCount > 0 && (
  <div className="px-3 py-1.5 rounded-full text-[10px] tracking-wider font-medium"
    style={{ background: "rgba(78, 205, 196, 0.1)", border: "1px solid rgba(78, 205, 196, 0.25)", color: "#4ECDC4" }}>
    {flareCount} FLARE{flareCount !== 1 ? "S" : ""} ON FILE
  </div>
)}
```

**Empty state — welcome back vs first visit:**
```
{messages.length === 0 && (
  flareCount > 0 ? (
    // Returning user
    <p className="font-display text-base mb-2 text-[#4ECDC4]/70">Welcome back</p>
    <p>{flareCount} previous flares on file — your profile is loaded</p>
    <p>Describe your current symptoms to begin</p>
  ) : (
    // First visit (will go through onboarding)
    <p className="font-display text-base mb-2">Describe your symptoms</p>
    <p>Tell me about your most recent flare-up</p>
  )
)}
```

**Post-convergence message (below ProfileCard, above input):**
```
{converged && (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}>
    <p className="text-[11px] text-white/30 text-center">
      This flare has been added to your profile.
      Next time you visit, your history will be ready.
    </p>
  </motion.div>
)}
```

**Input placeholder change:**
```
placeholder={converged ? "Session complete" : "Describe your symptoms..."}
disabled={isLoading || converged}
```

---

## Step 9: Update `src/components/FlareGraphInner.tsx`

### Changes:
1. Build trajectory links between same-user flares
2. Render purple rings on user-owned flare nodes
3. Custom link rendering for trajectory lines
4. Accept and use `user_id` field on FlareNode

### Trajectory Link Builder

Add this function at the top of the file:

```typescript
function buildTrajectoryLinks(flares: FlareNode[]): Array<{ source: string; target: string }> {
  const byUser = new Map<string, FlareNode[]>();
  for (const node of flares) {
    if (!node.user_id || node.id === "__draft__") continue;
    const list = byUser.get(node.user_id) || [];
    list.push(node);
    byUser.set(node.user_id, list);
  }

  const links: Array<{ source: string; target: string }> = [];
  for (const [, nodes] of byUser) {
    if (nodes.length < 2) continue;
    nodes.sort((a, b) => a.id.localeCompare(b.id));  // chronological by ID
    for (let i = 0; i < nodes.length - 1; i++) {
      links.push({ source: nodes[i].id, target: nodes[i + 1].id });
    }
  }
  return links;
}
```

### graphData — include links

Change the return in the `useMemo` from:
```typescript
return { nodes: flares, links: [] as never[] };
```
To:
```typescript
const links = buildTrajectoryLinks(flares);
return { nodes: flares, links };
```

### nodeThreeObject — user flare ring

In the `nodeThreeObject` callback, add detection and rendering for user flares:

```typescript
const isUserFlare = !!node.user_id;
const sphereSize = isUserFlare ? 4 : 3;  // slightly larger

// After creating the sphere mesh, add a ring for user flares:
if (isUserFlare && !isDraft) {
  const ringGeo = new THREE.RingGeometry(sphereSize + 1.5, sphereSize + 2.5, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color("#C084FC"),
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  group.add(new THREE.Mesh(ringGeo, ringMat));
}

// Also increase emissive intensity for user flares:
emissiveIntensity: isDraft ? 1.0 : isNew ? 0.8 : isUserFlare ? 0.4 : 0.15,
```

### Link rendering — glowing purple trajectory lines

Add two new callbacks:

```typescript
const linkThreeObject = useCallback((link: { source: FlareNode; target: FlareNode }) => {
  const src = link.source;
  const tgt = link.target;
  const points = [
    new THREE.Vector3(src.fx ?? src.x ?? 0, src.fy ?? src.y ?? 0, src.fz ?? src.z ?? 0),
    new THREE.Vector3(tgt.fx ?? tgt.x ?? 0, tgt.fy ?? tgt.y ?? 0, tgt.fz ?? tgt.z ?? 0),
  ];
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: new THREE.Color("#C084FC"),
    transparent: true,
    opacity: 0.6,
    linewidth: 2,
  });
  return new THREE.Line(geometry, material);
}, []);

const linkPositionUpdate = useCallback(
  (lineObj: any, _: unknown, link: { source: FlareNode; target: FlareNode }) => {
    const src = link.source;
    const tgt = link.target;
    const positions = lineObj.geometry.attributes.position;
    if (positions) {
      positions.array[0] = src.fx ?? src.x ?? 0;
      positions.array[1] = src.fy ?? src.y ?? 0;
      positions.array[2] = src.fz ?? src.z ?? 0;
      positions.array[3] = tgt.fx ?? tgt.x ?? 0;
      positions.array[4] = tgt.fy ?? tgt.y ?? 0;
      positions.array[5] = tgt.fz ?? tgt.z ?? 0;
      positions.needsUpdate = true;
    }
    return true;
  },
  []
);
```

### ForceGraph3D props — add link rendering

Add these props to the `<ForceGraph3D>` component:

```typescript
linkThreeObject={linkThreeObject as never}
linkPositionUpdate={linkPositionUpdate as never}
linkDirectionalArrowLength={4}
linkDirectionalArrowRelPos={0.85}
linkDirectionalArrowColor={() => "#C084FC"}
```

---

## Step 10: Update `preprocess.py` — Background in Pipeline

### What Changes

1. Seed flares get synthetic `background` fields with plausible demographics
2. Generated narratives prompt includes demographic context
3. Feature vector gains background features (8) + interaction terms (4) = 12 new dimensions
4. Total feature vector: 16 structured triggers + 12 background/interaction + 3072 embedding = 3100 dims
5. Output JSON gains `background` field per node (for hover tooltips)

### Seed Data — Synthetic Backgrounds

Each phenotype gets a plausible demographic distribution. Add a `background` field to each seed flare:

```python
PHENOTYPE_BACKGROUNDS = {
    "A": {  # Caffeine/Sleep — skews younger, poor sleep habits
        "sex_dist": [("female", 0.5), ("male", 0.45), ("other", 0.05)],
        "age_dist": [("18-25", 0.35), ("26-35", 0.35), ("36-45", 0.2), ("46-55", 0.1)],
        "ibs_subtype_dist": [("IBS-D", 0.6), ("IBS-M", 0.25), ("unsure", 0.15)],
        "medication_chance": 0.2,     # lower medication usage
        "anxiety_comorbidity": 0.15,
        "low_fodmap_chance": 0.05,    # rarely on FODMAP diet
    },
    "B": {  # FODMAP — even distribution, some already low-FODMAP
        "sex_dist": [("female", 0.55), ("male", 0.4), ("other", 0.05)],
        "age_dist": [("18-25", 0.2), ("26-35", 0.3), ("36-45", 0.3), ("46-55", 0.15), ("56+", 0.05)],
        "ibs_subtype_dist": [("IBS-C", 0.4), ("IBS-M", 0.3), ("IBS-D", 0.2), ("unsure", 0.1)],
        "medication_chance": 0.3,
        "anxiety_comorbidity": 0.2,
        "low_fodmap_chance": 0.25,    # some already trying FODMAP
    },
    "C": {  # Stress — higher anxiety comorbidity, more SSRI usage
        "sex_dist": [("female", 0.6), ("male", 0.35), ("other", 0.05)],
        "age_dist": [("26-35", 0.35), ("36-45", 0.3), ("18-25", 0.2), ("46-55", 0.15)],
        "ibs_subtype_dist": [("IBS-D", 0.45), ("IBS-M", 0.35), ("unsure", 0.2)],
        "medication_chance": 0.5,     # higher — SSRIs common
        "anxiety_comorbidity": 0.55,  # much higher
        "low_fodmap_chance": 0.1,
    },
}

def generate_background(phenotype: str) -> dict:
    """Generate a plausible synthetic background for a given phenotype."""
    config = PHENOTYPE_BACKGROUNDS.get(phenotype, PHENOTYPE_BACKGROUNDS["B"])

    sex = random.choices(
        [s for s, _ in config["sex_dist"]],
        weights=[w for _, w in config["sex_dist"]]
    )[0]
    age = random.choices(
        [a for a, _ in config["age_dist"]],
        weights=[w for _, w in config["age_dist"]]
    )[0]
    subtype = random.choices(
        [s for s, _ in config["ibs_subtype_dist"]],
        weights=[w for _, w in config["ibs_subtype_dist"]]
    )[0]

    medications = []
    if random.random() < config["medication_chance"]:
        if phenotype == "C":
            medications.append(random.choice(["SSRI", "SNRI"]))
        else:
            medications.append(random.choice(["PPI", "antispasmodic"]))
    if sex == "female" and random.random() < 0.3:
        medications.append("hormonal birth control")

    comorbidities = []
    if random.random() < config["anxiety_comorbidity"]:
        comorbidities.append("anxiety disorder")
    if sex == "female" and random.random() < 0.08:
        comorbidities.append("endometriosis")

    dietary = None
    if random.random() < config["low_fodmap_chance"]:
        dietary = "low-FODMAP"
    elif random.random() < 0.1:
        dietary = "vegetarian"

    tracks_cycle = sex == "female" and random.random() < 0.4

    return {
        "sex": sex,
        "age_range": age,
        "ibs_subtype": subtype,
        "active_medications": medications,
        "dietary_baseline": dietary,
        "tracks_menstrual_cycle": tracks_cycle,
        "diagnosed_comorbidities": comorbidities,
    }
```

Call `generate_background(config["phenotype"])` inside the seed flare loop and store as `flare["background"]`. For bridge/mixed flares, randomly pick one of the parent phenotypes for the background distribution.

For generated narratives (Step 2), the narratives don't need backgrounds embedded in their text — the backgrounds are assigned independently and stored alongside the extracted data. After extraction, assign backgrounds:

```python
# After extract_flares(), assign random backgrounds to generated posts
for post in extracted_posts:
    # Infer likely phenotype from extracted triggers for background assignment
    kt = post.get("extracted", {}).get("known_triggers", {})
    if normalize("fodmap_load", kt.get("fodmap_load")) > 0.6:
        bg_pheno = "B"
    elif normalize("stress_level", kt.get("stress_level")) > 0.6:
        bg_pheno = "C"
    elif kt.get("caffeine_before_food") == True:
        bg_pheno = "A"
    else:
        bg_pheno = random.choice(["A", "B", "C"])
    post["background"] = generate_background(bg_pheno)
```

### Feature Vector — Background + Interactions

Add these to `build_feature_vector`:

```python
# ── Background feature encoding ─────────────────────────────────────────────

SEX_ENCODING = {"female": 0.0, "male": 1.0, "other": 0.5, None: 0.5}
AGE_ENCODING = {"18-25": 0.2, "26-35": 0.4, "36-45": 0.6, "46-55": 0.8, "56+": 1.0, None: 0.5}
SUBTYPE_ENCODING = {"IBS-D": 0.0, "IBS-M": 0.5, "IBS-C": 1.0, "unsure": 0.5, None: 0.5}

def build_background_features(background: dict | None) -> np.ndarray:
    """Encode background into 8 features, all normalized to [0,1]."""
    if background is None:
        return np.full(8, 0.5)  # neutral defaults

    bg = background
    return np.array([
        SEX_ENCODING.get(bg.get("sex"), 0.5),
        AGE_ENCODING.get(bg.get("age_range"), 0.5),
        SUBTYPE_ENCODING.get(bg.get("ibs_subtype"), 0.5),
        float(any("ssri" in m.lower() or "snri" in m.lower() for m in bg.get("active_medications", []))),
        float(any("ppi" in m.lower() for m in bg.get("active_medications", []))),
        float(any("hormonal" in m.lower() or "birth control" in m.lower() for m in bg.get("active_medications", []))),
        float("low-fodmap" in (bg.get("dietary_baseline") or "").lower()),
        float(any("anxiety" in c.lower() for c in bg.get("diagnosed_comorbidities", []))),
    ])

# Indices for interaction terms
FODMAP_IDX = FEATURE_KEYS.index("fodmap_load")
STRESS_IDX = FEATURE_KEYS.index("stress_level")
CAFFEINE_IDX = FEATURE_KEYS.index("caffeine_before_food")
# Background indices (within bg_features): sex=0, age=1, subtype=2, ssri=3, ppi=4, hbc=5, lowfodmap=6, anxiety=7

def build_interaction_features(trigger_features: np.ndarray, bg_features: np.ndarray) -> np.ndarray:
    """Compute interaction terms between triggers and background. 4 features."""
    return np.array([
        trigger_features[FODMAP_IDX] * bg_features[6],    # FODMAP × already low-FODMAP
        trigger_features[STRESS_IDX] * bg_features[3],    # stress × on SSRI
        trigger_features[CAFFEINE_IDX] * bg_features[1],  # caffeine × age (metabolism)
        trigger_features[STRESS_IDX] * bg_features[7],    # stress × anxiety comorbidity
    ])
```

### Updated `build_vectors` Function

```python
def build_vectors(flares):
    cached = load_np_cache("vectors.npy")
    if cached is not None:
        return cached

    vecs = []
    for i, flare in enumerate(flares):
        print(f"Embedding {i+1}/{len(flares)}: {flare['id']}")
        ex = flare.get("extracted", {})

        layer1 = build_layer1(flare) * 3.0       # 16 trigger features, highest weight

        bg_features = build_background_features(flare.get("background"))
        bg_weighted = bg_features * 1.5           # 8 background features, moderate weight

        interactions = build_interaction_features(build_layer1(flare), bg_features)
        interactions_weighted = interactions * 2.0  # 4 interaction features, high weight

        open_text = " ".join([
            *ex.get("dietary_details", []),
            *ex.get("physiological_details", []),
            *ex.get("psychological_details", []),
            *ex.get("behavioral_details", []),
            *ex.get("novel_factors", [])
        ]).strip()
        layer2 = embed_text(open_text) * 1.0 if open_text else np.zeros(1536)

        raw = flare.get("narrative", "") or ex.get("open_narrative_summary", "")
        layer3 = embed_text(raw) * 0.5 if raw else np.zeros(1536)

        vecs.append(np.concatenate([layer1, bg_weighted, interactions_weighted, layer2, layer3]))
        time.sleep(0.1)

    matrix = np.array(vecs)
    save_np_cache(matrix, "vectors.npy")
    return matrix
```

**IMPORTANT:** Adding background features changes the vector dimensionality. You MUST delete `cache/vectors.npy` and `cache/pipeline.pkl` before re-running the pipeline, or the cached data will have the wrong shape.

### Output — Include Background Summary

In `build_output`, add a `background_summary` field to each node for hover tooltips:

```python
def summarize_background(bg: dict | None) -> str | None:
    if bg is None:
        return None
    parts = []
    if bg.get("sex"): parts.append(bg["sex"])
    if bg.get("age_range"): parts.append(bg["age_range"])
    if bg.get("ibs_subtype"): parts.append(bg["ibs_subtype"])
    if bg.get("active_medications"): parts.append(", ".join(bg["active_medications"]))
    return " · ".join(parts) if parts else None

# In build_output, add to each node:
"background_summary": summarize_background(flare.get("background")),
```

---

## Step 11: Cache Invalidation

After making changes to `preprocess.py`, delete ALL cached files before re-running:

```bash
rm -rf cache/
rm -f public/flares_processed.json
```

This is necessary because:
- `vectors.npy` has a different dimensionality (12 more features per vector)
- `pipeline.pkl` was fit on old-dimensionality vectors
- `extracted.json` and `generated_narratives.json` can be kept if only background/vector logic changed

---

## Execution Order

```bash
# 1. Create new files
#    src/lib/userStore.ts
#    src/app/api/user/route.ts

# 2. Update existing files (in this order to avoid import errors)
#    src/lib/types.ts          ← add UserBackground, user_id, ONBOARDING state
#    src/lib/api.ts            ← add user_id params
#    src/app/api/session/new/route.ts  ← accept user_id
#    src/app/api/chat/route.ts         ← ONBOARDING state, history injection, background injection
#    src/app/page.tsx                  ← persistent userId, flareCount, converged
#    src/components/ChatPanel.tsx      ← history badge, welcome-back, post-convergence
#    src/components/FlareGraphInner.tsx ← trajectory links, user rings

# 3. Update preprocessing pipeline
#    preprocess.py             ← background generation, feature vector expansion
#    rm -rf cache/ public/flares_processed.json
#    python preprocess.py      ← or: modal run preprocess.py

# 4. Verify
#    npm run dev
#    Open localhost:3000
#    First visit: should see onboarding questions
#    Complete a flare → refresh → should see "Welcome back" + history badge
#    Complete second flare → should converge faster + trajectory line in graph
```

---

## Demo Script

**0:00–0:20** — Open app cold. Agent asks: "Before we dig in, do you know your IBS subtype?" → IBS-D. "Any medications?" → SSRI. "Any dietary protocol?" → No restrictions. Agent: "Great, tell me about your symptoms."

**0:20–1:00** — "I'm having urgency and bloating this morning." Agent asks about caffeine (knows IBS-D = urgency-dominant, so caffeine is the discriminator). "Yes, coffee before eating." Agent asks about sleep. "Maybe 5 hours." Converges: Caffeine/Sleep profile. Node appears in graph with purple ring.

**1:00–1:20** — Message: "This flare has been added to your profile. Next time you visit, your history will be ready." Refresh the page.

**1:20–1:40** — Badge: "1 FLARE ON FILE". Empty state: "Welcome back." Type: "Cramping and bloating after dinner last night." Agent immediately says: "This is a different pattern from your last flare — last time caffeine was the trigger. Did you eat any high-FODMAP foods like garlic or onion?" Converges in 2 questions.

**1:40–2:00** — Second node appears in graph. Purple trajectory line connects the two flares — the user moved from the Caffeine cluster to the FODMAP cluster. "This patient's triggers aren't static — they're poly-sensitive across axes."

**2:00–2:30** — Zoom out to full graph: "Every node in this graph was embedded with both trigger data AND patient background — age, sex, medications, IBS subtype. The clusters you see aren't just symptom groups, they're clinical endotypes. And the trajectory lines show how patients move between them."

**2:30–3:00** — Pitch: "IBS affects 15% of people. Current trigger discovery takes months. GutMap does it in 3 questions, gets smarter every visit, and learns from the entire cohort."
