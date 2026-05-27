// src/store/hannahStore.js
import { create } from 'zustand';

export const useHannahStore = create((set, get) => ({
    // Conexión
    sessionId: null,
    connected: false,

    // Estado del avatar
    emotion: 'neutral',        // neutral | happy | curious | alert | thinking
    isSpeaking: false,
    currentVisemes: [],        // [{ viseme: 'aa', weight: 0.8, time: 0 }, ...]
    transcript: '',            // último texto que dijo Hannah
    userTranscript: '',        // lo que dijo el usuario

    // Visión
    visionActive: false,
    lastDetection: null,       // resumen del último análisis YOLO

    // Log de pipeline
    logs: [],

    // Acciones
    setSession: (sessionId) => set({ sessionId }),
    setConnected: (connected) => set({ connected }),
    setEmotion: (emotion) => set({ emotion }),
    setIsSpeaking: (isSpeaking) => set({ isSpeaking }),
    setVisemes: (visemes) => set({ currentVisemes: visemes || [] }),
    setTranscript: (transcript) => set({ transcript }),
    setUserTranscript: (userTranscript) => set({ userTranscript }),
    setVisionActive: (visionActive) => set({ visionActive }),
    setLastDetection: (lastDetection) => set({ lastDetection }),

    addLog: (msg, type = 'info') => set((state) => ({
        logs: [...state.logs.slice(-49), {
            id: Date.now(),
            msg,
            type,
            ts: new Date().toLocaleTimeString(),
        }],
    })),
}));
