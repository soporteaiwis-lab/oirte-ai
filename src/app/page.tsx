"use client";

import { useState, useRef, useCallback } from "react";
import {
  Mic, MicOff, Camera, MessageSquare, Phone,
  RefreshCw, Hand, Volume2, Keyboard, X, Send, AlertCircle
} from "lucide-react";
import { useDemoUser } from "@/components/DemoUserProvider";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import contacts from "@/lib/contacts.json";

export default function Home() {
  const { isDemoUser, userName, enableDemoMode, disableDemoMode } = useDemoUser();
  const {
    isListening, transcript, isSupported, toggleListening, stopListening, setTranscript
  } = useSpeechRecognition();

  const [responses, setResponses] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [imageSummary, setImageSummary] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [manualText, setManualText] = useState("");
  const [apiModel, setApiModel] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── TTS ────────────────────────────────────────────────────────────────
  const speak = useCallback((text: string, index?: number) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = "es-ES";
    utt.rate = 0.92;
    utt.pitch = 1.0;
    utt.volume = 1.0;
    if (index !== undefined) {
      utt.onstart = () => setSpeakingIndex(index);
      utt.onend = () => setSpeakingIndex(null);
      utt.onerror = () => setSpeakingIndex(null);
    }
    window.speechSynthesis.speak(utt);
  }, []);

  // ── Save to Demo History ───────────────────────────────────────────────
  const saveHistory = useCallback((entry: string) => {
    if (!isDemoUser) return;
    const prev = JSON.parse(localStorage.getItem("oirte_chat_history") || "[]");
    localStorage.setItem("oirte_chat_history", JSON.stringify([...prev, entry]));
  }, [isDemoUser]);

  // ── Analyze text with Gemini ───────────────────────────────────────────
  const analyze = async (textToSend: string) => {
    if (!textToSend.trim()) return;
    stopListening();
    setIsAnalyzing(true);
    setResponses([]);
    saveHistory("Escuchó: " + textToSend);

    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: textToSend }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || `Error HTTP ${res.status}`);
      }
      if (!Array.isArray(data.responses) || data.responses.length === 0) {
        throw new Error("La IA no devolvió respuestas válidas.");
      }

      setResponses(data.responses);
      setApiModel(data.model || null);
      setTranscript("");
      setManualText("");
      setShowKeyboard(false);
      // Auto-speak first option
      setTimeout(() => speak(data.responses[0], 0), 300);
      saveHistory("Respuestas: " + data.responses.join(" | "));
    } catch (err: any) {
      alert("❌ Error IA:\n" + err.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ── Analyze image with Gemini ──────────────────────────────────────────
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      alert("Por favor selecciona una imagen (JPG, PNG, etc.)");
      return;
    }

    setIsAnalyzing(true);
    setImageSummary(null);

    const reader = new FileReader();
    reader.onloadend = async () => {
      const dataUrl = reader.result as string;
      setImagePreview(dataUrl);
      const base64 = dataUrl.split(",")[1];

      try {
        const res = await fetch("/api/gemini", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: base64, mimeType: file.type }),
        });
        const data = await res.json();

        if (!res.ok || data.error) throw new Error(data.error || `Error HTTP ${res.status}`);

        const summary = data.summary || "No se pudo leer la imagen.";
        setImageSummary(summary);
        setApiModel(data.model || null);
        saveHistory("Imagen: " + summary);
        setTimeout(() => speak(summary), 300);
      } catch (err: any) {
        alert("❌ Error al analizar imagen:\n" + err.message);
      } finally {
        setIsAnalyzing(false);
        // Reset input so the same file can be re-selected
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsDataURL(file);
  };

  const activeText = showKeyboard ? manualText : transcript;
  const canAnalyze = activeText.trim().length > 3 && !isAnalyzing;

  return (
    <main className="flex-1 flex flex-col p-4 max-w-4xl mx-auto w-full gap-8 pb-16">

      {/* ─── Header ─── */}
      <header className="flex flex-col sm:flex-row justify-between items-center bg-zinc-900 p-4 rounded-2xl border border-zinc-800 gap-4">
        <div>
          <h1 className="text-4xl font-black text-yellow-400 flex items-center gap-3">
            <Hand className="w-10 h-10" />
            OIRTE AI
          </h1>
          <p className="text-xl text-zinc-400 font-bold mt-1">👤 {userName}</p>
          {apiModel && (
            <p className="text-sm text-zinc-600 mt-1">modelo: {apiModel}</p>
          )}
        </div>
        <button
          onClick={isDemoUser ? disableDemoMode : enableDemoMode}
          className={`px-6 py-3 rounded-xl font-bold text-xl border-2 transition-colors ${isDemoUser
              ? "bg-zinc-800 border-yellow-400 text-yellow-400"
              : "bg-transparent border-zinc-600 text-zinc-300 hover:border-zinc-400"
            }`}
        >
          {isDemoUser ? "✅ MODO DEMO ACTIVO" : "ACTIVAR DEMO"}
        </button>
      </header>

      {/* ─── Speech not supported warning ─── */}
      {!isSupported && (
        <div className="flex items-start gap-4 bg-red-950 border-2 border-red-700 rounded-2xl p-5 text-red-300">
          <AlertCircle className="w-8 h-8 flex-shrink-0 mt-1" />
          <p className="text-2xl font-bold">
            Tu navegador no soporta reconocimiento de voz. Usa <strong>Google Chrome</strong> o <strong>Microsoft Edge</strong> para activar el micrófono.
            Puedes seguir usando el modo <strong>ESCRIBIR</strong>.
          </p>
        </div>
      )}

      {/* ─── 1. Listen / Write Module ─── */}
      <section className="flex flex-col gap-4">
        <h2 className="text-3xl font-bold border-b border-zinc-800 pb-2 flex items-center gap-3">
          <Mic className="w-8 h-8 text-yellow-400" />
          1. Escuchar o Escribir
        </h2>

        {/* Transcript display */}
        <div
          className={`bg-zinc-900 border-2 rounded-3xl p-6 min-h-[140px] flex items-center justify-center relative transition-colors ${isListening ? "border-yellow-400" : "border-zinc-800"
            }`}
        >
          {isListening && (
            <div className="absolute top-4 right-4 flex items-center gap-2 text-yellow-400 animate-pulse">
              <div className="w-4 h-4 bg-yellow-400 rounded-full animate-ping" />
              <span className="font-bold text-2xl">Escuchando...</span>
            </div>
          )}
          {transcript ? (
            <p className="text-4xl sm:text-5xl font-bold leading-tight text-white text-center">
              "{transcript}"
            </p>
          ) : (
            <p className="text-3xl text-zinc-600 font-bold text-center">
              {isListening ? "Habla ahora..." : "El texto hablado aparecerá aquí..."}
            </p>
          )}
        </div>

        {/* Manual Keyboard Panel */}
        {showKeyboard && (
          <div className="bg-zinc-900 border-2 border-yellow-400/50 rounded-3xl p-5 flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <p className="text-2xl font-bold text-yellow-400 flex items-center gap-2">
                <Keyboard className="w-7 h-7" />
                Escribe lo que escuchaste
              </p>
              <button
                onClick={() => { setShowKeyboard(false); setManualText(""); }}
                className="text-zinc-400 hover:text-white p-2 rounded-xl hover:bg-zinc-800"
              >
                <X className="w-8 h-8" />
              </button>
            </div>
            <textarea
              ref={textareaRef}
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && manualText.trim().length > 3) {
                  e.preventDefault();
                  analyze(manualText);
                }
              }}
              placeholder="Escribe aquí lo que te dijeron... (Enter para analizar)"
              rows={3}
              className="w-full bg-zinc-800 border-2 border-zinc-700 rounded-2xl p-4 text-3xl font-bold text-white placeholder-zinc-600 focus:border-yellow-400 outline-none resize-none"
              autoFocus
            />
            <button
              onClick={() => analyze(manualText)}
              disabled={manualText.trim().length <= 3 || isAnalyzing}
              className="btn-huge bg-yellow-400 text-zinc-900 disabled:opacity-40"
            >
              <Send className="w-9 h-9" />
              ENVIAR A GEMINI IA
            </button>
          </div>
        )}

        {/* Action Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <button
            onClick={toggleListening}
            disabled={!isSupported}
            className={`btn-huge ${isListening
                ? "bg-red-600 text-white"
                : "bg-yellow-400 text-zinc-900"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {isListening ? <MicOff className="w-10 h-10" /> : <Mic className="w-10 h-10" />}
            {isListening ? "DETENER" : "🎤 ESCUCHAR"}
          </button>

          <button
            onClick={() => {
              setShowKeyboard((s) => !s);
              setTimeout(() => textareaRef.current?.focus(), 100);
            }}
            className={`btn-huge ${showKeyboard
                ? "bg-yellow-400/20 border-yellow-400 text-yellow-400"
                : "btn-secondary"
              } border-2`}
          >
            <Keyboard className="w-9 h-9" />
            ⌨️ ESCRIBIR
          </button>

          <button
            onClick={() => analyze(activeText)}
            disabled={!canAnalyze}
            className="btn-huge bg-green-500 text-black disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-9 h-9 ${isAnalyzing ? "animate-spin" : ""}`} />
            {isAnalyzing ? "PENSANDO..." : "🤖 RESPUESTAS IA"}
          </button>
        </div>
      </section>

      {/* ─── 2. Response Module ─── */}
      {(responses.length > 0 || isAnalyzing) && (
        <section className="flex flex-col gap-4 bg-zinc-900/60 p-6 rounded-3xl border border-zinc-800">
          <h2 className="text-3xl font-bold border-b border-zinc-800 pb-2 flex items-center gap-3">
            <MessageSquare className="w-8 h-8 text-yellow-400" />
            2. Elige tu Respuesta
          </h2>

          {isAnalyzing ? (
            <p className="py-8 text-center text-3xl font-bold text-zinc-500 animate-pulse">
              🧠 Gemini está pensando...
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {responses.map((resp, idx) => (
                <div key={idx} className="flex gap-3 items-stretch">
                  <button
                    onClick={() => speak(resp, idx)}
                    className={`flex-1 text-left p-6 rounded-2xl border-2 transition-all focus:outline-none focus:ring-4 focus:ring-yellow-400 ${speakingIndex === idx
                        ? "bg-yellow-400 text-zinc-900 border-yellow-400 scale-[1.02]"
                        : "bg-zinc-800 hover:bg-zinc-700 border-zinc-700 hover:border-yellow-400/60"
                      }`}
                  >
                    <p className="text-4xl font-bold leading-tight">{resp}</p>
                    {speakingIndex === idx && (
                      <p className="text-xl font-bold mt-2 opacity-70 flex items-center gap-2">
                        <Volume2 className="w-6 h-6" /> Leyendo...
                      </p>
                    )}
                  </button>
                  <button
                    onClick={() => speak(resp, idx)}
                    aria-label="Reproducir en voz alta"
                    className={`w-20 rounded-2xl border-2 flex items-center justify-center transition-all ${speakingIndex === idx
                        ? "bg-yellow-400 text-zinc-900 border-yellow-400"
                        : "bg-zinc-800 border-zinc-700 hover:border-yellow-400 text-yellow-400 hover:bg-zinc-700"
                      }`}
                  >
                    <Volume2 className="w-9 h-9" />
                  </button>
                </div>
              ))}
              <p className="text-center text-2xl text-zinc-500 mt-2">
                👆 Toca una opción para leerla en voz alta a la otra persona
              </p>
            </div>
          )}
        </section>
      )}

      {/* ─── 3. Multimedia Module ─── */}
      <section className="flex flex-col gap-4">
        <h2 className="text-3xl font-bold border-b border-zinc-800 pb-2 flex items-center gap-3">
          <Camera className="w-8 h-8 text-yellow-400" />
          3. Leer Foto / Documento
        </h2>

        <label className={`btn-huge btn-secondary cursor-pointer relative overflow-hidden ${isAnalyzing ? "opacity-60" : ""}`}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/heic"
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            onChange={handleImageUpload}
            disabled={isAnalyzing}
          />
          <Camera className="w-10 h-10" />
          <span>{isAnalyzing && !responses.length ? "⏳ ANALIZANDO..." : "📸 TOMAR O SUBIR FOTO"}</span>
        </label>

        {imagePreview && (
          <div className="rounded-3xl overflow-hidden border-2 border-zinc-800 max-h-60">
            <img src={imagePreview} alt="Imagen a analizar" className="w-full object-cover max-h-60" />
          </div>
        )}

        {imageSummary && (
          <div className="bg-yellow-400/10 border-2 border-yellow-400 rounded-3xl p-6 flex flex-col gap-4">
            <h3 className="text-yellow-400 font-bold text-2xl">📄 Resumen de la imagen:</h3>
            <p className="text-4xl font-bold leading-tight text-white">{imageSummary}</p>
            <button
              onClick={() => speak(imageSummary)}
              className="btn-huge bg-zinc-800 text-yellow-400 border-2 border-zinc-700 hover:border-yellow-400"
            >
              <Volume2 className="w-8 h-8" />
              🔊 LEER EN VOZ ALTA
            </button>
          </div>
        )}
      </section>

      {/* ─── 4. Contacts Module ─── */}
      <section className="flex flex-col gap-4">
        <h2 className="text-3xl font-bold border-b border-zinc-800 pb-2 flex items-center gap-3">
          <Phone className="w-8 h-8 text-yellow-400" />
          Contactos de Emergencia
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {contacts.map((contact) => (
            <a
              key={contact.id}
              href={`https://wa.me/${contact.phone}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-huge bg-green-900 border-2 border-green-700 hover:bg-green-800 hover:border-green-400 text-white"
            >
              📱 {contact.name.toUpperCase()}
            </a>
          ))}
        </div>
      </section>

    </main>
  );
}
