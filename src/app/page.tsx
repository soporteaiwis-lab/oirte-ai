"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Mic, MicOff, Camera, MessageSquare, Phone, Volume2,
  Hand, Send, FileText, Music, Image as ImageIcon
} from "lucide-react";
import { useDemoUser } from "@/components/DemoUserProvider";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import contacts from "@/lib/contacts.json";

type ChatMsg = { id: string; type: "heard" | "said" | "ai" | "system"; text: string; time: string };
type TabKey = "chat" | "photos" | "docs" | "audio" | "contacts";

const ts = () => new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Max audio size for Gemini inline data (4 MB base64 ≈ 3 MB file)
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;

export default function Home() {
  const { isDemoUser, userName, enableDemoMode, disableDemoMode } = useDemoUser();
  const [tab, setTab] = useState<TabKey>("chat");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [responses, setResponses] = useState<string[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [speakIdx, setSpeakIdx] = useState<number | null>(null);
  const [manualReply, setManualReply] = useState("");
  const [heardInput, setHeardInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  // Media state
  const [preview, setPreview] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);

  // Speech recognition with auto-stop callback
  const onAutoStop = useCallback((finalText: string) => {
    if (finalText.trim()) {
      addMsg("heard", finalText.trim());
      fetchSuggestions(finalText.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { isListening, transcript, isSupported, toggleListening, stopListening, setTranscript } =
    useSpeechRecognition(onAutoStop);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, responses, transcript]);

  // ── Helpers ───────────────────────────────────────────────────────
  const save = useCallback((entry: string) => {
    if (!isDemoUser) return;
    const h = JSON.parse(localStorage.getItem("oirte_history") || "[]");
    localStorage.setItem("oirte_history", JSON.stringify([...h, entry]));
  }, [isDemoUser]);

  const addMsg = useCallback((type: ChatMsg["type"], text: string) => {
    setMessages(p => [...p, { id: uid(), type, text, time: ts() }]);
    save(`[${type}] ${text}`);
  }, [save]);

  const speak = useCallback((text: string, idx?: number) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "es-ES"; u.rate = 0.9; u.volume = 1;
    if (idx !== undefined) {
      u.onstart = () => setSpeakIdx(idx);
      u.onend = () => setSpeakIdx(null);
      u.onerror = () => setSpeakIdx(null);
    }
    window.speechSynthesis.speak(u);
  }, []);

  // ── Gemini: get 3 suggestions ─────────────────────────────────────
  const fetchSuggestions = async (text: string) => {
    setIsThinking(true);
    setResponses([]);
    try {
      const r = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (Array.isArray(d.responses)) setResponses(d.responses);
    } catch (e: any) {
      addMsg("system", "❌ Error IA: " + e.message);
    } finally {
      setIsThinking(false);
    }
  };

  const selectResponse = (text: string, idx: number) => {
    addMsg("said", text);
    speak(text, idx);
    setResponses([]);
    setTranscript("");
  };

  // ── Send manual reply (user's own text) ─────────────────────────
  const sendReply = () => {
    const t = manualReply.trim();
    if (!t) return;
    addMsg("said", t);
    speak(t);
    setManualReply("");
    setResponses([]);
  };

  // ── Send "heard" text manually ──────────────────────────────────
  const sendHeardText = () => {
    const t = heardInput.trim();
    if (!t) return;
    addMsg("heard", t);
    fetchSuggestions(t);
    setHeardInput("");
  };

  // ── Manual analyze from transcript ─────────────────────────────
  const analyzeTranscript = () => {
    if (!transcript.trim()) return;
    stopListening();
    addMsg("heard", transcript.trim());
    fetchSuggestions(transcript.trim());
    setTranscript("");
  };

  // ── Photo upload ──────────────────────────────────────────────
  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setMediaLoading(true); setSummary(null);
    const reader = new FileReader();
    reader.onloadend = async () => {
      const url = reader.result as string;
      setPreview(url);
      try {
        const r = await fetch("/api/gemini", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: url.split(",")[1], mimeType: f.type }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setSummary(d.summary); speak(d.summary);
      } catch (err: any) { alert("❌ " + err.message); }
      finally { setMediaLoading(false); e.target.value = ""; }
    };
    reader.readAsDataURL(f);
  };

  // ── Doc upload ────────────────────────────────────────────────
  const handleDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setMediaLoading(true); setSummary(null); setPreview(null);
    const reader = new FileReader();
    reader.onloadend = async () => {
      const url = reader.result as string;
      setPreview(url);
      try {
        const r = await fetch("/api/gemini", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: url.split(",")[1], mimeType: f.type, docMode: true }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setSummary(d.summary); speak(d.summary);
      } catch (err: any) { alert("❌ " + err.message); }
      finally { setMediaLoading(false); e.target.value = ""; }
    };
    reader.readAsDataURL(f);
  };

  // ── Audio upload (with size check) ────────────────────────────
  const handleAudio = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;

    if (f.size > MAX_AUDIO_BYTES) {
      alert(`⚠️ El audio es demasiado grande (${(f.size / 1024 / 1024).toFixed(1)} MB).\nPor favor sube un audio de máximo 30 segundos (~3 MB).`);
      e.target.value = "";
      return;
    }

    setMediaLoading(true); setSummary(null); setPreview(null);
    try {
      const buffer = await f.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      const r = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: base64, audioMimeType: f.type || "audio/mpeg" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setSummary(d.transcription || d.summary || "No se pudo transcribir.");
      if (d.transcription) speak(d.transcription);
    } catch (err: any) {
      alert("❌ Error al transcribir: " + err.message);
    } finally {
      setMediaLoading(false);
      e.target.value = "";
    }
  };

  // ═══════════════════════════════════════════════════════════════
  return (
    <div className="app-shell">

      {/* ── Header ── */}
      <div className="app-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Hand style={{ width: 24, height: 24, color: "#facc15" }} />
          <span style={{ fontSize: "1.3rem", fontWeight: 900, color: "#facc15" }}>OIRTE AI</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: "0.8rem", color: "#a1a1aa", fontWeight: 700 }}>👤 {userName}</span>
          <button
            onClick={isDemoUser ? disableDemoMode : enableDemoMode}
            style={{
              padding: "5px 12px",
              borderRadius: 10,
              fontSize: "0.75rem",
              fontWeight: 800,
              border: `2px solid ${isDemoUser ? "#facc15" : "#52525b"}`,
              color: isDemoUser ? "#facc15" : "#a1a1aa",
              background: isDemoUser ? "#27272a" : "transparent",
              cursor: "pointer",
            }}
          >
            {isDemoUser ? "✅ DEMO" : "DEMO"}
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="app-body">

        {/* ═══ CHAT TAB ═══ */}
        {tab === "chat" && (
          <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: "calc(100dvh - 54px - 64px)" }}>

            {/* Chat messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 12px 8px", display: "flex", flexDirection: "column", gap: 8 }}>

              {messages.length === 0 && !isListening && !transcript && (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "40px 20px", gap: 12 }}>
                  <Hand style={{ width: 48, height: 48, color: "#facc15", opacity: 0.3 }} />
                  <p style={{ fontSize: "1.2rem", color: "#71717a", fontWeight: 700 }}>
                    Presiona <span style={{ color: "#facc15" }}>ESCUCHAR</span> para captar voces
                    o usa la casilla para <span style={{ color: "#facc15" }}>ESCRIBIR</span>
                  </p>
                </div>
              )}

              {messages.map(m => (
                <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: m.type === "said" ? "flex-end" : "flex-start" }}>
                  <div className={`chat-bubble ${m.type === "heard" ? "chat-heard" :
                      m.type === "said" ? "chat-said" :
                        m.type === "ai" ? "chat-ai" : "chat-system"
                    }`}>
                    {m.text}
                  </div>
                  <span style={{ fontSize: "0.65rem", color: "#52525b", marginTop: 2, paddingLeft: 4 }}>
                    {m.type === "heard" ? "🔊 Escuchado" : m.type === "said" ? "💬 Enviado" : ""}
                    {" "}{m.time}
                  </span>
                </div>
              ))}

              {/* Live transcript while listening */}
              {isListening && transcript && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                  <div className="chat-bubble chat-heard" style={{ opacity: 0.8 }}>
                    {transcript}
                  </div>
                  <span style={{ fontSize: "0.7rem", color: "#facc15", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                    <span className="live-dot" /> Escuchando en vivo...
                  </span>
                </div>
              )}

              {/* AI suggestions */}
              {(responses.length > 0 || isThinking) && (
                <div style={{ padding: 10, background: "#18181b", borderRadius: 14, border: "1px solid #27272a", marginTop: 4 }}>
                  <p style={{ fontSize: "0.85rem", fontWeight: 700, color: "#71717a", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                    <MessageSquare style={{ width: 16, height: 16, color: "#22c55e" }} /> Respuestas sugeridas:
                  </p>
                  {isThinking ? (
                    <p style={{ textAlign: "center", padding: 16, fontSize: "1.1rem", color: "#71717a" }}>🧠 Pensando...</p>
                  ) : responses.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => selectResponse(r, i)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "12px 14px",
                        borderRadius: 12,
                        border: `2px solid ${speakIdx === i ? "#facc15" : "#3f3f46"}`,
                        background: speakIdx === i ? "#facc15" : "#27272a",
                        color: speakIdx === i ? "#18181b" : "#fafafa",
                        fontSize: "1.2rem",
                        fontWeight: 700,
                        cursor: "pointer",
                        marginBottom: 6,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        transition: "all 0.12s",
                      }}
                    >
                      <span style={{ flex: 1 }}>{r}</span>
                      <Volume2 style={{ width: 18, height: 18, opacity: 0.5, flexShrink: 0 }} />
                    </button>
                  ))}
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* ── Bottom controls ── */}
            <div style={{ flexShrink: 0, background: "#18181b", borderTop: "1px solid #27272a", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 }}>

              {/* Write what you heard */}
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  value={heardInput}
                  onChange={(e) => setHeardInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") sendHeardText(); }}
                  placeholder="✏️ Escribe lo que escuchaste..."
                  style={{
                    flex: 1, background: "#27272a", border: "2px solid #3f3f46", borderRadius: 12,
                    padding: "10px 12px", fontSize: "1rem", fontWeight: 700, color: "#fafafa",
                    outline: "none",
                  }}
                />
                <button
                  onClick={sendHeardText}
                  disabled={!heardInput.trim()}
                  style={{
                    width: 48, height: 48, borderRadius: 12, background: "#22c55e", color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center", border: "none",
                    cursor: "pointer", opacity: heardInput.trim() ? 1 : 0.3,
                  }}
                >
                  <Send style={{ width: 20, height: 20 }} />
                </button>
              </div>

              {/* Mic + IA row */}
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={toggleListening}
                  disabled={!isSupported}
                  className={isListening ? "mic-pulse" : ""}
                  style={{
                    flex: 1, padding: "14px 0", borderRadius: 16, fontWeight: 800, fontSize: "1.2rem",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    background: isListening ? "#dc2626" : "#facc15",
                    color: isListening ? "#fff" : "#422006",
                    border: "none", cursor: "pointer",
                    opacity: isSupported ? 1 : 0.4,
                  }}
                >
                  {isListening ? <MicOff style={{ width: 22, height: 22 }} /> : <Mic style={{ width: 22, height: 22 }} />}
                  {isListening ? "PARAR" : "🎤 ESCUCHAR"}
                </button>

                {transcript && !isListening && (
                  <button
                    onClick={analyzeTranscript}
                    disabled={isThinking}
                    style={{
                      padding: "14px 20px", borderRadius: 16, background: "#22c55e", color: "#fff",
                      fontWeight: 800, fontSize: "1.1rem", border: "none", cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 6,
                    }}
                  >
                    <Send style={{ width: 18, height: 18 }} /> IA
                  </button>
                )}
              </div>

              {/* Manual reply */}
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  ref={replyRef as any}
                  value={manualReply}
                  onChange={(e) => setManualReply(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                  placeholder="💬 Tu respuesta manual..."
                  style={{
                    flex: 1, background: "#27272a", border: "2px solid #3f3f46", borderRadius: 12,
                    padding: "10px 12px", fontSize: "1rem", fontWeight: 700, color: "#fafafa",
                    outline: "none",
                  }}
                />
                <button
                  onClick={sendReply}
                  disabled={!manualReply.trim()}
                  style={{
                    width: 48, height: 48, borderRadius: 12, background: "#facc15", color: "#422006",
                    display: "flex", alignItems: "center", justifyContent: "center", border: "none",
                    cursor: "pointer", opacity: manualReply.trim() ? 1 : 0.3,
                  }}
                >
                  <Send style={{ width: 20, height: 20 }} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ PHOTOS TAB ═══ */}
        {tab === "photos" && (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 style={{ fontSize: "1.6rem", fontWeight: 800, display: "flex", alignItems: "center", gap: 10 }}>
              <ImageIcon style={{ width: 28, height: 28, color: "#facc15" }} /> Analizar Foto
            </h2>
            <label className={`btn-huge btn-secondary ${mediaLoading ? "opacity-60" : ""}`} style={{ position: "relative", cursor: "pointer" }}>
              <input type="file" accept="image/*" capture="environment" style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} onChange={handlePhoto} disabled={mediaLoading} />
              <Camera style={{ width: 24, height: 24 }} />
              {mediaLoading ? "⏳ ANALIZANDO..." : "📸 TOMAR O SUBIR FOTO"}
            </label>
            {preview && <img src={preview} alt="" style={{ borderRadius: 14, maxHeight: 200, objectFit: "cover", width: "100%", border: "2px solid #27272a" }} />}
            {summary && (
              <div style={{ background: "rgba(250,204,21,0.08)", border: "2px solid #facc15", borderRadius: 14, padding: 16 }}>
                <p style={{ fontSize: "1.4rem", fontWeight: 800, color: "#fafafa", lineHeight: 1.4 }}>{summary}</p>
                <button onClick={() => speak(summary)} className="btn-huge" style={{ marginTop: 10, background: "#27272a", color: "#facc15", border: "2px solid #3f3f46" }}>
                  <Volume2 style={{ width: 22, height: 22 }} /> 🔊 LEER EN VOZ ALTA
                </button>
              </div>
            )}
          </div>
        )}

        {/* ═══ DOCS TAB ═══ */}
        {tab === "docs" && (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 style={{ fontSize: "1.6rem", fontWeight: 800, display: "flex", alignItems: "center", gap: 10 }}>
              <FileText style={{ width: 28, height: 28, color: "#facc15" }} /> Analizar Documento
            </h2>
            <label className={`btn-huge btn-secondary ${mediaLoading ? "opacity-60" : ""}`} style={{ position: "relative", cursor: "pointer" }}>
              <input type="file" accept="image/*,.pdf" capture="environment" style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} onChange={handleDoc} disabled={mediaLoading} />
              <FileText style={{ width: 24, height: 24 }} />
              {mediaLoading ? "⏳ LEYENDO..." : "📄 SUBIR DOCUMENTO"}
            </label>
            {preview && <img src={preview} alt="" style={{ borderRadius: 14, maxHeight: 200, objectFit: "cover", width: "100%", border: "2px solid #27272a" }} />}
            {summary && (
              <div style={{ background: "rgba(250,204,21,0.08)", border: "2px solid #facc15", borderRadius: 14, padding: 16 }}>
                <h3 style={{ color: "#facc15", fontWeight: 700, fontSize: "1rem", marginBottom: 6 }}>📄 Resumen:</h3>
                <p style={{ fontSize: "1.4rem", fontWeight: 800, color: "#fafafa", lineHeight: 1.4 }}>{summary}</p>
                <button onClick={() => speak(summary)} className="btn-huge" style={{ marginTop: 10, background: "#27272a", color: "#facc15", border: "2px solid #3f3f46" }}>
                  <Volume2 style={{ width: 22, height: 22 }} /> 🔊 LEER EN VOZ ALTA
                </button>
              </div>
            )}
          </div>
        )}

        {/* ═══ AUDIO TAB ═══ */}
        {tab === "audio" && (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 style={{ fontSize: "1.6rem", fontWeight: 800, display: "flex", alignItems: "center", gap: 10 }}>
              <Music style={{ width: 28, height: 28, color: "#facc15" }} /> Transcribir Audio
            </h2>
            <p style={{ fontSize: "1rem", color: "#a1a1aa" }}>
              Sube un audio corto (máximo ~30 seg / 3 MB) y Gemini lo transcribirá a texto.
            </p>
            <label className={`btn-huge btn-secondary ${mediaLoading ? "opacity-60" : ""}`} style={{ position: "relative", cursor: "pointer" }}>
              <input
                type="file"
                accept="audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/webm,audio/aac,audio/flac,audio/x-m4a,video/mp4,video/webm,video/quicktime,.mp3,.m4a,.ogg,.wav,.aac,.flac,.mp4,.mov,.webm"
                style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
                onChange={handleAudio}
                disabled={mediaLoading}
              />
              <Music style={{ width: 24, height: 24 }} />
              {mediaLoading ? "⏳ TRANSCRIBIENDO..." : "🎵 SUBIR AUDIO O VIDEO"}
            </label>
            {summary && (
              <div style={{ background: "rgba(250,204,21,0.08)", border: "2px solid #facc15", borderRadius: 14, padding: 16 }}>
                <h3 style={{ color: "#facc15", fontWeight: 700, fontSize: "1rem", marginBottom: 6 }}>📝 Transcripción:</h3>
                <p style={{ fontSize: "1.4rem", fontWeight: 800, color: "#fafafa", lineHeight: 1.4 }}>{summary}</p>
                <button onClick={() => speak(summary)} className="btn-huge" style={{ marginTop: 10, background: "#27272a", color: "#facc15", border: "2px solid #3f3f46" }}>
                  <Volume2 style={{ width: 22, height: 22 }} /> 🔊 LEER EN VOZ ALTA
                </button>
              </div>
            )}
          </div>
        )}

        {/* ═══ CONTACTS TAB ═══ */}
        {tab === "contacts" && (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 style={{ fontSize: "1.6rem", fontWeight: 800, display: "flex", alignItems: "center", gap: 10 }}>
              <Phone style={{ width: 28, height: 28, color: "#facc15" }} /> Contactos
            </h2>
            {contacts.map(c => (
              <a key={c.id} href={`https://wa.me/${c.phone}`} target="_blank" rel="noopener noreferrer"
                className="btn-huge" style={{ background: "#14532d", border: "2px solid #166534", color: "#fff", textDecoration: "none" }}>
                📱 {c.name.toUpperCase()}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* ── Tab Bar ── */}
      <nav className="tab-bar">
        {([
          { k: "chat" as TabKey, icon: <MessageSquare />, label: "Chat" },
          { k: "photos" as TabKey, icon: <ImageIcon />, label: "Fotos" },
          { k: "docs" as TabKey, icon: <FileText />, label: "Docs" },
          { k: "audio" as TabKey, icon: <Music />, label: "Audio" },
          { k: "contacts" as TabKey, icon: <Phone />, label: "Contactos" },
        ]).map(t => (
          <button
            key={t.k}
            onClick={() => { setTab(t.k); setSummary(null); setPreview(null); }}
            className={`tab-btn ${tab === t.k ? "active" : ""}`}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
