"use client";

import { useState, useEffect, useRef, useCallback } from "react";

type UseSpeechReturn = {
    isListening: boolean;
    transcript: string;
    isSupported: boolean;
    toggleListening: () => void;
    stopListening: () => void;
    setTranscript: React.Dispatch<React.SetStateAction<string>>;
};

/**
 * Auto-stop after SILENCE_TIMEOUT_MS of no new speech results.
 */
const SILENCE_TIMEOUT_MS = 4000; // 4 seconds

export function useSpeechRecognition(onAutoStop?: (finalText: string) => void): UseSpeechReturn {
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState("");
    const [isSupported, setIsSupported] = useState(false);
    const recognitionRef = useRef<any>(null);
    const finalRef = useRef("");
    const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const autoStopCb = useRef(onAutoStop);

    // Keep callback ref updated
    useEffect(() => { autoStopCb.current = onAutoStop; }, [onAutoStop]);

    const clearSilenceTimer = () => {
        if (silenceTimer.current) { clearTimeout(silenceTimer.current); silenceTimer.current = null; }
    };

    const resetSilenceTimer = useCallback(() => {
        clearSilenceTimer();
        silenceTimer.current = setTimeout(() => {
            // Auto-stop after silence
            if (recognitionRef.current && finalRef.current.trim()) {
                try { recognitionRef.current.stop(); } catch { }
                const text = finalRef.current.trim();
                autoStopCb.current?.(text);
            }
        }, SILENCE_TIMEOUT_MS);
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;

        const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SR) { setIsSupported(false); return; }
        setIsSupported(true);

        const r = new SR();
        r.lang = "es-ES";
        r.continuous = true;
        r.interimResults = true;
        r.maxAlternatives = 1;

        r.onstart = () => { setIsListening(true); finalRef.current = ""; };

        r.onresult = (ev: any) => {
            let interim = "";
            let newFinal = "";
            for (let i = ev.resultIndex; i < ev.results.length; i++) {
                if (ev.results[i].isFinal) newFinal += ev.results[i][0].transcript;
                else interim += ev.results[i][0].transcript;
            }
            if (newFinal) finalRef.current += newFinal;
            setTranscript((finalRef.current + interim).trim());
            resetSilenceTimer(); // restart the silence countdown
        };

        r.onerror = (ev: any) => {
            clearSilenceTimer();
            setIsListening(false);
            if (ev.error === "not-allowed" || ev.error === "permission-denied") {
                alert("⚠️ Permiso de micrófono denegado. Habilítalo en la barra del navegador.");
            }
        };

        r.onend = () => { clearSilenceTimer(); setIsListening(false); };

        recognitionRef.current = r;
        return () => { clearSilenceTimer(); try { r.stop(); } catch { } };
    }, [resetSilenceTimer]);

    const toggleListening = useCallback(() => {
        if (!recognitionRef.current) return;
        if (isListening) {
            clearSilenceTimer();
            recognitionRef.current.stop();
        } else {
            finalRef.current = "";
            setTranscript("");
            try { recognitionRef.current.start(); } catch { }
        }
    }, [isListening]);

    const stopListening = useCallback(() => {
        clearSilenceTimer();
        if (isListening && recognitionRef.current) { recognitionRef.current.stop(); }
    }, [isListening]);

    return { isListening, transcript, isSupported, toggleListening, stopListening, setTranscript };
}
