"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Mic, MicOff, Camera, MessageSquare, Phone, Volume2,
  Hand, Send, FileText, Music, Image as ImageIcon,
  ToggleLeft, ToggleRight, Download, Film, Paperclip
} from "lucide-react";
import { useDemoUser } from "@/components/DemoUserProvider";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { compressImage, fileToBase64, generateSRT, downloadFile } from "@/lib/mediaUtils";
import contacts from "@/lib/contacts.json";

type ChatMsg = { id: string; type: "heard" | "said" | "ai" | "system"; text: string; time: string };
type TabKey = "chat" | "media" | "contacts";
type MediaSection = "photos" | "video" | "docs" | "audio";

const ts = () => new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const MAX_AUDIO_BYTES = 50 * 1024 * 1024; // 50 MB (Vercel Free limit is 4.5MB, but local allows 50MB)

export default function Home() {
  const { isDemoUser, userName, enableDemoMode, disableDemoMode } = useDemoUser();
  const [tab, setTab] = useState<TabKey>("chat");
  const [mediaSection, setMediaSection] = useState<MediaSection>("photos");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [responses, setResponses] = useState<string[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [speakIdx, setSpeakIdx] = useState<number | null>(null);
  const [manualReply, setManualReply] = useState("");
  const [heardInput, setHeardInput] = useState("");
  const [aiEnabled, setAiEnabled] = useState(true);
  const [isPlayingSpeech, setIsPlayingSpeech] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  const stopSpeech = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeakIdx(null);
    setIsPlayingSpeech(false);
  }, []);

  // Media
  const [preview, setPreview] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [subtitleText, setSubtitleText] = useState<string | null>(null);

  // Refs for stable callbacks
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const addMsg = useCallback((type: ChatMsg["type"], text: string) => {
    setMessages(p => [...p, { id: uid(), type, text, time: ts() }]);
    try {
      const h = JSON.parse(localStorage.getItem("oirte_history") || "[]");
      localStorage.setItem("oirte_history", JSON.stringify([...h, `[${type}] ${text}`]));
    } catch { /* */ }
  }, []);

  const fetchSuggestions = useCallback(async (text: string) => {
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
      setMessages(p => [...p, { id: uid(), type: "system", text: "❌ " + e.message, time: ts() }]);
    } finally {
      setIsThinking(false);
    }
  }, []);

  // Auto-stop callback
  const onAutoStop = useCallback((finalText: string) => {
    if (!finalText.trim()) return;
    const last = messagesRef.current[messagesRef.current.length - 1];
    if (last?.type === "heard" && last?.text === finalText.trim()) return;
    addMsg("heard", finalText.trim());
    if (aiEnabled) fetchSuggestions(finalText.trim());
  }, [addMsg, fetchSuggestions, aiEnabled]);

  const { isListening, transcript, isSupported, toggleListening, setTranscript } =
    useSpeechRecognition(onAutoStop);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, responses, transcript]);

  const speak = useCallback(async (text: string, idx?: number) => {
    stopSpeech(); // Detiene audios empalmados previos
    setIsPlayingSpeech(true);

    try {
      if (idx !== undefined) setSpeakIdx(idx);

      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });

      if (!res.ok) throw new Error("TTS Falló o sin crédito de ElevenLabs");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudioRef.current = audio;

      audio.onended = () => {
        if (idx !== undefined) setSpeakIdx(null);
        setIsPlayingSpeech(false);
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        if (idx !== undefined) setSpeakIdx(null);
        setIsPlayingSpeech(false);
      };

      await audio.play();
    } catch (e) {
      console.warn("ElevenLabs falló, usando voz nativa. Razón:", e);
      // Fallback a la voz nativa del dispositivo
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        if (idx !== undefined) setSpeakIdx(null);
        setIsPlayingSpeech(false);
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "es-ES";
      u.rate = 1.0;
      u.volume = 1;
      u.pitch = 0.98; // Tono más sereno para la voz nativa

      const voices = window.speechSynthesis.getVoices();
      const bestVoice =
        voices.find(v => v.lang.startsWith("es") && (v.name.includes("Natural") || v.name.includes("Online"))) ||
        voices.find(v => v.lang.startsWith("es") && v.name.includes("Google")) ||
        voices.find(v => v.lang.startsWith("es") && (v.name.includes("Sabina") || v.name.includes("Dalia") || v.name.includes("Elena"))) ||
        voices.find(v => v.lang.startsWith("es") && v.name.includes("Female")) ||
        voices.find(v => v.lang.startsWith("es"));

      if (bestVoice) {
        u.voice = bestVoice;
        u.lang = bestVoice.lang;
      }

      if (idx !== undefined) u.onstart = () => setSpeakIdx(idx);
      u.onend = () => { setSpeakIdx(null); setIsPlayingSpeech(false); };
      u.onerror = () => { setSpeakIdx(null); setIsPlayingSpeech(false); };

      window.speechSynthesis.speak(u);
    }
  }, [stopSpeech]);
  console.warn("ElevenLabs falló, usando voz nativa. Razón:", e);
  // Fallback a la voz nativa del dispositivo
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    if (idx !== undefined) setSpeakIdx(null);
    return;
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "es-ES";
  u.rate = 1.0;
  u.volume = 1;
  u.pitch = 0.98; // Tono más sereno para la voz nativa

  const voices = window.speechSynthesis.getVoices();
  const bestVoice =
    voices.find(v => v.lang.startsWith("es") && (v.name.includes("Natural") || v.name.includes("Online"))) ||
    voices.find(v => v.lang.startsWith("es") && v.name.includes("Google")) ||
    voices.find(v => v.lang.startsWith("es") && (v.name.includes("Sabina") || v.name.includes("Dalia") || v.name.includes("Elena"))) ||
    voices.find(v => v.lang.startsWith("es") && v.name.includes("Female")) ||
    voices.find(v => v.lang.startsWith("es"));

  if (bestVoice) {
    u.voice = bestVoice;
    u.lang = bestVoice.lang;
  }

  if (idx !== undefined) {
    u.onstart = () => setSpeakIdx(idx);
    u.onend = () => setSpeakIdx(null);
    u.onerror = () => { setSpeakIdx(null); };
  }
  window.speechSynthesis.speak(u);
}
  }, []);

