import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

type ConversationState = "SYMPTOM_INTAKE" | "QUESTIONING" | "CONVERGED";

interface Session {
  state: ConversationState;
  symptoms: string[];
  context: Record<string, unknown>;
  phenotype_probs: Record<string, number>;
  questions_asked: string[];
  history: Array<{ role: "user" | "assistant"; content: string }>;
}

const sessions = new Map<string, Session>();

const PHENOTYPE_DEFINITIONS = `
PHENOTYPE A — Caffeine/Sleep-Sensitive IBS
  Key discriminators: caffeine_before_food=true, sleep_hours<6
  Symptoms: urgency, bloating
  Scientific basis: caffeine stimulates colonic motility; sleep deprivation elevates cortisol

PHENOTYPE B — FODMAP-Sensitive IBS
  Key discriminators: high fodmap foods (onion, garlic, wheat, lactose, fructose)
  Symptoms: bloating, cramping, gas, distension
  Scientific basis: Monash University FODMAP research, fermentation by gut bacteria

PHENOTYPE C — Stress/Gut-Brain IBS
  Key discriminators: stress_level>3, meal_skipped=true, anxiety high
  Symptoms: pain, diarrhea, nausea
  Scientific basis: HPA axis — cortisol directly affects gut motility
`;

function buildSystemPrompt(session: Session): string {
  return `You are GutMap, an AI investigating IBS flare-up triggers using Bayesian hypothesis testing.

${PHENOTYPE_DEFINITIONS}

CURRENT SESSION STATE:
- Symptoms reported: ${session.symptoms.join(", ") || "none yet"}
- Context collected: ${JSON.stringify(session.context)}
- Phenotype probabilities: ${JSON.stringify(session.phenotype_probs)}
- Questions already asked: ${session.questions_asked.join("; ") || "none"}
- State: ${session.state}

RULES:
1. In SYMPTOM_INTAKE state: parse symptoms from the user's message, set initial phenotype probs, transition to QUESTIONING, ask the first discriminating question
2. In QUESTIONING state: ask ONE targeted yes/no question that best discriminates between the top 2 phenotype candidates. Never repeat a question already asked. Update probs mentally based on prior answers.
3. CONVERGE when top phenotype probability would exceed 0.70 after this round (max 4 questions)
4. Keep responses SHORT — 1-2 sentences max. This is a chat interface.
5. Be warm and conversational, not clinical.

RESPONSE FORMAT — respond with ONLY this JSON:
{
  "reply": "your message to the user",
  "state": "SYMPTOM_INTAKE | QUESTIONING | CONVERGED",
  "phenotype_probs": {"A": 0.0, "B": 0.0, "C": 0.0},
  "converged": false,
  "phenotype_match": null,
  "context_update": {},
  "question_field": "field name you just asked about or null"
}

If converged=true, phenotype_match must be:
{
  "label": "FODMAP-Sensitive IBS | Caffeine/Sleep-Sensitive IBS | Stress/Gut-Brain IBS",
  "confidence": 0.0,
  "triggers": [],
  "population_pct": 0.0
}`;
}

export async function POST(request: Request) {
  const { session_id, message } = await request.json();

  if (!sessions.has(session_id)) {
    sessions.set(session_id, {
      state: "SYMPTOM_INTAKE",
      symptoms: [],
      context: {},
      phenotype_probs: { A: 0.33, B: 0.33, C: 0.34 },
      questions_asked: [],
      history: [],
    });
  }

  const session = sessions.get(session_id)!;

  if (session.state === "CONVERGED") {
    return NextResponse.json({
      reply: "Your session is complete. Refresh to investigate a new flare.",
      state: "CONVERGED",
      phenotype_probs: session.phenotype_probs,
      converged: true,
      phenotype_match: null,
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
      phenotype_probs: session.phenotype_probs,
      converged: false,
      phenotype_match: null,
      context_update: {},
      question_field: null,
    };
  }

  // Update session state
  session.state = parsed.state;
  session.phenotype_probs = parsed.phenotype_probs || session.phenotype_probs;
  if (parsed.context_update) {
    session.context = { ...session.context, ...parsed.context_update };
  }
  if (parsed.question_field) {
    session.questions_asked.push(parsed.question_field);
  }

  // Add assistant reply to history
  session.history.push({ role: "assistant", content: parsed.reply });

  // If converged, add flare to graph
  if (parsed.converged && parsed.phenotype_match) {
    const CLUSTER_IDS: Record<string, number> = {
      "Caffeine/Sleep-Sensitive IBS": 0,
      "FODMAP-Sensitive IBS": 1,
      "Stress/Gut-Brain IBS": 2,
    };
    const CLUSTER_COLORS: Record<number, string> = {
      0: "#FF6B6B", 1: "#4ECDC4", 2: "#FFE66D",
    };
    const clusterId = CLUSTER_IDS[parsed.phenotype_match.label] ?? -1;

    try {
      const origin = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";
      await fetch(`${origin}/api/flares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: `live-${session_id}-${Date.now()}`,
          label: session.symptoms.slice(0, 2).join(" + ") || "new flare",
          symptoms: session.symptoms,
          clusterId,
          color: CLUSTER_COLORS[clusterId],
          confidence: parsed.phenotype_match.confidence,
          synthetic: false,
          summary: `Live session: ${parsed.phenotype_match.label}`,
          novel_factors: [],
          // Coordinates will be null — frontend places near cluster centroid
          x: null, y: null, z: null,
        }),
      });
    } catch {
      // non-fatal
    }
  }

  return NextResponse.json({
    reply: parsed.reply,
    state: parsed.state,
    phenotype_probs: parsed.phenotype_probs,
    converged: parsed.converged,
    phenotype_match: parsed.phenotype_match,
  });
}
