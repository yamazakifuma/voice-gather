// Vercel Serverless Function — Gemini API でグルーピング
export const config = { runtime: "edge" };

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { topic, description, opinions } = await req.json();

    if (!Array.isArray(opinions) || opinions.length < 2) {
      return new Response(
        JSON.stringify({ error: "意見が2件未満です" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const numbered = opinions
      .map((o, i) => `${i + 1}. ${(o.text || "").replace(/\n/g, " ")}`)
      .join("\n");

    const prompt = `あなたは匿名で集まった意見を分類するアナリストです。

【お題】
${topic}
${description ? `\n【補足】\n${description}` : ""}

【意見一覧 (番号付き)】
${numbered}

これらの意見を意味的な類似性で 2〜6 個のグループに分類してください。
- 各グループに、共通点を表す簡潔な日本語ラベル(8〜20文字)と1〜2文の要約をつける
- すべての番号がいずれか1グループに所属
- 似た意見が少なければ「その他」グループに集約してよい

出力は **純粋なJSONのみ**(コードフェンスや説明文を一切含めない)。スキーマ:
{
  "groups": [
    { "label": "string", "summary": "string", "opinion_indices": [number] }
  ]
}`;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY が未設定" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini error:", errText);
      return new Response(
        JSON.stringify({ error: `Gemini API error: ${geminiRes.status}` }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const cleaned = text.replace(/^```json\s*|^```\s*|```$/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(
      JSON.stringify({ error: e.message || "unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
