import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { tuttiGliImpegni, toggleAttivo, eliminaImpegno, salvaImpegno } from "../db.js";
import { deriveTitle, formatDuration, formatRelativeDate } from "../utils/format.js";
import { analyzeImageForTasks, fileToDataUrl } from "../utils/visionOcr.js";
import { unlockSpeech } from "../utils/speech.js";
import Icon from "./Icon.jsx";
import SwipeToComplete from "./SwipeToComplete.jsx";
import "./../css/home.css";

export default function Home() {
  const [impegni, setImpegni] = useState([]);
  const [query, setQuery] = useState("");
  const [photoStatus, setPhotoStatus] = useState("idle"); // idle | processing | error
  const [photoError, setPhotoError] = useState("");
  const navigate = useNavigate();
  const photoInputRef = useRef(null);

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    setImpegni(await tuttiGliImpegni());
  }

  async function handleToggle(id, attivo) {
    // Patch the list in place instead of re-fetching from the network, so the
    // swipe reflects instantly regardless of connection speed.
    const nuovoAttivo = await toggleAttivo(id, attivo);
    if (nuovoAttivo !== undefined) {
      setImpegni((prev) => prev.map((imp) => (imp.id === id ? { ...imp, attivo: nuovoAttivo } : imp)));
    }
  }

  async function handleDelete(id) {
    await eliminaImpegno(id);
    setImpegni((prev) => prev.filter((imp) => imp.id !== id));
  }

  async function handlePhotoSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setPhotoStatus("processing");
    setPhotoError("");
    try {
      const dataUrl = await fileToDataUrl(file);
      const items = await analyzeImageForTasks(dataUrl);

      const ids = [];
      for (const item of items) {
        const id = await salvaImpegno(item.testo, null, null, item.sottotask, item.promemoria_at);
        if (id) ids.push(id);
      }

      setPhotoStatus("idle");
      await refresh();
      if (ids.length === 1) navigate(`/note/${ids[0]}`);
    } catch (err) {
      console.error("Errore analisi foto:", err);
      setPhotoStatus("error");
      setPhotoError("Non sono riuscito a leggere la foto. Riprova.");
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return impegni;
    return impegni.filter((imp) => imp.trascrizione?.toLowerCase().includes(q));
  }, [impegni, query]);

  return (
    <main className="page home-page">
      <section className="home-welcome">
        <h2>Hi, Matteo</h2>
        <p>Capture your thoughts, clear your mind.</p>
      </section>

      <div className="search-bar home-search">
        <Icon name="search" size={20} />
        <input
          type="text"
          placeholder="Search your thoughts..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="empty-state">
          {impegni.length === 0
            ? "Nessuna nota ancora. Premi il microfono per registrarne una."
            : "Nessun risultato."}
        </p>
      ) : (
        <div className="note-list">
          {filtered.map((imp) => (
            <SwipeToComplete
              key={imp.id}
              done={false}
              onComplete={() => handleToggle(imp.id, imp.attivo)}
              onTap={() => navigate(`/note/${imp.id}`)}
              onLongPress={() => handleDelete(imp.id)}
            >
              <div className="card note-card" style={{ opacity: imp.attivo ? 1 : 0.6 }}>
                <div className="note-card-top">
                  <h3>{deriveTitle(imp.trascrizione)}</h3>
                  <span className="note-card-date">{formatRelativeDate(imp.data)}</span>
                </div>
                <p className="note-card-excerpt">{imp.trascrizione}</p>
                <div className="note-card-meta">
                  <Icon name="mic" size={18} className="note-card-mic" />
                  <span>{formatDuration(imp.durata) ?? "—"}</span>
                  {imp.sottotask?.length > 0 && (
                    <span className="note-card-subtasks">
                      <Icon name="checklist" size={16} />
                      {imp.sottotask.filter((s) => s.fatto).length}/{imp.sottotask.length}
                    </span>
                  )}
                </div>
              </div>
            </SwipeToComplete>
          ))}
        </div>
      )}

      <input
        type="file"
        accept="image/*"
        ref={photoInputRef}
        onChange={handlePhotoSelected}
        style={{ display: "none" }}
      />

      <button
        className="fab fab-secondary"
        onClick={() => photoInputRef.current?.click()}
        aria-label="Acquisisci foto"
        disabled={photoStatus === "processing"}
      >
        <Icon name="photo_camera" size={26} />
      </button>
      <button
        className="fab"
        onClick={() => {
          unlockSpeech();
          navigate("/record");
        }}
        aria-label="Nuova registrazione"
      >
        <Icon name="mic" size={30} />
      </button>

      {photoStatus === "processing" && (
        <div className="photo-processing-overlay">
          <div className="photo-processing-card">
            <span className="photo-processing-spinner" />
            <p>Leggo la foto…</p>
          </div>
        </div>
      )}

      {photoStatus === "error" && (
        <div className="photo-processing-overlay" onClick={() => setPhotoStatus("idle")}>
          <div className="photo-processing-card">
            <p>{photoError}</p>
            <button className="primary-button" onClick={() => setPhotoStatus("idle")}>
              OK
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
