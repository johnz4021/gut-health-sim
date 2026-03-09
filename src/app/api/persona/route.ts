import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

interface Persona {
  display_name: string;
  bio: string;
  background: Record<string, unknown>;
  what_helps: string[];
}

const globalCache = globalThis as unknown as { __gutmap_persona_cache?: Map<string, Persona> };
if (!globalCache.__gutmap_persona_cache) {
  globalCache.__gutmap_persona_cache = new Map();
}
const cache = globalCache.__gutmap_persona_cache;

const client = new Anthropic();

export async function POST(request: Request) {
  const { node, cluster_label, user_context } = await request.json();

  const id = node?.id;
  if (!id) {
    return NextResponse.json({ error: "Missing node id" }, { status: 400 });
  }

  const cached = cache.get(id);
  if (cached) {
    return NextResponse.json(cached);
  }

  const axes = node.axis_scores || {};
  const userAge = user_context?.age_range || "25-34";
  const userSex = user_context?.sex || "unspecified";
  const userSubtype = user_context?.ibs_subtype || "IBS-M";

  const prompt = `Given this IBS flare-up data from a cohort member:
- Symptoms: ${(node.symptoms || []).join(", ")}
- Summary: ${node.summary || "N/A"}
- Trigger scores: FODMAP=${axes.fodmap ?? "?"}, Stress=${axes.stress_gut ?? "?"}, Caffeine/Sleep=${axes.caffeine_sleep ?? "?"}
- Cluster: ${cluster_label || "Unknown"}

Generate a plausible user profile. Make them somewhat similar to this reference profile (age: ${userAge}, sex: ${userSex}, subtype: ${userSubtype}) but NOT identical — vary the age range, possibly different sex, different onset period, etc.

For "what_helps", give exactly 1-2 specific remedies this person uses to recover from THIS flare based on its symptoms and triggers — e.g. "Peppermint oil capsule before meals" or "Hot water bottle on abdomen for cramping". These should be concrete, realistic interventions for the specific symptoms listed, not general lifestyle advice.

Return ONLY valid JSON with no other text: { "display_name": string, "bio": string (1-2 sentences), "background": { "age_range": string, "sex": string, "ibs_subtype": string, "diagnosed": boolean, "onset_period": string, "known_triggers": string[], "dietary_baseline": string }, "what_helps": string[] (1-2 specific remedies) }`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    let text = response.content[0].type === "text" ? response.content[0].text : "";
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    const persona: Persona = JSON.parse(text);
    cache.set(id, persona);
    return NextResponse.json(persona);
  } catch (err) {
    console.error("Persona generation failed:", err);
    return NextResponse.json({ error: "Failed to generate persona" }, { status: 500 });
  }
}
