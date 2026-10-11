import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getImpegno,
  toggleAttivo,
  toggleSottotask,
  aggiungiSottotask,
  eliminaSottotask,
  eliminaImpegno,
} from "../db.js";
import { supabase } from "../lib/supabaseClient.js";
import { deriveTitle, formatDuration, formatFullDate, formatTime } from "../utils/format.js";
import { isTauri, pickAudioMimeType, transcribeBlobRaw } from "../utils/transcribe.js";
import Icon from "./Icon.jsx";
import SwipeToComplete from "./SwipeToComplete.jsx";
import ProfileMenu from "./ProfileMenu.jsx";
import "./../css/noteDetail.css";

export default function NoteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [imp, setImp] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [subtaskRecState, setSubtaskRecState] = useState("idle"); // idle | recording | processing

  const subtaskRecorderRef = useRef(null);
  const subtaskChunksRef = useRef([]);
  const subtaskMimeRef = useRef("");
  const subtaskPathRef = useRef(null);
  const subtaskActiveRef = useRef(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    if (imp?.audio_path) {
      supabase.storage
        .from("audio")
        .createSignedUrl(imp.audio_path, 3600)
        .then(({ data, error }) => {
          if (cancelled) return;
          if (error) {
            console.error("Errore lettura audio:", error);
            setAudioUrl(null);
          } else {
            setAudioUrl(data.signedUrl);
          }
        });
    } else if (imp?._localAudioBlob) {
      // Nota non ancora sincronizzata: riproduci l'audio dalla cache locale.
      objectUrl = URL.createObjectURL(imp._localAudioBlob);
      setAudioUrl(objectUrl);
    } else {
      setAudioUrl(null);
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imp?.id, imp?.audio_path, imp?._localAudioBlob]);

  useEffect(() => {
    return () => {
      if (subtaskActiveRef.current) cleanupSubtaskRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    const item = await getImpegno(id);
    if (!item) setNotFound(true);
    else setImp(item);
  }

  async function handleToggle() {
    // Update the screen immediately; the write already happened in the local
    // cache synchronously, no need to wait for a network round-trip to show it.
    const nuovoAttivo = await toggleAttivo(imp.id, imp.attivo);
    if (nuovoAttivo !== undefined) setImp((prev) => (prev ? { ...prev, attivo: nuovoAttivo } : prev));
  }

  async function handleToggleSottotask(index) {
    const sottotask = await toggleSottotask(imp.id, index);
    if (sottotask) setImp((prev) => (prev ? { ...prev, sottotask } : prev));
  }

  async function handleDeleteSottotask(index) {
    const sottotask = await eliminaSottotask(imp.id, index);
    if (sottotask) setImp((prev) => (prev ? { ...prev, sottotask } : prev));
  }

  async function handleDelete() {
    await eliminaImpegno(imp.id);
    navigate("/", { replace: true });
  }

  async function cleanupSubtaskRecording() {
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("stop_recording");
      } else if (subtaskRecorderRef.current) {
        subtaskRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
        if (subtaskRecorderRef.current.state !== "inactive") subtaskRecorderRef.current.stop();
      }
    } catch {
      // best-effort cleanup, ignore
    }
    subtaskActiveRef.current = false;
  }

  async function handleAddSubtaskClick() {
    if (subtaskRecState === "recording") {
      await finishAddSubtask();
    } else if (subtaskRecState === "idle") {
      await startAddSubtask();
    }
  }

  async function startAddSubtask() {
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        subtaskPathRef.current = await invoke("start_recording");
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = pickAudioMimeType();
        const mr = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        subtaskChunksRef.current = [];
        subtaskMimeRef.current = mr.mimeType || mimeType;
        mr.ondataavailable = (e) => {
          if (e.data.size > 0) subtaskChunksRef.current.push(e.data);
        };
        mr.start();
        subtaskRecorderRef.current = mr;
      }
      subtaskActiveRef.current = true;
      setSubtaskRecState("recording");
    } catch (err) {
      console.error("Errore avvio registrazione sottotask:", err);
      subtaskActiveRef.current = false;
      setSubtaskRecState("idle");
    }
  }

  async function finishAddSubtask() {
    setSubtaskRecState("processing");
    try {
      let testo;
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("stop_recording");
        const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
        testo = await invoke("transcribe_raw", { path: subtaskPathRef.current, apiKey });
      } else {
        const mr = subtaskRecorderRef.current;
        testo = await new Promise((resolve, reject) => {
          mr.onstop = async () => {
            try {
              const blob = new Blob(subtaskChunksRef.current, {
                type: subtaskMimeRef.current || "audio/webm",
              });
              resolve(await transcribeBlobRaw(blob, subtaskMimeRef.current));
            } catch (e) {
              reject(e);
            }
          };
          mr.stop();
          mr.stream.getTracks().forEach((t) => t.stop());
        });
      }

      if (testo?.trim()) {
        const sottotask = await aggiungiSottotask(imp.id, testo.trim());
        if (sottotask) setImp((prev) => (prev ? { ...prev, sottotask } : prev));
      }
    } catch (err) {
      console.error("Errore aggiunta sottotask:", err);
    } finally {
      subtaskActiveRef.current = false;
      setSubtaskRecState("idle");
    }
  }

  if (notFound) {
    return (
      <main className="page note-detail-page">
        <p className="empty-state">Nota non trovata.</p>
      </main>
    );
  }

  if (!imp) return null;

  return (
    <div className="note-detail-screen">
      <header className="note-detail-header">
        <div className="note-detail-header-left">
          <button className="icon-button" onClick={() => navigate(-1)} aria-label="Indietro">
            <Icon name="arrow_back" />
          </button>
          <h1>NodoNote</h1>
        </div>
        <div className="note-detail-header-right">
          <button className="icon-button" onClick={handleDelete} aria-label="Elimina">
            <Icon name="close" />
          </button>
          <ProfileMenu imgClassName="note-detail-avatar" />
        </div>
      </header>

      <main className="page note-detail-page">
        <div className="note-detail-meta">
          <span>
            <Icon name="calendar_today" size={16} />
            {formatFullDate(imp.data)}
          </span>
          <span>
            <Icon name="schedule" size={16} />
            {formatTime(imp.data)}
          </span>
          {imp.durata != null && (
            <span>
              <Icon name="timer" size={16} />
              {formatDuration(imp.durata)}
            </span>
          )}
        </div>

        <h2 className="note-detail-title">{deriveTitle(imp.trascrizione, 80)}</h2>

        {imp.promemoria_at && (
          <div className="note-detail-reminder">
            <Icon name="notifications_active" size={16} />
            <span>
              Promemoria {formatFullDate(imp.promemoria_at)} alle {formatTime(imp.promemoria_at)}
            </span>
          </div>
        )}

        {audioUrl && (
          <section className="note-detail-section">
            <h3 className="section-title note-detail-section-title">Registrazione</h3>
            <audio className="note-detail-audio" src={audioUrl} controls />
          </section>
        )}

        <section className="note-detail-section">
          <h3 className="section-title note-detail-section-title">Full Transcription</h3>
          <div className="card note-detail-transcription">
            <p>{imp.trascrizione}</p>
          </div>
        </section>

        <section className="note-detail-section">
          <h3 className="section-title note-detail-section-title">Sottotask</h3>

          <div className="note-detail-subtasks">
            {imp.sottotask?.map((st, i) => (
              <SwipeToComplete
                key={st.id ?? i}
                done={st.fatto}
                onComplete={() => handleToggleSottotask(i)}
                onTap={() => handleToggleSottotask(i)}
                onLongPress={() => handleDeleteSottotask(i)}
              >
                <div className={`task-toggle-row${st.fatto ? " task-toggle-row-done" : ""}`}>
                  <button
                    className={`checkbox-circle${st.fatto ? " checked" : ""}`}
                    aria-label="Segna come completata"
                  >
                    {st.fatto && <Icon name="check" size={16} />}
                  </button>
                  <label className={`task-toggle-label${st.fatto ? " task-toggle-label-done" : ""}`}>
                    {st.testo}
                  </label>
                </div>
              </SwipeToComplete>
            ))}

            <div
              className={`subtask-add-row subtask-add-row-${subtaskRecState}`}
              onClick={handleAddSubtaskClick}
            >
              <span className="subtask-add-icon">
                <Icon name={subtaskRecState === "idle" ? "add" : "mic"} size={20} filled={subtaskRecState !== "idle"} />
              </span>
              <span>
                {subtaskRecState === "idle" && "Aggiungi sottotask"}
                {subtaskRecState === "recording" && "Sto ascoltando… tocca per fermare"}
                {subtaskRecState === "processing" && "Trascrizione…"}
              </span>
            </div>
          </div>
        </section>
      </main>

      <div className="note-detail-action">
        <button className="primary-button" onClick={handleToggle}>
          <Icon name={imp.attivo ? "notifications_active" : "check"} />
          {imp.attivo ? "Mark as Completed" : "Reopen Task"}
        </button>
      </div>
    </div>
  );
}
