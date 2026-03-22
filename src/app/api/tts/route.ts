import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { text } = body;
        
        if (!text) {
            return NextResponse.json({ error: "Falta el texto para la voz" }, { status: 400 });
        }

        const apiKey = (process.env.ELEVENLABS_API_KEY || "").trim();
        if (!apiKey) {
            return NextResponse.json({ error: "ELEVENLABS_API_KEY no encontrada" }, { status: 500 });
        }

        // Voice ID: Matilda (XrExE9yKIg1WjnnlVkGX)
        // Fijado en el código para ignorar variables antiguas que hayan quedado estancadas en Vercel.
        const voiceId = "XrExE9yKIg1WjnnlVkGX";
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "xi-api-key": apiKey
            },
            body: JSON.stringify({
                text: text,
                model_id: "eleven_multilingual_v2",
                voice_settings: {
                    stability: 0.35,      // Más bajo = más expresividad y dinamismo emocional
                    similarity_boost: 0.85, // Mantiene la voz clara y fiel al modelo original sin distorsiones
                    style: 0.4,           // Agrega estilo y firmeza a la lectura
                    use_speaker_boost: true
                }
            })
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Error de ElevenLabs: ${response.status} ${err}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        return new NextResponse(buffer, {
            status: 200,
            headers: {
                "Content-Type": "audio/mpeg",
                "Content-Length": buffer.length.toString(),
            },
        });

    } catch (error: any) {
        console.error("❌ TTS Error:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
