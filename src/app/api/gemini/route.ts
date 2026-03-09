import { NextRequest, NextResponse } from "next/server";

// Using REST API directly — more reliable than the SDK for model availability
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// Models to try in order of preference (fallback chain)
const MODELS = [
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash-latest",
    "gemini-1.5-pro",
];

async function callGemini(apiKey: string, model: string, contents: object[]) {
    const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents }),
    });
    const json = await res.json();
    if (!res.ok) {
        throw new Error(json.error?.message || `HTTP ${res.status}`);
    }
    return json.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function callGeminiFallback(apiKey: string, contents: object[]) {
    let lastError = "";
    for (const model of MODELS) {
        try {
            const text = await callGemini(apiKey, model, contents);
            return { text, model };
        } catch (err: any) {
            lastError = err.message;
            console.warn(`Model ${model} failed:`, err.message);
        }
    }
    throw new Error("All Gemini models failed. Last error: " + lastError);
}

export async function POST(req: NextRequest) {
    try {
        const apiKey = (process.env.GEMINI_API_KEY || "").trim().replace(/^["']|["']$/g, "");

        if (!apiKey) {
            return NextResponse.json(
                { error: "GEMINI_API_KEY no encontrada en .env.local" },
                { status: 500 }
            );
        }

        const body = await req.json();

        // ── Text analysis mode ──────────────────────────────────────────────
        if (body.text) {
            const prompt = `Eres un asistente de comunicación para personas sordas. 
Analiza el siguiente texto hablado. Detecta el tono y sentimiento. 
Devuelve EXACTAMENTE 3 respuestas cortas, amables y naturales en español que la persona sorda puede usar para responder.
Texto: "${body.text}"
IMPORTANTE: Devuelve SOLO el arreglo JSON, sin explicaciones, sin markdown, sin bloques de código. Ejemplo:
["¡Claro que sí!", "Muchas gracias.", "Entendido, no te preocupes."]`;

            const contents = [{ role: "user", parts: [{ text: prompt }] }];
            const { text: raw, model } = await callGeminiFallback(apiKey, contents);

            let cleaned = raw.trim();
            // Strip markdown code blocks if present
            cleaned = cleaned.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "").trim();

            let responses: string[];
            try {
                responses = JSON.parse(cleaned);
                if (!Array.isArray(responses)) throw new Error("Not an array");
            } catch {
                console.warn("Could not parse Gemini JSON, raw:", raw);
                // Extract lines as fallback
                responses = cleaned
                    .split("\n")
                    .filter((l) => l.trim())
                    .slice(0, 3)
                    .map((l) => l.replace(/^["'\d.\-\s]+/, "").replace(/["']$/, ""));
                if (responses.length === 0) responses = ["Sí, entiendo.", "No te preocupes.", "Gracias."];
            }

            console.log(`✅ Gemini (${model}) responded with`, responses.length, "suggestions");
            return NextResponse.json({ responses, model });
        }

        // ── Image analysis mode ─────────────────────────────────────────────
        if (body.image && body.mimeType) {
            const prompt =
                "Analiza esta imagen. Si es un documento, lee su contenido principal. Si es una foto, describe qué muestra. Responde en español con máximo 2 oraciones simples, pensando en que la persona que lee puede ser sorda o de la tercera edad.";

            const contents = [
                {
                    role: "user",
                    parts: [
                        { text: prompt },
                        { inlineData: { mimeType: body.mimeType, data: body.image } },
                    ],
                },
            ];

            const { text: summary, model } = await callGeminiFallback(apiKey, contents);
            console.log(`✅ Gemini image (${model}):`, summary.slice(0, 80));
            return NextResponse.json({ summary: summary.trim(), model });
        }

        return NextResponse.json({ error: "Falta texto o imagen en la solicitud" }, { status: 400 });

    } catch (error: any) {
        console.error("❌ Gemini API Error:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