const selectResponse = (text: string, idx: number) => {
  addMsg("said", text);
  speak(text, idx);
  setResponses([]);
  setTranscript("");
};

const sendReply = () => {
  const t = manualReply.trim();
  if (!t) return;
  addMsg("said", t); speak(t);
  setManualReply(""); setResponses([]);
  setTranscript(""); // Fix: limpia la caja de transcripción
};

const sendHeardText = () => {
  const t = heardInput.trim();
  if (!t) return;
  addMsg("heard", t);
  if (aiEnabled) fetchSuggestions(t);
  setHeardInput("");
  setTranscript(""); // Fix: limpia la caja de transcripción
};

// ── Photo upload (with compression) ──────────────────────────
const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const f = e.target.files?.[0]; if (!f) return;
  setMediaLoading(true); setSummary(null); setPreview(null);
  try {
    const { base64, mimeType } = await compressImage(f);
    setPreview(`data:${mimeType};base64,${base64}`);
    const r = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64, mimeType }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    setSummary(d.summary); speak(d.summary);
  } catch (err: any) { alert("❌ " + err.message); }
  finally { setMediaLoading(false); e.target.value = ""; }
};

// ── Doc upload ────────────────────────────────────────────────
const handleDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const f = e.target.files?.[0]; if (!f) return;
  setMediaLoading(true); setSummary(null); setPreview(null);

  const textExts = [".txt", ".md", ".csv", ".json", ".xml", ".html", ".log", ".rtf"];
  const isTextFile = f.type.startsWith("text/") || textExts.some(ext => f.name.toLowerCase().endsWith(ext));

  if (isTextFile) {
    try {
      const text = await f.text();
      const r = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docText: text }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setSummary(d.summary); speak(d.summary);
    } catch (err: any) { alert("❌ " + err.message); }
    finally { setMediaLoading(false); e.target.value = ""; }
    return;
  }

  // Image-based doc (photo of document, PDF)
  try {
    if (f.type.startsWith("image/")) {
      const { base64, mimeType } = await compressImage(f, 1400, 0.8);
      setPreview(`data:${mimeType};base64,${base64}`);
      const r = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, mimeType, docMode: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setSummary(d.summary); speak(d.summary);
    } else {
      // PDF or other binary
      const base64 = await fileToBase64(f);
      const r = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, mimeType: f.type || "application/pdf", docMode: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setSummary(d.summary); speak(d.summary);
    }
  } catch (err: any) { alert("❌ " + err.message); }
  finally { setMediaLoading(false); e.target.value = ""; }
};

