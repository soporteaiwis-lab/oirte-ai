import { NextRequest, NextResponse } from "next/server";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODELS = ["gemini-2.5-flash", "gemini-2.5-pro"];

async function callGemini(apiKey: string, model: string, contents: object[]) {
    const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `HTTP ${res.status}`);
    return json.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function tryModels(apiKey: string, contents: object[]) {
    let lastErr = "";
    for (const m of MODELS) {
        try {
            const text = await callGemini(apiKey, m, contents);
            return { text, model: m };
        } catch (e: any) {
            lastErr = e.message;
            console.warn(`Model ${m} failed:`, e.message);
        }
    }
    throw new Error("Todos los modelos fallaron: " + lastErr);
}

export async function POST(req: NextRequest) {
    try {
        const apiKey = (process.env.GEMINI_API_KEY || "").trim().replace(/^["']|["']$/g, "");
        if (!apiKey) {
            return NextResponse.json({ error: "GEMINI_API_KEY no encontrada" }, { status: 500 });
        }

        const body = await req.json();

        // ── Text → 3 suggested responses ──
        if (body.text) {
            const prompt = `Eres un asistente de comunicación para personas sordas.
Analiza el siguiente texto hablado. Detecta el tono y sentimiento.
Devuelve EXACTAMENTE 3 respuestas cortas, amables y naturales en español que la persona sorda puede usar para responder.
Texto: "${body.text}"
IMPORTANTE: Devuelve SOLO un arreglo JSON, sin explicaciones ni markdown. Ejemplo:
["¡Claro que sí!", "Muchas gracias.", "Entendido."]`;

            const contents = [{ role: "user", parts: [{ text: prompt }] }];
            const { text: raw, model } = await tryModels(apiKey, contents);

            let cleaned = raw.trim().replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "").trim();
            let responses: string[];
            try {
                responses = JSON.parse(cleaned);
                if (!Array.isArray(responses)) throw new Error("not array");
            } catch {
                responses = cleaned.split("\n").filter((l: string) => l.trim()).slice(0, 3)
                    .map((l: string) => l.replace(/^["'\d.\-\s]+/, "").replace(/["']$/, ""));
                if (responses.length === 0) responses = ["Sí, entiendo.", "No te preocupes.", "Gracias."];
            }
            return NextResponse.json({ responses, model });
        }

        // ── Image analysis ──
        if (body.image && body.mimeType) {
            const prompt = body.docMode
                ? "Lee y resume este documento en máximo 3 oraciones simples en español. Si tiene datos importantes (fechas, montos, nombres) inclúyelos."
                : "Describe esta imagen en máximo 2 oraciones simples en español, para una persona sorda o de la tercera edad.";

            const contents = [{
                role: "user",
                parts: [
                    { text: prompt },
                    { inlineData: { mimeType: body.mimeType, data: body.image } },
                ],
            }];
            const { text: summary, model } = await tryModels(apiKey, contents);
            return NextResponse.json({ summary: summary.trim(), model });
        }

        // ── Plain text document (txt, md, etc.) ──
        if (body.docText) {
            const prompt = `Lee y resume este documento en máximo 3 oraciones simples en español. 
Si tiene datos importantes (fechas, montos, nombres) inclúyelos.
Documento:
"""
${body.docText.slice(0, 8000)}
"""`;
            const contents = [{ role: "user", parts: [{ text: prompt }] }];
            const { text: summary, model } = await tryModels(apiKey, contents);
            return NextResponse.json({ summary: summary.trim(), model });
        }

        // ── Audio/Video transcription ──
        if (body.audio && body.audioMimeType) {
            const prompt = body.audioMimeType.startsWith("video/")
                ? "Transcribe el audio de este video a texto en español. Si hay varias personas hablando, indica quién dice qué. Si es música, transcribe la letra. Devuelve solo el texto transcrito."
                : "Transcribe el siguiente audio a texto en español. Si hay varias personas hablando, indica quién dice qué. Si es música, transcribe la letra, versos y coros. Devuelve solo el texto transcrito.";

            const contents = [{
                role: "user",
                parts: [
                    { text: prompt },
                    { inlineData: { mimeType: body.audioMimeType, data: body.audio } },
                ],
            }];
            const { text: transcription, model } = await tryModels(apiKey, contents);
            return NextResponse.json({ transcription: transcription.trim(), model });
        }

        return NextResponse.json({ error: "Falta texto, imagen, documento o audio" }, { status: 400 });

    } catch (error: any) {
        console.error("❌ Gemini Error:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
