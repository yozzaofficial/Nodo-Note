import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { salvaImpegno } from "../db.js";
import { isTauri, pickAudioMimeType, transcribeBlob } from "../utils/transcribe.js";
import { formatDuration } from "../utils/format.js";
import { answerQuestion } from "../utils/askNotes.js";
import { addMessage } from "../state/askConversation.js";
import ShaderBackground from "./ShaderBackground.jsx";
import Icon from "./Icon.jsx";
import "./../css/recording.css";

export default function RecordingPage() {
  const navigate = useNavigate();
  const [seconds, setSeconds] = useState(0);
  const [phase, setPhase] = useState("recording"); // recording | finishing | error
  const [paused, setPaused] = useState(false); // visual only: no pause command in backend
  const [errorMsg, setErrorMsg] = useState("");

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recordingPathRef = useRef(null);
  const mimeTypeRef = useRef("");
  const intervalRef = useRef(null);
  const handledRef = useRef(false);

  useEffect(() => {
    startRec();
    intervalRef.current = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);

    return () => {
      clearInterval(intervalRef.current);
      if (!handledRef.current) {
        handledRef.current = true;
        cleanupWithoutSaving();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startRec() {
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
    } catch (err) {
      console.error("Errore avvio registrazione:", err);
      clearInterval(intervalRef.current);
      setPhase("error");
      setErrorMsg("Impossibile accedere al microfono.");
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
  }

  async function handleClose() {
    handledRef.current = true;
    clearInterval(intervalRef.current);
    await cleanupWithoutSaving();
    navigate(-1);
  }

  async function handleRetry() {
    setErrorMsg("");
    setSeconds(0);
    handledRef.current = false;
    setPhase("recording");
    await startRec();
    intervalRef.current = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
  }

  async function handleFinish() {
    if (phase !== "recording") return;
    handledRef.current = true;
    clearInterval(intervalRef.current);
    setPhase("finishing");
    const durata = seconds;

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

      if (result.isQuestion) {
        addMessage("user", result.domanda);
        const answer = await answerQuestion(result.domanda);
        addMessage("assistant", answer);
        navigate("/ask", { replace: true });
        return;
      }

      const ids = [];
      for (const item of result.impegni) {
        ids.push(await salvaImpegno(item.testo, durata, audioBlob, item.sottotask, item.promemoria_at));
      }

      navigate(ids.length === 1 ? `/note/${ids[0]}` : "/", { replace: true });
    } catch (err) {
      console.error("Errore trascrizione:", err);
      setPhase("error");
      setErrorMsg("Errore durante la trascrizione. Riprova.");
    }
  }

  return (
    <div className="recording-screen">
      <header className="recording-header">
        <div className="recording-header-left">
          <span className="recording-dot" />
          <h1>{phase === "finishing" ? "Trascrizione..." : "Recording..."}</h1>
        </div>
        <button className="recording-close" onClick={handleClose} aria-label="Chiudi">
          <Icon name="close" />
        </button>
      </header>

      <main className="recording-main">
        <div className="recording-shader">
          <ShaderBackground />
        </div>

        <div className="recording-timer">
          <span>{formatDuration(seconds)}</span>
          <p>{phase === "error" ? `${errorMsg} Tocca per riprovare.` : "Listening for clarity"}</p>
        </div>

        <div className="recording-button-wrap">
          <div className="recording-pulse-ring" />
          <button
            className={`recording-main-btn${phase === "error" ? " recording-main-btn-error" : ""}`}
            onClick={phase === "error" ? handleRetry : handleFinish}
            disabled={phase === "finishing"}
            aria-label={phase === "error" ? "Riprova registrazione" : "Termina registrazione"}
          >
            <Icon name={phase === "error" ? "mic_off" : "mic"} size={56} filled />
          </button>
        </div>
      </main>

      <footer className="recording-footer">
        <button
          className="recording-secondary-btn"
          onClick={() => setPaused((p) => !p)}
          disabled={phase !== "recording"}
        >
          <span className="recording-secondary-icon">
            <Icon name={paused ? "mic" : "pause"} size={26} />
          </span>
          <span>{paused ? "Resume" : "Pause"}</span>
        </button>
        <button
          className="recording-secondary-btn"
          onClick={phase === "error" ? handleRetry : handleFinish}
          disabled={phase === "finishing"}
        >
          <span className="recording-secondary-icon recording-secondary-icon-error">
            <Icon name={phase === "error" ? "mic" : "stop"} size={26} filled />
          </span>
          <span>{phase === "error" ? "Riprova" : "Stop"}</span>
        </button>
      </footer>
    </div>
  );
}
