import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { getOrCreateUser, updateBackground, recordFlare, getUserSummary, getInitialAxisScores } from "@/lib/userStore";

const client = new Anthropic();

// Cache cluster metadata at module level
let clusterMetadataCache: Record<string, { label: string; color: string; description: string; size: number; centroid_features?: Record<string, number> }> | null = null;
function loadClusterMetadata() {
  if (clusterMetadataCache) return clusterMetadataCache;
  const metaPath = path.join(process.cwd(), "public/cluster_metadata.json");
  if (fs.existsSync(metaPath)) {
    clusterMetadataCache = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  } else {
    clusterMetadataCache = {};
  }
  return clusterMetadataCache!;
}

type ConversationState = "ONBOARDING" | "SYMPTOM_INTAKE" | "QUESTIONING" | "CONVERGED";

interface AxisScores {
  fodmap: number;
  stress_gut: number;
  caffeine_sleep: number;
}

interface Session {
  state: ConversationState;
  user_id?: string;
  symptoms: string[];
  context: Record<string, unknown>;
  axis_scores: AxisScores;
  questions_asked: string[];
  history: Array<{ role: "user" | "assistant"; content: string }>;
  converged_cluster?: number;
}

// Use globalThis to survive Next.js HMR in dev mode
const globalChat = globalThis as unknown as { __gutmap_sessions?: Map<string, Session> };
if (!globalChat.__gutmap_sessions) {
  globalChat.__gutmap_sessions = new Map<string, Session>();
}
const sessions = globalChat.__gutmap_sessions;

const SENSITIVITY_AXES = `
SENSITIVITY AXES — these are INDEPENDENT scores (0-1 each), NOT probabilities that sum to 1.
A patient can score high on ALL three axes simultaneously.

FODMAP AXIS (0-1)
  Key signals: high-FODMAP foods (onion, garlic, wheat, lactose, fructose, legumes), bloating/gas/cramping 1-4hrs after eating
  Scientific basis: Monash University FODMAP research, fermentation by gut bacteria

STRESS / GUT-BRAIN AXIS (0-1)
  Key signals: stress_level>3, anxiety high, skipped meals, disrupted routine, travel
  Symptoms: pain, diarrhea, nausea. Often delayed onset.
  Scientific basis: HPA axis — cortisol directly affects gut motility

CAFFEINE / SLEEP AXIS (0-1)
  Key signals: caffeine_before_food=true, sleep_hours<6, irregular meal timing
  Symptoms: urgency, loose stools, morning flares
  Scientific basis: caffeine stimulates colonic motility; sleep deprivation elevates cortisol

CROSS-AXIS INTERACTIONS (important!):
- Stress amplifies FODMAP reactivity — a food that's normally tolerable can cause severe symptoms during high-stress periods
- Poor sleep + caffeine compounds urgency symptoms
- Anxiety + FODMAP foods often creates worse bloating than either alone
- Most real patients are poly-sensitive across 2+ axes
`;

