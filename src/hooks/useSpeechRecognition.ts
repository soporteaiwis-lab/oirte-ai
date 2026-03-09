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
 * Robust speech recognition hook that works on Desktop AND iOS Safari.
 *
 * Key design decisions for iOS compatibility:
 * 1. We keep a `finalRef` that accumulates ALL final results across restarts.
 * 2. On iOS, `continuous` mode often fires `onend` prematurely. We auto-restart
 *    if the user hasn't manually stopped, so listening feels "continuous".
 * 3. When the user presses STOP or auto-stop fires, we FIRST save the
 *    accumulated text to the messages list, THEN stop recognition.
 * 4. The transcript state is NEVER cleared by the stop action itself — only
 *    by the NEXT start, or by the parent calling setTranscript("").
 */

const SILENCE_MS = 4000; // 4 seconds of silence => auto-stop

export function useSpeechRecognition(
    onAutoStop?: (finalText: string) => void
): UseSpeechReturn {
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState("");
    const [isSupported, setIsSupported] = useState(false);

    const recognitionRef = useRef<any>(null);
    // Accumulated final text across restarts
    const finalTextRef = useRef("");
    // Whether user intentionally stopped (vs iOS auto-end)
    const userStoppedRef = useRef(false);
    // Whether we are supposed to be listening
    const wantListeningRef = useRef(false);
    // Silence timer
    const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Callback ref
    const autoStopCbRef = useRef(onAutoStop);
    // Track last interim so we have a fallback
    const lastInterimRef = useRef("");

    useEffect(() => {
        autoStopCbRef.current = onAutoStop;
    }, [onAutoStop]);

    const clearSilence = useCallback(() => {
        if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
        }
    }, []);

    const doStop = useCallback((triggerCallback: boolean) => {
        clearSilence();
        wantListeningRef.current = false;
        userStoppedRef.current = true;

        // Compute the best text we have right now
        let text = finalTextRef.current.trim();
        // If final text is empty but we have interim, use it
        if (!text && lastInterimRef.current.trim()) {
            text = lastInterimRef.current.trim();
        }

        // IMPORTANT: update transcript state BEFORE stopping recognition
        // so the parent component can see the final text
        if (text) {
            setTranscript(text);
        }

        // Now stop recognition
        try {
            recognitionRef.current?.stop();
        } catch {
            // ignore
        }

        // Fire callback AFTER saving
        if (triggerCallback && text) {
            autoStopCbRef.current?.(text);
        }

        setIsListening(false);
    }, [clearSilence]);

    const resetSilence = useCallback(() => {
        clearSilence();
        silenceTimerRef.current = setTimeout(() => {
            if (wantListeningRef.current) {
                doStop(true); // auto-stop with callback
            }
        }, SILENCE_MS);
    }, [clearSilence, doStop]);

    // ── Create recognition instance ──────────────────────────────
    useEffect(() => {
        if (typeof window === "undefined") return;

        const SR =
            (window as any).SpeechRecognition ||
            (window as any).webkitSpeechRecognition;
        if (!SR) {
            setIsSupported(false);
            return;
        }
        setIsSupported(true);

        const r = new SR();
        r.lang = "es-ES";
        r.continuous = true;
        r.interimResults = true;
        r.maxAlternatives = 1;

        r.onstart = () => {
            setIsListening(true);
        };

        r.onresult = (ev: any) => {
            let interim = "";
            let accumulatedFinal = "";

            // Rebuild final text from ALL results (not just from resultIndex)
            // This is more reliable on iOS
            for (let i = 0; i < ev.results.length; i++) {
                const result = ev.results[i];
                if (result.isFinal) {
                    accumulatedFinal += result[0].transcript;
                } else {
                    interim += result[0].transcript;
                }
            }

            // Update refs
            finalTextRef.current = accumulatedFinal;
            lastInterimRef.current = interim;

            // Update visible transcript (final + interim)
            const combined = (accumulatedFinal + " " + interim).trim();
            if (combined) {
                setTranscript(combined);
            }

            // Reset silence timer on every result
            if (wantListeningRef.current) {
                resetSilence();
            }
        };

        r.onerror = (ev: any) => {
            if (ev.error === "not-allowed" || ev.error === "permission-denied") {
                alert(
                    "⚠️ Permiso de micrófono denegado. Habilítalo en la configuración del navegador."
                );
                wantListeningRef.current = false;
                setIsListening(false);
                clearSilence();
                return;
            }
            // "aborted" and "no-speech" are normal on iOS
            if (ev.error === "aborted" || ev.error === "no-speech") {
                // If we still want to listen, restart
                if (wantListeningRef.current && !userStoppedRef.current) {
                    setTimeout(() => {
                        try {
                            r.start();
                        } catch {
                            // ignore
                        }
                    }, 200);
                }
                return;
            }
        };

        r.onend = () => {
            // On iOS Safari, onend fires frequently even in continuous mode.
            // If user didn't manually stop and we still want to listen, restart.
            if (wantListeningRef.current && !userStoppedRef.current) {
                setTimeout(() => {
                    try {
                        r.start();
                    } catch {
                        // If start fails, we're truly done
                        setIsListening(false);
                    }
                }, 200);
            } else {
                setIsListening(false);
            }
        };

        recognitionRef.current = r;

        return () => {
            clearSilence();
            wantListeningRef.current = false;
            try {
                r.stop();
            } catch {
                // ignore
            }
        };
    }, [resetSilence, clearSilence]);

    // ── Public methods ───────────────────────────────────────────
    const toggleListening = useCallback(() => {
        if (!recognitionRef.current) return;

        if (wantListeningRef.current || isListening) {
            // ── STOP: save text first, then stop ──
            doStop(true);
        } else {
            // ── START ──
            // Clear previous data for NEW listening session
            finalTextRef.current = "";
            lastInterimRef.current = "";
            setTranscript("");
            userStoppedRef.current = false;
            wantListeningRef.current = true;

            try {
                recognitionRef.current.start();
                resetSilence(); // start silence timer immediately
            } catch {
                wantListeningRef.current = false;
            }
        }
    }, [isListening, doStop, resetSilence]);

    const stopListening = useCallback(() => {
        doStop(false);
    }, [doStop]);

    return {
        isListening,
        transcript,
        isSupported,
        toggleListening,
        stopListening,
        setTranscript,
    };
}
