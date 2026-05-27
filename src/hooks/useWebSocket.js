// src/hooks/useWebSocket.js
import { useEffect, useRef, useCallback } from 'react';
import { useHannahStore } from '../store/hannahStore.js';

const API_BASE = '';

// Mapa de visemas del backend a morph targets de Ready Player Me / modelos estándar
export const VISEME_MAP = {
    'sil': 'viseme_sil',
    'PP':  'viseme_PP',
    'FF':  'viseme_FF',
    'TH':  'viseme_TH',
    'DD':  'viseme_DD',
    'kk':  'viseme_kk',
    'CH':  'viseme_CH',
    'SS':  'viseme_SS',
    'nn':  'viseme_nn',
    'RR':  'viseme_RR',
    'aa':  'viseme_aa',
    'E':   'viseme_E',
    'I':   'viseme_I',
    'O':   'viseme_O',
    'U':   'viseme_U',
};

export function useWebSocket() {
    const ws = useRef(null);
    const audioCtx = useRef(null);
    const audioQueue = useRef([]);
    const isPlaying = useRef(false);
    const visemeSchedule = useRef([]);  // visemas pendientes de reproducir
    const visemeTimer = useRef(null);

    const store = useHannahStore.getState();
    const {
        setSession, setConnected, setEmotion, setIsSpeaking,
        setVisemes, setTranscript, setUserTranscript,
        setLastDetection, addLog,
    } = useHannahStore.getState();

    // ── Audio: cola de chunks con AudioContext ──────────────────────────────
    const getAudioCtx = () => {
        if (!audioCtx.current || audioCtx.current.state === 'closed') {
            audioCtx.current = new AudioContext();
        }
        if (audioCtx.current.state === 'suspended') {
            audioCtx.current.resume();
        }
        return audioCtx.current;
    };

    const drainQueue = useCallback(() => {
        if (audioQueue.current.length === 0) {
            isPlaying.current = false;
            useHannahStore.getState().setIsSpeaking(false);
            return;
        }
        isPlaying.current = true;
        useHannahStore.getState().setIsSpeaking(true);

        const { buffer } = audioQueue.current.shift();
        const ctx = getAudioCtx();
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = drainQueue;
        source.start();
    }, []);

    const playChunk = useCallback(async (base64wav, visemes) => {
        const ctx = getAudioCtx();
        const binary = atob(base64wav);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        try {
            const decoded = await ctx.decodeAudioData(bytes.buffer);
            audioQueue.current.push({ buffer: decoded, visemes: visemes || [] });
            scheduleVisemes(visemes, ctx.currentTime);
            if (!isPlaying.current) drainQueue();
        } catch (e) {
            console.warn('Chunk de audio inválido, ignorando:', e.message);
        }
    }, [drainQueue]);

    // ── Visemas: programar morph targets según timing del audio ────────────
    const scheduleVisemes = (visemes, startTime) => {
        if (!visemes?.length) return;

        visemes.forEach(({ viseme, time, weight }) => {
            const delayMs = (startTime * 1000) + (time || 0);
            const id = setTimeout(() => {
                useHannahStore.getState().setVisemes([{ viseme, weight: weight ?? 1.0 }]);
                // Reset a silencio después de 120ms
                setTimeout(() => {
                    useHannahStore.getState().setVisemes([{ viseme: 'sil', weight: 0 }]);
                }, 120);
            }, delayMs);
            visemeSchedule.current.push(id);
        });
    };

    const clearVisemeSchedule = () => {
        visemeSchedule.current.forEach(clearTimeout);
        visemeSchedule.current = [];
        useHannahStore.getState().setVisemes([]);
    };

    // ── Handlers de mensajes del servidor ──────────────────────────────────
    const handleMessage = useCallback((msg) => {
        switch (msg.type) {
            case 'user_transcript':
                setUserTranscript(msg.text || '');
                addLog(`[usuario] ${msg.text}`, 'user');
                break;

            case 'audio_chunk':
                if (msg.text) setTranscript(msg.text);
                if (msg.audio) playChunk(msg.audio, msg.visemes);
                else if (msg.audioBase64) playChunk(msg.audioBase64, msg.visemes);
                break;

            case 'turn_complete':
                if (msg.emotion) setEmotion(msg.emotion);
                addLog(`[turno] emoción: ${msg.emotion} | ${msg.metrics?.total_ms}ms`, 'info');
                break;

            case 'vision_started':
                addLog('[visión] loop activo', 'vision');
                break;

            case 'error':
                addLog(`[error] ${msg.message}`, 'error');
                break;

            default:
                addLog(JSON.stringify(msg), 'debug');
        }
    }, [playChunk, setTranscript, setEmotion, setUserTranscript, addLog]);

    // ── Iniciar sesión y WS ─────────────────────────────────────────────────
    const connect = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/v1/session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            });
            const { sessionId } = await res.json();
            setSession(sessionId);
            addLog(`sesión: ${sessionId}`, 'info');

	    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	    const wsUrl = `${protocol}//${window.location.host}/ws?sessionId=${sessionId}`;
            ws.current = new WebSocket(wsUrl);

            ws.current.onopen = () => {
                setConnected(true);
                addLog('WebSocket conectado', 'info');
            };

            ws.current.onclose = () => {
                setConnected(false);
                addLog('WebSocket desconectado', 'error');
            };

            ws.current.onerror = () => addLog('WebSocket error', 'error');

            ws.current.onmessage = (event) => {
                try {
                    handleMessage(JSON.parse(event.data));
                } catch (e) {
                    console.error('WS parse error:', e);
                }
            };
        } catch (e) {
            addLog(`Error conectando: ${e.message}`, 'error');
        }
    }, [handleMessage, setSession, setConnected, addLog]);

    // ── API pública ─────────────────────────────────────────────────────────
    const sendCommand = useCallback((payload) => {
        if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify(payload));
        }
    }, []);

    const sendAudio = useCallback((buffer) => {
        if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send(buffer);
        }
    }, []);

    const sendText = useCallback(async (text) => {
        const { sessionId } = useHannahStore.getState();
        if (!sessionId) return;
        addLog(`[texto] ${text}`, 'out');
        const res = await fetch(`${API_BASE}/api/v1/text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, text }),
        });
        const data = await res.json();
        if (data.emotion) setEmotion(data.emotion);
        if (data.audioBase64) playChunk(data.audioBase64, data.visemes);
    }, [playChunk, setEmotion, addLog]);

    useEffect(() => {
        connect();
        return () => {
            clearVisemeSchedule();
            ws.current?.close();
            audioCtx.current?.close();
        };
    }, []);

    return { sendCommand, sendAudio, sendText, ws };
}