function buildSystemPrompt(session: Session): string {
  // Build background context if user has one
  let backgroundContext = "";
  let personalHistoryContext = "";
  if (session.user_id) {
    const summary = getUserSummary(session.user_id);
    if (summary.has_background && summary.background) {
      const bg = summary.background;
      backgroundContext = `\nUSER BACKGROUND:
- Age range: ${bg.age_range || "unknown"}
- Sex: ${bg.sex || "unknown"}
- IBS subtype: ${bg.ibs_subtype || "unknown"}
- Diagnosed: ${bg.diagnosed ? "yes" : "no"}
- Onset period: ${bg.onset_period || "unknown"}
- Known triggers: ${bg.known_triggers?.join(", ") || "none specified"}
- Active medications: ${bg.active_medications?.join(", ") || "none"}
- Dietary baseline: ${bg.dietary_baseline || "not specified"}
- Tracks menstrual cycle: ${bg.tracks_menstrual_cycle === null ? "not asked" : bg.tracks_menstrual_cycle ? "yes" : "no"}
- Diagnosed comorbidities: ${bg.diagnosed_comorbidities?.join(", ") || "none"}`;

      // Clinical implications
      const implications: string[] = [];
      if (bg.ibs_subtype === "IBS-D") implications.push("IBS-D: urgency is baseline — focus on severity changes, not presence of urgency");
      if (bg.ibs_subtype === "IBS-C") implications.push("IBS-C: bloating is expected — look for what makes it worse, not its presence");
      if (bg.active_medications?.some((m) => /ssri|sertraline|fluoxetine|escitalopram|paroxetine/i.test(m))) {
        implications.push("SSRI: serotonin modulation affects motility — stress_gut baseline is dampened");
      }
      if (bg.dietary_baseline && /low.?fodmap/i.test(bg.dietary_baseline)) {
        implications.push("Low-FODMAP diet: look for specific sub-categories (fructans vs lactose vs polyols) rather than broad FODMAP load");
      }
      if (bg.tracks_menstrual_cycle) implications.push("Tracks menstrual cycle: ask about cycle phase when relevant");
      if (bg.diagnosed_comorbidities?.some((c) => /anxiety|gad|panic/i.test(c))) {
        implications.push("Anxiety comorbidity: stress score ~0.7 is less remarkable — look for spikes above their elevated baseline");
      }
      if (implications.length > 0) {
        backgroundContext += `\n\nCLINICAL IMPLICATIONS:\n${implications.map((i) => `- ${i}`).join("\n")}`;
      }
    }

    // Personal history block for returning users
    if (summary.flare_count > 0) {
      personalHistoryContext = `\nPERSONAL HISTORY (${summary.flare_count} previous flare${summary.flare_count > 1 ? "s" : ""} on file):`;
      if (summary.personal_baseline) {
        personalHistoryContext += `\n- Baseline sensitivity: fodmap=${summary.personal_baseline.fodmap.toFixed(2)}, stress_gut=${summary.personal_baseline.stress_gut.toFixed(2)}, caffeine_sleep=${summary.personal_baseline.caffeine_sleep.toFixed(2)}`;
      }
      if (summary.known_triggers && summary.known_triggers.length > 0) {
        personalHistoryContext += `\n- Previously confirmed triggers (appeared in 2+ flares): ${summary.known_triggers.join(", ")}`;
      }
      if (summary.high_confidence_axes && summary.high_confidence_axes.length > 0) {
        personalHistoryContext += `\n- Most sensitive axis historically: ${summary.high_confidence_axes.join(", ")}`;
      }
      // Recent flare summaries (last 5)
      if (summary.flare_history && summary.flare_history.length > 0) {
        const recent = summary.flare_history.slice(-5);
        personalHistoryContext += `\n- Recent flares:`;
        for (const flare of recent) {
          personalHistoryContext += `\n  • ${flare.timestamp}: scores={fodmap: ${flare.axis_scores.fodmap.toFixed(2)}, stress_gut: ${flare.axis_scores.stress_gut.toFixed(2)}, caffeine_sleep: ${flare.axis_scores.caffeine_sleep.toFixed(2)}}, trigger="${flare.primary_trigger}", symptoms=[${flare.symptoms.join(", ")}]`;
        }
      }
      personalHistoryContext += `\n\nHISTORY-INFORMED INSTRUCTIONS:
- Prioritize historically sensitive axes in your questioning
- Flag if current symptoms match a known pattern from previous flares
- If pattern strongly matches a previous flare, you may converge faster (after 2 questions instead of 3)
- Reference their history naturally: "Last time you had similar symptoms, it was stress-related..."`;
    }
  }

  if (session.state === "ONBOARDING") {
    return `You are GutMap, an AI investigating IBS flare-up triggers. You are in ONBOARDING mode — getting to know a new user.

Ask conversational questions to learn about them. You need:
- Age range and sex
- IBS subtype (IBS-D/C/M/U or unsure)
- Whether they've been diagnosed and how long they've had symptoms
- Any known triggers
- Current medications (especially SSRIs, antispasmodics, PPIs)
- Dietary approach (e.g., low-FODMAP, elimination diet, no specific diet)
- Whether they track their menstrual cycle (if relevant)
- Any diagnosed comorbidities (anxiety, depression, GERD, endometriosis, etc.)

Ask 2-3 questions in a warm, friendly way. Don't be clinical. After you have enough info, set background_complete=true.

RESPONSE FORMAT — respond with ONLY this JSON:
{
  "reply": "your conversational message",
  "state": "ONBOARDING",
  "axis_scores": {"fodmap": 0.5, "stress_gut": 0.5, "caffeine_sleep": 0.5},
  "converged": false,
  "sensitivity_profile": null,
  "symptoms": [],
  "context_update": {},
  "question_field": null,
  "background_update": null,
  "background_complete": false
}

When you have gathered enough background info, set:
- "background_update": {"age_range": "...", "sex": "...", "ibs_subtype": "...", "diagnosed": true/false, "onset_period": "...", "known_triggers": ["..."], "active_medications": ["..."], "dietary_baseline": "...", "tracks_menstrual_cycle": true/false/null, "diagnosed_comorbidities": ["..."]}
- "background_complete": true
- "state": "SYMPTOM_INTAKE"`;
  }

  return `You are GutMap, an AI investigating IBS flare-up triggers using independent sensitivity axis scoring.

${SENSITIVITY_AXES}
${backgroundContext}
${personalHistoryContext}

CURRENT SESSION STATE:
- Symptoms reported: ${session.symptoms.join(", ") || "none yet"}
- Context collected: ${JSON.stringify(session.context)}
- Current axis scores: ${JSON.stringify(session.axis_scores)}
- Questions already asked: ${session.questions_asked.join("; ") || "none"}
- State: ${session.state}

RULES:
1. In SYMPTOM_INTAKE state: parse symptoms from the user's message, set initial axis scores based on symptom pattern, transition to QUESTIONING, ask the first discriminating question.
2. In QUESTIONING state: ask ONE targeted question that helps refine the axis scores. Focus on questions that reveal cross-axis interactions (e.g., "Did stress make the reaction worse?"). Never repeat a question already asked.
3. CONVERGE when: (a) 3+ questions asked AND scores have stabilized (changes < 0.1), OR (b) after 5 questions max.
4. Keep responses SHORT — 1-2 sentences max. This is a chat interface.
5. Be warm and conversational, not clinical.
6. Remember: axes are INDEPENDENT. If evidence suggests high FODMAP AND high stress, BOTH should be high. Do NOT force them to compete.

RESPONSE FORMAT — respond with ONLY this JSON:
{
  "reply": "your message to the user",
  "state": "SYMPTOM_INTAKE | QUESTIONING | CONVERGED",
  "axis_scores": {"fodmap": 0.5, "stress_gut": 0.5, "caffeine_sleep": 0.5},
  "converged": false,
  "sensitivity_profile": null,
  "symptoms": ["extracted", "symptom", "keywords"],
  "context_update": {},
  "question_field": "field name you just asked about or null"
}

If converged=true, sensitivity_profile must be:
{
  "axis_scores": {"fodmap": 0.0, "stress_gut": 0.0, "caffeine_sleep": 0.0},
  "primary_trigger": "description of the dominant trigger pattern, e.g. 'FODMAP foods, significantly worsened by stress'",
  "amplifiers": ["list of cross-axis amplification effects observed, e.g. 'stress amplifies FODMAP reactivity'"],
  "confidence": 0.0,
  "triggers": ["specific triggers identified"]
}

IMPORTANT — when you converge, your "reply" MUST include 2-3 IMMEDIATE, PRACTICAL REMEDIES the user can do RIGHT NOW to feel better. These should be concrete relief actions, not prevention tips. Examples:
- "Sip hot water or peppermint tea — it relaxes intestinal smooth muscle and can ease cramping within 15-20 min"
- "Try lying on your left side with knees pulled up — this helps trapped gas move through"
- "Place a heating pad or warm towel on your lower abdomen for 10 min to calm the spasms"
- "Take slow diaphragmatic breaths (4 sec in, 6 sec out) — this activates your vagus nerve and slows gut contractions"
- "If you have peppermint oil capsules, take one now — they're clinically shown to reduce IBS pain"
- "Avoid eating anything else for the next 1-2 hours to let your gut settle"
Tailor remedies to their specific symptoms (bloating → gas relief positions, cramping → heat + peppermint, urgency → breathing + sitting still, nausea → ginger or cold compress on wrist). Be specific to what THEY are experiencing.`;
}

