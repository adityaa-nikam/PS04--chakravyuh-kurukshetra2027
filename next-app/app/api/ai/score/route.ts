import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { transcript_excerpt, duration_sec, word_count } = await req.json();

    if (!transcript_excerpt) {
      return NextResponse.json(
        { error: "transcript_excerpt is required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      // Fallback: return heuristic response
      return NextResponse.json({
        mercury_score: null,
        method: "heuristic_fallback",
        reason: "No OPENROUTER_API_KEY configured",
      });
    }

    const payload = {
      model: process.env.DECISION_MODEL || "inception/mercury-decide",
      state: {
        topic_excerpt: String(transcript_excerpt).slice(0, 400),
        duration_sec: Number(duration_sec) || 30.0,
        word_count: Number(word_count) || 60,
      },
      questions: {
        is_standalone_reel: {
          type: "noul",
          instructions:
            "Is this video clip an engaging, self-contained educational highlight suitable for a standalone viral reel?",
          criteria: {
            true: "Clear, self-contained educational insight with high pedagogical value",
            false:
              "Incomplete thought, greeting/promo fluff, dangling reference, or requires heavy external context",
          },
        },
      },
    };

    const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({
        mercury_score: null,
        method: "heuristic_fallback",
        reason: `OpenRouter returned ${res.status}: ${errText.slice(0, 100)}`,
      });
    }

    const data = await res.json();
    const noul = data?.answers?.is_standalone_reel?.noul;

    return NextResponse.json({
      mercury_score: typeof noul === "number" ? noul : null,
      method: "openrouter_mercury_decide",
      raw: data,
    });
  } catch (error: any) {
    return NextResponse.json({
      mercury_score: null,
      method: "heuristic_fallback",
      reason: error?.message || "Score API timeout / network error",
    });
  }
}
