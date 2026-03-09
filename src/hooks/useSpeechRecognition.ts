"use client"; // must be a client-side hook

import { useState, useEffect, useRef, useCallback } from "react";

type UseSpeechRecognitionReturn = {
    isListening: boolean;
    transcript: string;
    isSupported: boolean;
    toggleListening: () => void;
    stopListening: () => void;
    setTranscript: React.Dispatch<React.SetStateAction<string>>;
};

export function useSpeechRecognition(): UseSpeechRecognitionReturn {
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState("");
    const [isSupported, setIsSupported] = useState(false);
    const recognitionRef = useRef<any>(null);
    const finalTranscriptRef = useRef<string>("");

    useEffect(() => {
        if (typeof window === "undefined") return;

        const SpeechRecognition =
            (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

        if (!SpeechRecognition) {
            console.warn("SpeechRecognition API not supported in this browser.");
            setIsSupported(false);
            return;
        }

        setIsSupported(true);

        const recognition = new SpeechRecognition();
        recognition.lang = "es-ES";
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            console.log("🎤 Speech recognition started");
            setIsListening(true);
            finalTranscriptRef.current = "";
        };

        recognition.onresult = (event: any) => {
            let interimTranscript = "";
            let newFinal = "";

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const result = event.results[i];
                if (result.isFinal) {
                    newFinal += result[0].transcript;
                } else {
                    interimTranscript += result[0].transcript;
                }
            }

            if (newFinal) {
                finalTranscriptRef.current += newFinal;
            }

            const fullTranscript = (finalTranscriptRef.current + interimTranscript).trim();
            setTranscript(fullTranscript);
        };

        recognition.onerror = (event: any) => {
            console.error("Speech recognition error:", event.error);
            setIsListening(false);

            if (event.error === "not-allowed" || event.error === "permission-denied") {
                alert(
                    "⚠️ Permiso de micrófono denegado.\nPor favor permite el acceso al micrófono en la barra de direcciones del navegador y recarga la página."
                );
            } else if (event.error === "no-speech") {
                // Silently handle no-speech — user just didn't speak yet
            }
        };

        recognition.onend = () => {
            console.log("🎤 Speech recognition ended");
            setIsListening(false);
        };

        recognitionRef.current = recognition;

        return () => {
            try {
                recognitionRef.current?.stop();
            } catch { }
        };
    }, []);

    const toggleListening = useCallback(() => {
        if (!recognitionRef.current) return;

        if (isListening) {
            recognitionRef.current.stop();
            setIsListening(false);
        } else {
            finalTranscriptRef.current = "";
            setTranscript("");
            try {
                recognitionRef.current.start();
            } catch (e) {
                console.warn("Recognition start error:", e);
                // Re-create if needed
            }
        }
    }, [isListening]);

    const stopListening = useCallback(() => {
        if (isListening && recognitionRef.current) {
            recognitionRef.current.stop();
            setIsListening(false);
        }
    }, [isListening]);

    return { isListening, transcript, isSupported, toggleListening, stopListening, setTranscript };
}