export async function POST(request: Request) {
  const { session_id, message, user_id } = await request.json();

  if (!sessions.has(session_id)) {
    // Determine initial state — ONBOARDING for new users without background
    let initialState: ConversationState = "SYMPTOM_INTAKE";
    if (user_id) {
      const userProfile = getOrCreateUser(user_id);
      if (!userProfile.background) {
        initialState = "ONBOARDING";
      }
    }

    const initialScores = user_id ? getInitialAxisScores(user_id) : { fodmap: 0.5, stress_gut: 0.5, caffeine_sleep: 0.5 };
    sessions.set(session_id, {
      state: initialState,
      user_id,
      symptoms: [],
      context: {},
      axis_scores: initialScores,
      questions_asked: [],
      history: [],
    });
  }

  const session = sessions.get(session_id)!;

  if (session.state === "CONVERGED") {
    // Post-convergence: crowd-sourced advice from cluster neighbors
    session.history.push({ role: "user", content: message });

    // Gather cluster neighbor data
    let neighborContext = "";
    const clusterId = session.converged_cluster;
    if (clusterId !== undefined && clusterId !== -1) {
      try {
        const flaresPath = path.join(process.cwd(), "public/flares_processed.json");
        if (fs.existsSync(flaresPath)) {
          const allFlares = JSON.parse(fs.readFileSync(flaresPath, "utf-8")) as Array<{
            clusterId?: number;
            summary?: string;
            symptoms?: string[];
            axis_scores?: Record<string, number>;
          }>;
          const neighbors = allFlares
            .filter((f) => f.clusterId === clusterId)
            .slice(0, 8);

          if (neighbors.length > 0) {
            neighborContext = `\nCLUSTER NEIGHBOR DATA (${neighbors.length} people with similar trigger profiles):\n`;
            for (const n of neighbors) {
              neighborContext += `- Summary: ${n.summary || "n/a"}, Symptoms: [${(n.symptoms || []).join(", ")}], Scores: ${JSON.stringify(n.axis_scores || {})}\n`;
            }
          }
        }
      } catch {
        // non-fatal
      }

      // Add cluster metadata
      const meta = loadClusterMetadata();
      const clusterInfo = meta[String(clusterId)];
      if (clusterInfo) {
        neighborContext += `\nCLUSTER INFO: "${clusterInfo.label}" — ${clusterInfo.description}\n`;
      }
    }

    const adviceSystemPrompt = `You are GutMap, a post-analysis advisor for IBS trigger management. The user has already completed their flare investigation and been mapped to a cluster of similar patients.

YOUR USER'S PROFILE:
- Axis scores: ${JSON.stringify(session.axis_scores)}
- Symptoms: ${session.symptoms.join(", ") || "unknown"}
${neighborContext}

INSTRUCTIONS:
- Give specific, actionable advice grounded in what others in this cluster experience
- Reference "people in your cluster" or "others with similar triggers" when making recommendations
- Draw on the neighbor data above to identify common patterns and effective strategies
- Keep responses concise (2-4 sentences) and warm
- You can suggest dietary changes, lifestyle adjustments, tracking strategies, etc.
- Do NOT give medical diagnoses or suggest prescription medications
- Continue the conversation naturally — the user may ask follow-up questions`;

    const adviceResponse = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: adviceSystemPrompt,
      messages: session.history,
    });

    const adviceText = adviceResponse.content[0].type === "text" ? adviceResponse.content[0].text : "I'm here to help — could you ask that again?";
    session.history.push({ role: "assistant", content: adviceText });

    return NextResponse.json({
      reply: adviceText,
      state: "CONVERGED",
      axis_scores: session.axis_scores,
      converged: true,
      sensitivity_profile: null,
    });
  }

  // Add user message to history
  session.history.push({ role: "user", content: message });

  // Call Claude
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    system: buildSystemPrompt(session),
    messages: session.history,
  });

  const rawText = response.content[0].type === "text" ? response.content[0].text : "";

  let parsed;
  try {
    const clean = rawText.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(clean);
  } catch {
    parsed = {
      reply: "Sorry, something went wrong. Could you describe your symptoms again?",
      state: session.state,
      axis_scores: session.axis_scores,
      converged: false,
      sensitivity_profile: null,
      context_update: {},
      question_field: null,
    };
  }

  // Update session state
  session.state = parsed.state;
  session.axis_scores = parsed.axis_scores || session.axis_scores;
  if (parsed.context_update) {
    session.context = { ...session.context, ...parsed.context_update };
  }
  if (parsed.symptoms?.length) {
    session.symptoms = parsed.symptoms;
  }
  if (parsed.question_field) {
    session.questions_asked.push(parsed.question_field);
  }

  // Handle ONBOARDING → background update
  if (parsed.background_complete && parsed.background_update && session.user_id) {
    updateBackground(session.user_id, parsed.background_update);
    session.state = "SYMPTOM_INTAKE";
    parsed.state = "SYMPTOM_INTAKE";
  }

  // Add assistant reply to history
  session.history.push({ role: "assistant", content: parsed.reply });

  // If converged, add flare to graph
  if (parsed.converged && parsed.sensitivity_profile) {
    const scores = parsed.sensitivity_profile.axis_scores || parsed.axis_scores;
    const meta = loadClusterMetadata();

    // Score each cluster's centroid_features against axis scores to find best match
    let bestCluster = -1;
    let bestScore = -Infinity;
    const AXIS_FEATURE_MAP: Record<string, string[]> = {
      caffeine_sleep: ["caffeine_before_food", "caffeine_x_sleep"],
      fodmap: ["fodmap_load", "stress_x_fodmap", "anxiety_x_fodmap"],
      stress_gut: ["stress_level", "anxiety_level", "stress_x_fodmap"],
    };

    for (const [clusterIdStr, clusterMeta] of Object.entries(meta)) {
      const cid = Number(clusterIdStr);
      if (cid === -1) continue;
      const cf = clusterMeta.centroid_features;
      if (!cf) continue;

      let score = 0;
      for (const [axis, axisScore] of Object.entries(scores)) {
        const featureKeys = AXIS_FEATURE_MAP[axis] || [];
        for (const fk of featureKeys) {
          score += (cf[fk] ?? 0) * (axisScore as number);
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestCluster = cid;
      }
    }

    // Fallback: hardcoded mapping if no cluster metadata
    if (bestCluster === -1) {
      const AXIS_TO_CLUSTER: Record<string, number> = { fodmap: 1, stress_gut: 2, caffeine_sleep: 0 };
      let maxAxis = "fodmap";
      let maxVal = 0;
      for (const [axis, score] of Object.entries(scores)) {
        if ((score as number) > maxVal) { maxVal = score as number; maxAxis = axis; }
      }
      bestCluster = AXIS_TO_CLUSTER[maxAxis] ?? -1;
    }

    session.converged_cluster = bestCluster;
    const clusterColor = meta[String(bestCluster)]?.color ?? "#888888";
    const flareId = `live-${session_id}-${Date.now()}`;
    const createdAt = new Date().toISOString();

    const flareNode = {
      id: flareId,
      label: session.symptoms.slice(0, 2).join(" + ") || "new flare",
      symptoms: session.symptoms,
      clusterId: bestCluster,
      color: clusterColor,
      confidence: parsed.sensitivity_profile.confidence,
      synthetic: false,
      summary: `Live session: ${parsed.sensitivity_profile.primary_trigger}`,
      novel_factors: [],
      axis_scores: scores,
      user_id: session.user_id,
      created_at: createdAt,
      x: null, y: null, z: null,
    };

    try {
      const origin = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";
      await fetch(`${origin}/api/flares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(flareNode),
      });
    } catch {
      // non-fatal
    }

    // Save to user history as FlareRecord
    if (session.user_id) {
      recordFlare(session.user_id, {
        session_id,
        timestamp: createdAt,
        axis_scores: scores,
        symptoms: session.symptoms,
        confirmed_triggers: parsed.sensitivity_profile.triggers || [],
        primary_trigger: parsed.sensitivity_profile.primary_trigger || "",
        amplifiers: parsed.sensitivity_profile.amplifiers || [],
        summary: `${parsed.sensitivity_profile.primary_trigger}`,
      });
    }
  }

  return NextResponse.json({
    reply: parsed.reply,
    state: parsed.state,
    axis_scores: parsed.axis_scores,
    converged: parsed.converged,
    sensitivity_profile: parsed.sensitivity_profile,
  });
}