// ── Audio upload ──────────────────────────────────────────────
const handleAudio = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const f = e.target.files?.[0]; if (!f) return;
  if (f.size > MAX_AUDIO_BYTES) {
    alert(`⚠️ Archivo demasiado grande (${(f.size / 1024 / 1024).toFixed(1)} MB).\nMáximo ~4.5 MB (~5 min de audio).`);
    e.target.value = ""; return;
  }
  setMediaLoading(true); setSummary(null); setSubtitleText(null);
  try {
    const base64 = await fileToBase64(f);
    const r = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: base64, audioMimeType: f.type || "audio/mpeg" }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    setSummary(d.transcription || "No se pudo transcribir.");
    if (d.transcription) speak(d.transcription);
  } catch (err: any) { alert("❌ " + err.message); }
  finally { setMediaLoading(false); e.target.value = ""; }
};

// ── Video upload (with subtitles) ─────────────────────────────
const handleVideo = async (e: React.ChangeEvent<HTMLInputElement>, withSubs: boolean) => {
  const f = e.target.files?.[0]; if (!f) return;
  if (f.size > MAX_AUDIO_BYTES) {
    alert(`⚠️ Video demasiado grande (${(f.size / 1024 / 1024).toFixed(1)} MB).\nMáximp ~4.5 MB. Usa un video corto o recórtalo antes de subirlo.`);
    e.target.value = ""; return;
  }
  setMediaLoading(true); setSummary(null); setSubtitleText(null);
  try {
    const base64 = await fileToBase64(f);
    const r = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audio: base64,
        audioMimeType: f.type || "video/mp4",
        subtitles: withSubs,
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    const text = d.transcription || "No se pudo transcribir.";
    setSummary(text);
    if (withSubs) {
      setSubtitleText(text);
    }
    speak(text);
  } catch (err: any) { alert("❌ " + err.message); }
  finally { setMediaLoading(false); e.target.value = ""; }
};

const downloadSRT = () => {
  if (!subtitleText) return;
  const srt = generateSRT(subtitleText);
  downloadFile(srt, "subtitulos_oirte.srt");
};

