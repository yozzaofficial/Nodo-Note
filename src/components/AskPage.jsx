import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { salvaImpegno } from "../db.js";
import { isTauri, pickAudioMimeType, transcribeBlob } from "../utils/transcribe.js";
import { answerQuestion } from "../utils/askNotes.js";
import { getMessages, addMessage, subscribe, clearMessages } from "../state/askConversation.js";
import { speak, stopSpeaking, unlockSpeech } from "../utils/speech.js";
import Icon from "./Icon.jsx";
import "./../css/ask.css";

export default function AskPage() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState(getMessages());
  const [recState, setRecState] = useState("idle"); // idle | recording | processing
  const [errorMsg, setErrorMsg] = useState("");
  const [speakingId, setSpeakingId] = useState(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recordingPathRef = useRef(null);
  const mimeTypeRef = useRef("");
  const activeRef = useRef(false);
  const listRef = useRef(null);
  const lastSpokenIdRef = useRef(null);

  useEffect(() => subscribe(setMessages), []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, recState]);

  // Automatically read the latest assistant reply out loud, once each.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === "assistant" && last.id !== lastSpokenIdRef.current) {
      lastSpokenIdRef.current = last.id;
      playMessage(last);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  useEffect(() => {
    return () => {
      if (activeRef.current) cleanupWithoutSaving();
      stopSpeaking();
      // Each time this screen is left, the conversation is considered closed:
      // the next question starts a fresh chat instead of appending to the old one.
      clearMessages();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function playMessage(message) {
    setSpeakingId(message.id);
    speak(message.text);
    // The Web Speech API has no reliable end-of-utterance promise across
    // platforms here, so just clear the "speaking" highlight after a
    // generous estimate based on text length.
    const estimatedMs = Math.max(1500, message.text.length * 60);
    setTimeout(() => {
      setSpeakingId((id) => (id === message.id ? null : id));
    }, estimatedMs);
  }

  function handleBubbleTap(message) {
    if (message.role !== "assistant") return;
    if (speakingId === message.id) {
      stopSpeaking();
      setSpeakingId(null);
    } else {
      playMessage(message);
    }
  }

  async function cleanupWithoutSaving() {
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("stop_recording");
      } else if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
        if (mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop();
      }
    } catch {
      // best-effort cleanup, ignore
    }
    activeRef.current = false;
  }

  async function handleMicClick() {
    if (recState === "recording") {
      await finishRecording();
    } else if (recState === "idle") {
      unlockSpeech();
      await startRecording();
    }
  }

  async function startRecording() {
    setErrorMsg("");
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        recordingPathRef.current = await invoke("start_recording");
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunksRef.current = [];
        const mimeType = pickAudioMimeType();
        const mr = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        mimeTypeRef.current = mr.mimeType || mimeType;
        mr.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        mr.start();
        mediaRecorderRef.current = mr;
      }
      activeRef.current = true;
      setRecState("recording");
    } catch (err) {
      console.error("Errore avvio registrazione:", err);
      setErrorMsg("Impossibile accedere al microfono.");
    }
  }

  async function finishRecording() {
    setRecState("processing");
    try {
      let result;
      let audioBlob = null;
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("stop_recording");
        const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
        result = await invoke("transcribe_recording", {
          path: recordingPathRef.current,
          apiKey,
          nowIso: new Date().toString(),
        });
      } else {
        const mr = mediaRecorderRef.current;
        result = await new Promise((resolve, reject) => {
          mr.onstop = async () => {
            try {
              audioBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current || "audio/webm" });
              resolve(await transcribeBlob(audioBlob, mimeTypeRef.current));
            } catch (e) {
              reject(e);
            }
          };
          mr.stop();
          mr.stream.getTracks().forEach((t) => t.stop());
        });
      }
      activeRef.current = false;

      if (result.isQuestion) {
        addMessage("user", result.domanda);
        const answer = await answerQuestion(result.domanda);
        addMessage("assistant", answer);
      } else {
        const testi = result.impegni.map((i) => i.testo).join(", ");
        addMessage("user", testi);
        for (const item of result.impegni) {
          await salvaImpegno(item.testo, null, null, item.sottotask, item.promemoria_at);
        }
        addMessage(
          "assistant",
          result.impegni.length === 1
            ? "Fatto, ho salvato una nuova nota."
            : `Fatto, ho salvato ${result.impegni.length} nuove note.`
        );
      }
    } catch (err) {
      console.error("Errore domanda:", err);
      setErrorMsg("Non sono riuscito a capire, riprova.");
    } finally {
      setRecState("idle");
    }
  }

  return (
    <div className="ask-screen">
      <header className="ask-header">
        <button className="icon-button" onClick={() => navigate("/")} aria-label="Indietro">
          <Icon name="arrow_back" />
        </button>
        <h1>Chiedi alle tue note</h1>
      </header>

      <div className="ask-messages" ref={listRef}>
        {messages.length === 0 && (
          <p className="empty-state">Fai una domanda a voce sulle tue note, es. "cosa dovevo comprare?"</p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`ask-bubble ask-bubble-${m.role}${m.role === "assistant" ? " ask-bubble-tappable" : ""}`}
            onClick={() => handleBubbleTap(m)}
          >
            <span>{m.text}</span>
            {m.role === "assistant" && (
              <Icon name={speakingId === m.id ? "volume_up" : "volume_off"} size={16} className="ask-bubble-icon" />
            )}
          </div>
        ))}
        {recState === "processing" && (
          <div className="ask-bubble ask-bubble-assistant ask-bubble-loading">
            <span className="ask-dot" />
            <span className="ask-dot" />
            <span className="ask-dot" />
          </div>
        )}
      </div>

      <footer className="ask-footer">
        {errorMsg && <p className="ask-error">{errorMsg}</p>}
        <button
          className={`ask-mic-btn ask-mic-btn-${recState}`}
          onClick={handleMicClick}
          disabled={recState === "processing"}
          aria-label={recState === "recording" ? "Termina domanda" : "Fai una domanda"}
        >
          <Icon name={recState === "recording" ? "stop" : "mic"} size={28} filled />
        </button>
        <p className="ask-hint">
          {recState === "idle" && "Tocca per parlare"}
          {recState === "recording" && "Ti ascolto… tocca per fermare"}
          {recState === "processing" && "Un momento…"}
        </p>
      </footer>
    </div>
  );
}
