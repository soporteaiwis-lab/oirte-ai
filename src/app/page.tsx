"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Mic, MicOff, Camera, MessageSquare, Phone, Volume2,
  Hand, Send, FileText, Music, Image as ImageIcon, Keyboard, X
} from "lucide-react";
import { useDemoUser } from "@/components/DemoUserProvider";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import contacts from "@/lib/contacts.json";

// ── Types ───────────────────────────────────────────────────────────────
type ChatMsg = {
  id: string;
  type: "heard" | "said" | "ai" | "system";
  text: string;
  time: string;
};

type TabKey = "chat" | "photos" | "docs" | "audio" | "contacts";

function timeNow() {
  return new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ──────────────────────────────────────────────────────────────────────
export default function Home() {
  const { isDemoUser, userName, enableDemoMode, disableDemoMode } = useDemoUser();
  const [tab, setTab] = useState<TabKey>("chat");

  // ─── Chat state ─────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [responses, setResponses] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [manualReply, setManualReply] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  // ─── Media state ────────────────────────────────────────────────────
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [mediaSummary, setMediaSummary] = useState<string | null>(null);
  const [isMediaLoading, setIsMediaLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  // ─── When speech auto-stops, add the text as a "heard" message ────
  const onAutoStop = useCallback((finalText: string) => {
    if (!finalText.trim()) return;
    addMsg("heard", finalText);
    fetchSuggestions(finalText);
  }, []);

  const {
    isListening, transcript, isSupported, toggleListening, stopListening, setTranscript
  } = useSpeechRecognition(onAutoStop);

  // ─── Scroll to bottom on new messages ─────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, responses]);

  // ─── Save to demo localStorage ────────────────────────────────────
  const saveHistory = useCallback((entry: string) => {
    if (!isDemoUser) return;
    const prev = JSON.parse(localStorage.getItem("oirte_chat_history") || "[]");
    localStorage.setItem("oirte_chat_history", JSON.stringify([...prev, entry]));
  }, [isDemoUser]);

  // ─── Add a message to the chat ────────────────────────────────────
  const addMsg = useCallback((type: ChatMsg["type"], text: string) => {
    const msg: ChatMsg = { id: uid(), type, text, time: timeNow() };
    setMessages(prev => [...prev, msg]);
    saveHistory(`[${type}] ${text}`);
    return msg;
  }, [saveHistory]);

  // ─── TTS ──────────────────────────────────────────────────────────
  const speak = useCallback((text: string, idx?: number) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "es-ES"; u.rate = 0.92; u.volume = 1;
    if (idx !== undefined) {
      u.onstart = () => setSpeakingIndex(idx);
      u.onend = () => setSpeakingIndex(null);
      u.onerror = () => setSpeakingIndex(null);
    }
    window.speechSynthesis.speak(u);
  }, []);

  // ─── Call Gemini for 3 response suggestions ──────────────────────
  const fetchSuggestions = async (text: string) => {
    setIsAnalyzing(true);
    setResponses([]);
    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (Array.isArray(data.responses)) {
        setResponses(data.responses);
      }
    } catch (e: any) {
      addMsg("system", "❌ Error IA: " + e.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ─── User selects a suggested response ────────────────────────────
  const selectResponse = (text: string, idx: number) => {
    addMsg("said", text);
    speak(text, idx);
    setResponses([]);
    setTranscript("");
  };

  // ─── User writes a manual reply ───────────────────────────────────
  const sendManualReply = () => {
    const t = manualReply.trim();
    if (!t) return;
    addMsg("said", t);
    speak(t);
    setManualReply("");
    setResponses([]);
  };

  // ─── Manual "send heard text" when user clicks Analyze ────────────
  const manualAnalyze = () => {
    if (!transcript.trim()) return;
    stopListening();
    addMsg("heard", transcript);
    fetchSuggestions(transcript);
    setTranscript("");
  };

  // ─── Upload photo ─────────────────────────────────────────────────
  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setIsMediaLoading(true); setMediaSummary(null);
    const reader = new FileReader();
    reader.onloadend = async () => {
      const url = reader.result as string;
      setImagePreview(url);
      try {
        const res = await fetch("/api/gemini", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: url.split(",")[1], mimeType: file.type }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setMediaSummary(data.summary);
        speak(data.summary);
      } catch (e: any) { alert("❌ " + e.message); }
      finally { setIsMediaLoading(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
    };
    reader.readAsDataURL(file);
  };

  // ─── Upload document ──────────────────────────────────────────────
  const handleDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setIsMediaLoading(true); setMediaSummary(null); setImagePreview(null);
    const reader = new FileReader();
    reader.onloadend = async () => {
      const url = reader.result as string;
      setImagePreview(url);
      try {
        const res = await fetch("/api/gemini", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: url.split(",")[1], mimeType: file.type, docMode: true }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setMediaSummary(data.summary);
        speak(data.summary);
      } catch (e: any) { alert("❌ " + e.message); }
      finally { setIsMediaLoading(false); if (docInputRef.current) docInputRef.current.value = ""; }
    };
    reader.readAsDataURL(file);
  };

  // ─── Upload audio ─────────────────────────────────────────────────
  const handleAudio = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert("Máximo 10 MB de audio"); return; }
    setIsMediaLoading(true); setMediaSummary(null); setImagePreview(null);
    const reader = new FileReader();
    reader.onloadend = async () => {
      const url = reader.result as string;
      try {
        const res = await fetch("/api/gemini", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audio: url.split(",")[1], audioMimeType: file.type }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setMediaSummary(data.transcription || data.summary);
        if (data.transcription) speak(data.transcription);
      } catch (e: any) { alert("❌ " + e.message); }
      finally { setIsMediaLoading(false); if (audioInputRef.current) audioInputRef.current.value = ""; }
    };
    reader.readAsDataURL(file);
  };

  // ═══════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col h-[100dvh] max-w-lg mx-auto relative">

      {/* ─── Fixed Header ─── */}
      <header className="flex items-center justify-between bg-zinc-900 px-4 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2">
          <Hand className="w-7 h-7 text-yellow-400" />
          <span className="text-2xl font-black text-yellow-400">OIRTE AI</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-400 font-bold">👤 {userName}</span>
          <button
            onClick={isDemoUser ? disableDemoMode : enableDemoMode}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors ${isDemoUser
                ? "border-yellow-400 text-yellow-400 bg-zinc-800"
                : "border-zinc-600 text-zinc-400"
              }`}
          >
            {isDemoUser ? "✅ DEMO" : "DEMO"}
          </button>
        </div>
      </header>

      {/* ─── Scrollable Content Area ─── */}
      <div className="app-content flex-1 flex flex-col">

        {/* ═══════ TAB: CHAT ═══════ */}
        {tab === "chat" && (
          <div className="flex flex-col flex-1">

            {/* Chat messages scroll area */}
            <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2 flex flex-col gap-3">
              {messages.length === 0 && !isListening && (
                <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-12 gap-4">
                  <Hand className="w-16 h-16 text-yellow-400 opacity-40" />
                  <p className="text-2xl text-zinc-500 font-bold">
                    Presiona <span className="text-yellow-400">ESCUCHAR</span> para captar voces
                    o <span className="text-yellow-400">ESCRIBIR</span> lo que te dijeron
                  </p>
                </div>
              )}

              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.type === "said" ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`chat-bubble ${msg.type === "heard" ? "chat-heard" :
                        msg.type === "said" ? "chat-said" :
                          msg.type === "ai" ? "chat-ai" : "bg-zinc-900 text-zinc-400 text-lg self-center text-center"
                      }`}
                  >
                    {msg.text}
                  </div>
                  <span className="text-xs text-zinc-600 mt-1 px-1">
                    {msg.type === "heard" ? "🔊 Escuchado" : msg.type === "said" ? "💬 Respondido" : ""}
                    {" "}{msg.time}
                  </span>
                </div>
              ))}

              {/* Live transcript (while listening) */}
              {isListening && transcript && (
                <div className="flex flex-col items-start">
                  <div className="chat-bubble chat-heard opacity-70 animate-pulse">
                    {transcript}...
                  </div>
                  <span className="text-xs text-yellow-400 mt-1 px-1">🎤 Escuchando en vivo...</span>
                </div>
              )}

              {/* AI suggestions */}
              {(responses.length > 0 || isAnalyzing) && (
                <div className="flex flex-col gap-2 mt-2 p-3 bg-zinc-900/80 rounded-2xl border border-zinc-800">
                  <p className="text-lg font-bold text-zinc-400 flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-green-400" />
                    Respuestas sugeridas:
                  </p>
                  {isAnalyzing ? (
                    <p className="text-xl text-zinc-500 animate-pulse text-center py-4">🧠 Pensando...</p>
                  ) : (
                    responses.map((r, i) => (
                      <button
                        key={i}
                        onClick={() => selectResponse(r, i)}
                        className={`w-full text-left p-4 rounded-xl border-2 transition-all text-2xl font-bold leading-snug ${speakingIndex === i
                            ? "bg-yellow-400 text-zinc-900 border-yellow-400"
                            : "bg-zinc-800 text-white border-zinc-700 hover:border-yellow-400/50 active:scale-[0.98]"
                          }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="flex-1">{r}</span>
                          <Volume2 className="w-6 h-6 shrink-0 opacity-60" />
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* ─── Bottom Input Area ─── */}
            <div className="shrink-0 bg-zinc-900 border-t border-zinc-800 px-3 py-3 flex flex-col gap-2">

              {/* Mic + Analyze row */}
              <div className="flex gap-2">
                <button
                  onClick={toggleListening}
                  disabled={!isSupported}
                  className={`flex-1 py-4 rounded-2xl font-bold text-xl flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-40 ${isListening ? "bg-red-600 text-white mic-pulse" : "bg-yellow-400 text-zinc-900"
                    }`}
                >
                  {isListening ? <MicOff className="w-7 h-7" /> : <Mic className="w-7 h-7" />}
                  {isListening ? "PARAR" : "🎤 ESCUCHAR"}
                </button>
                {transcript && !isListening && (
                  <button
                    onClick={manualAnalyze}
                    disabled={isAnalyzing}
                    className="px-5 py-4 rounded-2xl bg-green-600 text-white text-xl font-bold active:scale-95 flex items-center gap-2"
                  >
                    <Send className="w-6 h-6" />
                    IA
                  </button>
                )}
              </div>

              {/* Manual text reply row */}
              <div className="flex gap-2 items-end">
                <textarea
                  ref={replyRef}
                  rows={1}
                  value={manualReply}
                  onChange={(e) => setManualReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendManualReply(); }
                  }}
                  placeholder="Escribe tu respuesta..."
                  className="flex-1 bg-zinc-800 border-2 border-zinc-700 rounded-xl px-4 py-3 text-xl font-bold text-white placeholder-zinc-600 focus:border-yellow-400 outline-none resize-none"
                />
                <button
                  onClick={sendManualReply}
                  disabled={!manualReply.trim()}
                  className="w-14 h-14 rounded-xl bg-yellow-400 text-zinc-900 flex items-center justify-center disabled:opacity-30 active:scale-90 shrink-0"
                >
                  <Send className="w-6 h-6" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══════ TAB: PHOTOS ═══════ */}
        {tab === "photos" && (
          <div className="flex-1 flex flex-col p-4 gap-4">
            <h2 className="text-3xl font-bold flex items-center gap-3">
              <ImageIcon className="w-8 h-8 text-yellow-400" /> Analizar Foto
            </h2>
            <label className={`btn-huge btn-secondary cursor-pointer relative ${isMediaLoading ? "opacity-60" : ""}`}>
              <input ref={fileInputRef} type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handlePhoto} disabled={isMediaLoading} />
              <Camera className="w-9 h-9" />
              {isMediaLoading ? "⏳ ANALIZANDO..." : "📸 TOMAR O SUBIR FOTO"}
            </label>
            {imagePreview && (
              <div className="rounded-2xl overflow-hidden border-2 border-zinc-800 max-h-52">
                <img src={imagePreview} alt="Foto" className="w-full object-cover max-h-52" />
              </div>
            )}
            {mediaSummary && (
              <div className="bg-yellow-400/10 border-2 border-yellow-400 rounded-2xl p-5 flex flex-col gap-3">
                <p className="text-3xl font-bold text-white leading-snug">{mediaSummary}</p>
                <button onClick={() => speak(mediaSummary)} className="btn-huge bg-zinc-800 text-yellow-400 border-2 border-zinc-700">
                  <Volume2 className="w-7 h-7" /> 🔊 LEER EN VOZ ALTA
                </button>
              </div>
            )}
          </div>
        )}

        {/* ═══════ TAB: DOCS ═══════ */}
        {tab === "docs" && (
          <div className="flex-1 flex flex-col p-4 gap-4">
            <h2 className="text-3xl font-bold flex items-center gap-3">
              <FileText className="w-8 h-8 text-yellow-400" /> Analizar Documento
            </h2>
            <label className={`btn-huge btn-secondary cursor-pointer relative ${isMediaLoading ? "opacity-60" : ""}`}>
              <input ref={docInputRef} type="file" accept="image/*,.pdf" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleDoc} disabled={isMediaLoading} />
              <FileText className="w-9 h-9" />
              {isMediaLoading ? "⏳ LEYENDO..." : "📄 SUBIR DOCUMENTO O FOTO"}
            </label>
            {imagePreview && (
              <div className="rounded-2xl overflow-hidden border-2 border-zinc-800 max-h-52">
                <img src={imagePreview} alt="Doc" className="w-full object-cover max-h-52" />
              </div>
            )}
            {mediaSummary && (
              <div className="bg-yellow-400/10 border-2 border-yellow-400 rounded-2xl p-5 flex flex-col gap-3">
                <h3 className="text-yellow-400 text-xl font-bold">📄 Resumen:</h3>
                <p className="text-3xl font-bold text-white leading-snug">{mediaSummary}</p>
                <button onClick={() => speak(mediaSummary)} className="btn-huge bg-zinc-800 text-yellow-400 border-2 border-zinc-700">
                  <Volume2 className="w-7 h-7" /> 🔊 LEER EN VOZ ALTA
                </button>
              </div>
            )}
          </div>
        )}

        {/* ═══════ TAB: AUDIO ═══════ */}
        {tab === "audio" && (
          <div className="flex-1 flex flex-col p-4 gap-4">
            <h2 className="text-3xl font-bold flex items-center gap-3">
              <Music className="w-8 h-8 text-yellow-400" /> Transcribir Audio
            </h2>
            <p className="text-xl text-zinc-400">Sube un audio corto (máximo 1 minuto) y Gemini lo transcribirá a texto.</p>
            <label className={`btn-huge btn-secondary cursor-pointer relative ${isMediaLoading ? "opacity-60" : ""}`}>
              <input ref={audioInputRef} type="file" accept="audio/*,video/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleAudio} disabled={isMediaLoading} />
              <Music className="w-9 h-9" />
              {isMediaLoading ? "⏳ TRANSCRIBIENDO..." : "🎵 SUBIR AUDIO"}
            </label>
            {mediaSummary && (
              <div className="bg-yellow-400/10 border-2 border-yellow-400 rounded-2xl p-5 flex flex-col gap-3">
                <h3 className="text-yellow-400 text-xl font-bold">📝 Transcripción:</h3>
                <p className="text-3xl font-bold text-white leading-snug">{mediaSummary}</p>
                <button onClick={() => speak(mediaSummary)} className="btn-huge bg-zinc-800 text-yellow-400 border-2 border-zinc-700">
                  <Volume2 className="w-7 h-7" /> 🔊 LEER EN VOZ ALTA
                </button>
              </div>
            )}
          </div>
        )}

        {/* ═══════ TAB: CONTACTS ═══════ */}
        {tab === "contacts" && (
          <div className="flex-1 flex flex-col p-4 gap-4">
            <h2 className="text-3xl font-bold flex items-center gap-3">
              <Phone className="w-8 h-8 text-yellow-400" /> Contactos de Emergencia
            </h2>
            <div className="flex flex-col gap-3">
              {contacts.map((c) => (
                <a
                  key={c.id}
                  href={`https://wa.me/${c.phone}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-huge bg-green-900 border-2 border-green-700 hover:bg-green-800 hover:border-green-400 text-white"
                >
                  📱 {c.name.toUpperCase()}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ─── Fixed Bottom Tab Bar ─── */}
      <nav className="tab-bar">
        {([
          { key: "chat", icon: <MessageSquare />, label: "Chat" },
          { key: "photos", icon: <ImageIcon />, label: "Fotos" },
          { key: "docs", icon: <FileText />, label: "Docs" },
          { key: "audio", icon: <Music />, label: "Audio" },
          { key: "contacts", icon: <Phone />, label: "Contactos" },
        ] as { key: TabKey; icon: React.ReactNode; label: string }[]).map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setMediaSummary(null); setImagePreview(null); }}
            className={`tab-btn ${tab === t.key ? "active" : ""}`}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
