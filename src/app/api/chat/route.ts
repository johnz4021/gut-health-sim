import { NextResponse } from "next/server";

// In-memory session store (mock)
const sessions = new Map<
  string,
  { step: number; symptoms: string[]; context: Record<string, boolean> }
>();

const QUESTIONS = [
  {
    reply:
      "I hear you. Let me ask a few quick questions to narrow down what might be triggering this. Did you have coffee or caffeine before eating today?",
    state: "QUESTIONING" as const,
    probs: { A: 0.4, B: 0.35, C: 0.25 },
    field: "caffeine_before_food",
  },
  {
    reply:
      "Got it. Did you eat any onion, garlic, or wheat-heavy foods in the last 24 hours?",
    state: "QUESTIONING" as const,
    probs_yes: { A: 0.2, B: 0.6, C: 0.2 },
    probs_no: { A: 0.5, B: 0.15, C: 0.35 },
    field: "high_fodmap",
  },
  {
    reply_converge_fodmap:
      "Based on your answers, your symptoms strongly match a FODMAP-sensitive pattern. Many people with this profile find that reducing onion, garlic, and wheat significantly decreases flare-ups. This is backed by Monash University's FODMAP research.",
    reply_converge_caffeine:
      "Based on your answers, your symptoms match a caffeine/sleep-sensitive pattern. People with this profile often find that avoiding caffeine on an empty stomach and getting 7+ hours of sleep significantly reduces flare-ups.",
    reply_converge_stress:
      "Based on your answers, your symptoms match a stress/gut-brain pattern. The gut-brain axis means high stress and irregular meals can directly trigger IBS symptoms. Regular meal timing and stress management often help.",
    state: "CONVERGED" as const,
  },
];

function detectYes(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("yes") ||
    lower.includes("yeah") ||
    lower.includes("yep") ||
    lower.includes("i did") ||
    lower.includes("definitely")
  );
}

export async function POST(request: Request) {
  const { session_id, message } = await request.json();

  if (!sessions.has(session_id)) {
    sessions.set(session_id, { step: 0, symptoms: [], context: {} });
  }

  const session = sessions.get(session_id)!;
  const step = session.step;

  // Step 0: initial symptom intake → ask first question
  if (step === 0) {
    // Parse symptoms from message
    const symptomKeywords = [
      "bloating",
      "cramping",
      "urgency",
      "pain",
      "diarrhea",
      "nausea",
      "gas",
    ];
    session.symptoms = symptomKeywords.filter((s) =>
      message.toLowerCase().includes(s)
    );
    session.step = 1;

    return NextResponse.json({
      reply: QUESTIONS[0].reply,
      state: QUESTIONS[0].state,
      phenotype_probs: QUESTIONS[0].probs,
      converged: false,
      phenotype_match: null,
    });
  }

  // Step 1: answer to caffeine question → ask FODMAP question
  if (step === 1) {
    const yes = detectYes(message);
    session.context.caffeine_before_food = yes;
    session.step = 2;

    const q = QUESTIONS[1];
    const probs = yes ? q.probs_yes! : q.probs_no!;

    return NextResponse.json({
      reply: q.reply,
      state: q.state,
      phenotype_probs: probs,
      converged: false,
      phenotype_match: null,
    });
  }

  // Step 2: answer to FODMAP question → converge
  if (step === 2) {
    const yes = detectYes(message);
    session.context.high_fodmap = yes;
    session.step = 3;

    // Determine phenotype based on answers
    let phenotype: { label: string; confidence: number; triggers: string[]; population_pct: number; clusterId: number };
    let reply: string;
    let probs: Record<string, number>;

    if (yes) {
      // FODMAP path
      phenotype = {
        label: "FODMAP-Sensitive IBS",
        confidence: 0.78,
        triggers: ["onion", "garlic", "wheat"],
        population_pct: 0.22,
        clusterId: 1,
      };
      reply = QUESTIONS[2].reply_converge_fodmap!;
      probs = { A: 0.1, B: 0.78, C: 0.12 };
    } else if (session.context.caffeine_before_food) {
      // Caffeine path
      phenotype = {
        label: "Caffeine/Sleep-Sensitive IBS",
        confidence: 0.74,
        triggers: ["caffeine before food", "sleep < 6hrs"],
        population_pct: 0.18,
        clusterId: 0,
      };
      reply = QUESTIONS[2].reply_converge_caffeine!;
      probs = { A: 0.74, B: 0.1, C: 0.16 };
    } else {
      // Stress path
      phenotype = {
        label: "Stress/Gut-Brain IBS",
        confidence: 0.71,
        triggers: ["high stress", "irregular meals"],
        population_pct: 0.15,
        clusterId: 2,
      };
      reply = QUESTIONS[2].reply_converge_stress!;
      probs = { A: 0.12, B: 0.15, C: 0.73 };
    }

    // Add new flare to the graph via internal POST
    const CLUSTER_COLORS: Record<number, string> = {
      0: "#FF6B6B",
      1: "#4ECDC4",
      2: "#FFE66D",
    };

    try {
      const origin = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";
      await fetch(`${origin}/api/flares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: `flare-${session_id}`,
          label: session.symptoms.slice(0, 2).join(" + ") || "flare",
          symptoms: session.symptoms,
          clusterId: phenotype.clusterId,
          color: CLUSTER_COLORS[phenotype.clusterId],
          confidence: phenotype.confidence,
          synthetic: false,
        }),
      });
    } catch {
      // ignore fetch errors in mock
    }

    return NextResponse.json({
      reply,
      state: "CONVERGED",
      phenotype_probs: probs,
      converged: true,
      phenotype_match: {
        label: phenotype.label,
        confidence: phenotype.confidence,
        triggers: phenotype.triggers,
        population_pct: phenotype.population_pct,
      },
    });
  }

  // Already converged
  return NextResponse.json({
    reply: "Your session is complete. Start a new session to investigate another flare-up.",
    state: "CONVERGED",
    phenotype_probs: {},
    converged: true,
    phenotype_match: null,
  });
}