// ═══ INLINE STYLES ═══════════════════════════════════════════
const S = {
  shell: { position: "fixed" as const, inset: 0, display: "flex", flexDirection: "column" as const, maxWidth: 640, margin: "0 auto", width: "100%", background: "#09090b", color: "#fafafa", fontFamily: "system-ui, -apple-system, sans-serif" },
  header: { flexShrink: 0, padding: "8px 12px", background: "#18181b", borderBottom: "1px solid #27272a", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 100 },
  body: { flex: 1, overflowY: "auto" as const, overflowX: "hidden" as const, WebkitOverflowScrolling: "touch" as const },
  tabBar: { flexShrink: 0, display: "flex", background: "#18181b", borderTop: "1px solid #27272a", paddingBottom: "env(safe-area-inset-bottom, 0px)" },
  tabBtn: (active: boolean) => ({ flex: 1, display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", gap: 2, padding: "10px 0", fontSize: "0.7rem", fontWeight: 700, color: active ? "#facc15" : "#71717a", background: "none", border: "none", cursor: "pointer", WebkitTapHighlightColor: "transparent" }),
  tabIcon: { width: 24, height: 24 },
  input: { flex: 1, background: "#27272a", border: "2px solid #3f3f46", borderRadius: 12, padding: "10px 12px", fontSize: "1rem", fontWeight: 700, color: "#fafafa", outline: "none", fontFamily: "inherit" },
  sendBtn: (color: string, active: boolean) => ({ width: 46, height: 46, borderRadius: 12, background: color, color: color === "#facc15" ? "#422006" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", border: "none", cursor: "pointer", opacity: active ? 1 : 0.3, flexShrink: 0 }),
  micBtn: (listening: boolean) => ({ flex: 1, padding: "14px 0", borderRadius: 16, fontWeight: 800, fontSize: "1.15rem", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: listening ? "#dc2626" : "#facc15", color: listening ? "#fff" : "#422006", border: "none", cursor: "pointer" }),
  bubble: (type: string) => {
    const base: React.CSSProperties = { borderRadius: 16, padding: "12px 16px", maxWidth: "88%", fontSize: "1.25rem", fontWeight: 700, lineHeight: 1.4, wordBreak: "break-word" };
    if (type === "heard") return { ...base, background: "#27272a", color: "#fafafa", borderLeft: "4px solid #facc15", alignSelf: "flex-start" as const };
    if (type === "said") return { ...base, background: "#facc15", color: "#18181b", alignSelf: "flex-end" as const };
    if (type === "ai") return { ...base, background: "#1a2e1a", color: "#bbf7d0", borderLeft: "4px solid #22c55e", alignSelf: "flex-start" as const };
    return { ...base, background: "transparent", color: "#71717a", alignSelf: "center" as const, textAlign: "center" as const, fontSize: "0.9rem", maxWidth: "100%" };
  },
  bigBtn: (bg = "#27272a", border = "none"): React.CSSProperties => ({ width: "100%", padding: "16px 20px", borderRadius: 16, fontWeight: 800, fontSize: "1.2rem", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, cursor: "pointer", border, background: bg, color: "#fafafa", WebkitTapHighlightColor: "transparent" }),
  resultBox: { background: "rgba(250,204,21,0.08)", border: "2px solid #facc15", borderRadius: 14, padding: 16 } as React.CSSProperties,
  sectionBtn: (active: boolean): React.CSSProperties => ({ flex: 1, padding: "10px 4px", borderRadius: 12, fontWeight: 800, fontSize: "0.75rem", textAlign: "center", background: active ? "#facc15" : "#27272a", color: active ? "#422006" : "#a1a1aa", border: active ? "none" : "1px solid #3f3f46", cursor: "pointer", WebkitTapHighlightColor: "transparent" }),
};

return (
  <div style={S.shell}>

    {/* ── Header ── */}
    <div style={S.header}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Hand style={{ width: 22, height: 22, color: "#facc15" }} />
        <span style={{ fontSize: "1.15rem", fontWeight: 900, color: "#facc15" }}>OIRTE AI</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: "0.7rem", color: "#a1a1aa", fontWeight: 700 }}>👤 {userName}</span>
        <button
          onClick={isDemoUser ? disableDemoMode : enableDemoMode}
          style={{ padding: "4px 10px", borderRadius: 8, fontSize: "0.65rem", fontWeight: 800, border: `2px solid ${isDemoUser ? "#facc15" : "#52525b"}`, color: isDemoUser ? "#facc15" : "#a1a1aa", background: isDemoUser ? "#27272a" : "transparent", cursor: "pointer" }}
        >
          {isDemoUser ? "✅ DEMO" : "DEMO"}
        </button>
      </div>
    </div>

    {/* ── Body ── */}
    <div style={S.body}>

      {/* ═══ CHAT TAB ═══ */}
      {tab === "chat" && (
        <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>

          <div style={{ flex: 1, padding: "10px 10px 6px", display: "flex", flexDirection: "column", gap: 8 }}>

            {messages.length === 0 && !isListening && !transcript && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "24px 14px", gap: 10 }}>
                <Hand style={{ width: 44, height: 44, color: "#facc15", opacity: 0.3 }} />
                <p style={{ fontSize: "1.05rem", color: "#71717a", fontWeight: 700 }}>
                  Presiona <span style={{ color: "#facc15" }}>ESCUCHAR</span> para captar voces
                  o <span style={{ color: "#facc15" }}>ESCRÍBEME</span> abajo
                </p>
              </div>
            )}

            {messages.map(m => (
              <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: m.type === "said" ? "flex-end" : "flex-start" }}>
                <div style={S.bubble(m.type)}>{m.text}</div>
                <span style={{ fontSize: "0.6rem", color: "#52525b", marginTop: 2, paddingInlineStart: 4 }}>
                  {m.type === "heard" ? "🔊 Escuchado" : m.type === "said" ? "💬 Enviado" : ""} {m.time}
                </span>
              </div>
            ))}

            {/* Live transcript */}
            {isListening && transcript && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                <div style={{ ...S.bubble("heard"), opacity: 0.85 }}>{transcript}</div>
                <span style={{ fontSize: "0.7rem", color: "#facc15", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 8, height: 8, background: "#ef4444", borderRadius: "50%", display: "inline-block" }} />
                  Escuchando en vivo...
                </span>
              </div>
            )}

            {/* Captured text after stop */}
            {!isListening && transcript && !isThinking && responses.length === 0 && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                <div style={{ ...S.bubble("heard"), border: "2px dashed #facc15" }}>{transcript}</div>
                <span style={{ fontSize: "0.7rem", color: "#a1a1aa", marginTop: 2 }}>
                  ✅ Texto capturado {aiEnabled ? "— esperando IA..." : ""}
                </span>
              </div>
            )}

            {/* AI suggestions */}
            {(responses.length > 0 || isThinking) && (
              <div style={{ padding: 10, background: "#18181b", borderRadius: 14, border: "1px solid #27272a", marginTop: 4 }}>
                <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "#71717a", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <MessageSquare style={{ width: 14, height: 14, color: "#22c55e" }} /> Respuestas sugeridas:
                </p>
                {isThinking ? (
                  <p style={{ textAlign: "center", padding: 12, fontSize: "1rem", color: "#71717a" }}>🧠 Pensando...</p>
                ) : responses.map((r, i) => (
                  <button key={i} onClick={() => selectResponse(r, i)} style={{
                    width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 12,
                    border: `2px solid ${speakIdx === i ? "#facc15" : "#3f3f46"}`,
                    background: speakIdx === i ? "#facc15" : "#27272a",
                    color: speakIdx === i ? "#18181b" : "#fafafa",
                    fontSize: "1.1rem", fontWeight: 700, cursor: "pointer", marginBottom: 5,
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                  }}>
                    <span style={{ flex: 1 }}>{r}</span>
                    <Volume2 style={{ width: 16, height: 16, opacity: 0.5, flexShrink: 0 }} />
                  </button>
                ))}
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* ── Bottom controls ── */}
          <div style={{ flexShrink: 0, background: "#18181b", borderTop: "1px solid #27272a", padding: "6px 8px", display: "flex", flexDirection: "column", gap: 4 }}>

            {/* AI toggle */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, paddingBottom: 2 }}>
              <span style={{ fontSize: "0.7rem", color: "#71717a", fontWeight: 700 }}>Sugerencias IA</span>
              <button
                onClick={() => setAiEnabled(!aiEnabled)}
                style={{ background: "none", border: "none", cursor: "pointer", color: aiEnabled ? "#22c55e" : "#52525b", display: "flex", alignItems: "center" }}
              >
                {aiEnabled ? <ToggleRight style={{ width: 28, height: 28 }} /> : <ToggleLeft style={{ width: 28, height: 28 }} />}
              </button>
            </div>

            {/* Heard input */}
            <div style={{ display: "flex", gap: 5 }}>
              <input value={heardInput} onChange={(e) => setHeardInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendHeardText(); }}
                placeholder="¡Escríbeme aquí! ✏️" style={S.input} />
              <button onClick={sendHeardText} disabled={!heardInput.trim()} style={S.sendBtn("#22c55e", !!heardInput.trim())}>
                <Send style={{ width: 18, height: 18 }} />
              </button>
            </div>

            {/* Mic */}
            <button onClick={toggleListening} disabled={!isSupported}
              className={isListening ? "mic-pulse" : ""}
              style={{ ...S.micBtn(isListening), opacity: isSupported ? 1 : 0.4 }}>
              {isListening ? <MicOff style={{ width: 22, height: 22 }} /> : <Mic style={{ width: 22, height: 22 }} />}
              {isListening ? "🛑 PARAR" : "🎤 ESCUCHAR"}
            </button>

            {/* Manual reply */}
            <div style={{ display: "flex", gap: 5 }}>
              <input value={manualReply} onChange={(e) => setManualReply(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendReply(); } }}
                placeholder="💬 Tu respuesta..." style={S.input} />
              <button onClick={sendReply} disabled={!manualReply.trim()} style={S.sendBtn("#facc15", !!manualReply.trim())}>
                <Send style={{ width: 18, height: 18 }} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MEDIA TAB ═══ */}
      {tab === "media" && (
        <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Section selector */}
          <div style={{ display: "flex", gap: 6 }}>
            {([
              { k: "photos" as MediaSection, icon: "📸", label: "Fotos" },
              { k: "video" as MediaSection, icon: "🎬", label: "Video" },
              { k: "docs" as MediaSection, icon: "📄", label: "Docs" },
              { k: "audio" as MediaSection, icon: "🎵", label: "Audio" },
            ]).map(s => (
              <button key={s.k} onClick={() => { setMediaSection(s.k); setSummary(null); setPreview(null); setSubtitleText(null); }} style={S.sectionBtn(mediaSection === s.k)}>
                {s.icon} {s.label}
              </button>
            ))}
          </div>

          {/* ── PHOTOS section ── */}
          {mediaSection === "photos" && (<>
            <h2 style={{ fontSize: "1.4rem", fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
              <ImageIcon style={{ width: 24, height: 24, color: "#facc15" }} /> Analizar Foto
            </h2>
            <label style={{ ...S.bigBtn(), position: "relative", opacity: mediaLoading ? 0.6 : 1 }}>
              <input type="file" accept="image/*" capture="environment" style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} onChange={handlePhoto} disabled={mediaLoading} />
              <Camera style={{ width: 20, height: 20 }} />
              {mediaLoading ? "⏳ ANALIZANDO..." : "📸 TOMAR FOTO"}
            </label>
            <label style={{ ...S.bigBtn("#1a1a2e", "2px solid #3f3f46"), position: "relative", opacity: mediaLoading ? 0.6 : 1 }}>
              <input type="file" accept="image/*" style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} onChange={handlePhoto} disabled={mediaLoading} />
              <ImageIcon style={{ width: 20, height: 20 }} />
              🖼️ ELEGIR DE GALERÍA
            </label>
          </>)}

          {/* ── VIDEO section ── */}
          {mediaSection === "video" && (<>
            <h2 style={{ fontSize: "1.4rem", fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
              <Film style={{ width: 24, height: 24, color: "#facc15" }} /> Video + Subtítulos
            </h2>
            <p style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>
              Sube un video corto (máx ~4.5 MB). Gemini transcribirá el audio y generará subtítulos descargables en formato SRT.
            </p>
            <label style={{ ...S.bigBtn(), position: "relative", opacity: mediaLoading ? 0.6 : 1 }}>
              <input type="file" accept="video/*,.mp4,.mov,.webm,.3gp" style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} onChange={(e) => handleVideo(e, false)} disabled={mediaLoading} />
              <Film style={{ width: 20, height: 20 }} />
              {mediaLoading ? "⏳ PROCESANDO..." : "🎬 TRANSCRIBIR VIDEO"}
            </label>
            <label style={{ ...S.bigBtn("#14532d", "2px solid #166534"), position: "relative", opacity: mediaLoading ? 0.6 : 1 }}>
              <input type="file" accept="video/*,.mp4,.mov,.webm,.3gp" style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} onChange={(e) => handleVideo(e, true)} disabled={mediaLoading} />
              <Download style={{ width: 20, height: 20 }} />
              {mediaLoading ? "⏳ GENERANDO..." : "📝 GENERAR SUBTÍTULOS SRT"}
            </label>
          </>)}

          {/* ── DOCS section ── */}
          {mediaSection === "docs" && (<>
            <h2 style={{ fontSize: "1.4rem", fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
              <FileText style={{ width: 24, height: 24, color: "#facc15" }} /> Analizar Documento
            </h2>
            <p style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Foto de documento, PDF, TXT, Word, o cualquier archivo de texto.</p>
            <label style={{ ...S.bigBtn(), position: "relative", opacity: mediaLoading ? 0.6 : 1 }}>
              <input type="file" accept="image/*" capture="environment" style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} onChange={handleDoc} disabled={mediaLoading} />
              <Camera style={{ width: 20, height: 20 }} />
              {mediaLoading ? "⏳ LEYENDO..." : "📷 FOTO DE DOCUMENTO"}
            </label>
            <label style={{ ...S.bigBtn("#1a1a2e", "2px solid #3f3f46"), position: "relative", opacity: mediaLoading ? 0.6 : 1 }}>
              <input type="file" accept=".pdf,.txt,.md,.doc,.docx,.csv,.json,.xml,.html,.rtf,.log,image/*,application/pdf,text/*" style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} onChange={handleDoc} disabled={mediaLoading} />
              <FileText style={{ width: 20, height: 20 }} />
              📄 SUBIR ARCHIVO
            </label>
          </>)}

          {/* ── AUDIO section ── */}
          {mediaSection === "audio" && (<>
            <h2 style={{ fontSize: "1.4rem", fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
              <Music style={{ width: 24, height: 24, color: "#facc15" }} /> Transcribir Audio
            </h2>
            <p style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>
              Sube un audio (máx ~5 min / 4.5 MB). Si es música, Gemini transcribirá la letra.
            </p>
            <label style={{ ...S.bigBtn(), position: "relative", opacity: mediaLoading ? 0.6 : 1 }}>
              <input type="file" accept="audio/*,.mp3,.m4a,.ogg,.wav,.aac,.flac" style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} onChange={handleAudio} disabled={mediaLoading} />
              <Music style={{ width: 20, height: 20 }} />
              {mediaLoading ? "⏳ TRANSCRIBIENDO..." : "🎵 SUBIR AUDIO"}
            </label>
            <div style={{ padding: 10, background: "#1a1a2e", borderRadius: 12, border: "1px solid #27272a" }}>
              <p style={{ fontSize: "0.8rem", color: "#71717a" }}>
                💡 <strong>Tip:</strong> Para importar audios de WhatsApp, abre el audio en WhatsApp → Compartir → Guardar en Archivos → Luego súbelo aquí.
              </p>
            </div>
          </>)}

          {/* ── Results (shared across sections) ── */}
          {preview && <img src={preview} alt="" style={{ borderRadius: 14, maxHeight: 200, objectFit: "cover", width: "100%", border: "2px solid #27272a" }} />}
          {summary && (
            <div style={S.resultBox}>
              <p style={{ fontSize: "1.2rem", fontWeight: 800, color: "#fafafa", lineHeight: 1.4, whiteSpace: "pre-wrap" }}>{summary}</p>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <button onClick={() => isPlayingSpeech ? stopSpeech() : speak(summary)} style={{ ...S.bigBtn("#27272a", "2px solid #3f3f46"), flex: 1, color: "#facc15" }}>
                  <Volume2 style={{ width: 18, height: 18 }} /> {isPlayingSpeech ? "⏹ DETENER" : "🔊 LEER"}
                </button>
                {subtitleText && (
                  <button onClick={downloadSRT} style={{ ...S.bigBtn("#14532d", "2px solid #166534"), flex: 1 }}>
                    <Download style={{ width: 18, height: 18 }} /> 📥 SRT
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ CONTACTS TAB ═══ */}
      {tab === "contacts" && (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 style={{ fontSize: "1.4rem", fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
            <Phone style={{ width: 24, height: 24, color: "#facc15" }} /> Contactos
          </h2>
          {contacts.map(c => (
            <a key={c.id} href={`https://wa.me/${c.phone}`} target="_blank" rel="noopener noreferrer"
              style={{ ...S.bigBtn("#14532d", "2px solid #166534"), textDecoration: "none", color: "#fff" }}>
              📱 {c.name.toUpperCase()}
            </a>
          ))}
        </div>
      )}
    </div>

    {/* ── Tab Bar (3 tabs now) ── */}
    <nav style={S.tabBar}>
      {([
        { k: "chat" as TabKey, icon: <MessageSquare style={S.tabIcon} />, label: "Chat" },
        { k: "media" as TabKey, icon: <Paperclip style={S.tabIcon} />, label: "Medios" },
        { k: "contacts" as TabKey, icon: <Phone style={S.tabIcon} />, label: "Contactos" },
      ]).map(t => (
        <button key={t.k} onClick={() => { setTab(t.k); setSummary(null); setPreview(null); setSubtitleText(null); }} style={S.tabBtn(tab === t.k)}>
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  </div>
);
}
