import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { transcript_excerpt, clip_index } = await req.json();

    const excerpt = String(transcript_excerpt || "");
    const firstSentence = excerpt.split(".")[0].trim();
    const words = firstSentence.split(/\s+/).filter(Boolean);
    const rawTitle = words.length >= 3 ? words.slice(0, 5).join(" ") : `Topic Highlight #${(Number(clip_index) || 0) + 1}`;
    const fallbackTitle = rawTitle.replace(/[^\w\s-]/g, "").trim();

    const fallbackCaption = `💡 ${fallbackTitle}\n\n${excerpt.slice(0, 140).trim()}...\n\n#Programming #ComputerScience #TechExplainer #CodingShorts`;

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        title: fallbackTitle,
        caption: fallbackCaption,
        method: "template_fallback",
      });
    }

    const prompt = `Analyze this lecture clip transcript excerpt:\n"${excerpt.slice(0, 350)}"\n\nRespond ONLY in valid JSON format with two keys:\n"title": A punchy 3-5 word technical topic title (e.g. 'Big O Space Complexity')\n"caption": A 2-sentence viral Instagram caption with 3 hashtags.`;

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.FREE_LLM_MODEL || "nvidia/nemotron-3-super-120b-a12b:free",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      return NextResponse.json({
        title: fallbackTitle,
        caption: fallbackCaption,
        method: "template_fallback",
      });
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content?.trim() || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return NextResponse.json({
          title: parsed.title || fallbackTitle,
          caption: parsed.caption || fallbackCaption,
          method: "openrouter_chat",
        });
      } catch {
        // parsing failed, use fallback
      }
    }

    return NextResponse.json({
      title: fallbackTitle,
      caption: fallbackCaption,
      method: "template_fallback",
    });
  } catch (error: any) {
    return NextResponse.json({
      title: "Educational Highlight",
      caption: "💡 High-impact coding concept explained.\n\n#Programming #TechShorts",
      method: "template_fallback",
      error: error?.message,
    });
  }
}
