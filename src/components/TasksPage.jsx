import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { tuttiGliImpegni, toggleAttivo, eliminaImpegno } from "../db.js";
import { deriveTitle, formatFullDate, formatTime, isToday } from "../utils/format.js";
import Icon from "./Icon.jsx";
import SwipeToComplete from "./SwipeToComplete.jsx";
import "./../css/tasks.css";

export default function TasksPage() {
  const [impegni, setImpegni] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    setImpegni(await tuttiGliImpegni());
  }

  async function handleDelete(id) {
    await eliminaImpegno(id);
    setImpegni((prev) => prev.filter((imp) => imp.id !== id));
  }

  const groups = useMemo(() => {
    const today = [];
    const upcoming = [];
    const completed = [];
    for (const imp of impegni) {
      if (!imp.attivo) completed.push(imp);
      else if (isToday(imp.data)) today.push(imp);
      else upcoming.push(imp);
    }
    return { today, upcoming, completed };
  }, [impegni]);

  async function handleToggle(id, attivo) {
    // Patch the list in place instead of re-fetching from the network, so the
    // swipe/checkbox reflects instantly regardless of connection speed.
    const nuovoAttivo = await toggleAttivo(id, attivo);
    if (nuovoAttivo !== undefined) {
      setImpegni((prev) => prev.map((imp) => (imp.id === id ? { ...imp, attivo: nuovoAttivo } : imp)));
    }
  }

  if (impegni.length === 0) {
    return (
      <main className="page tasks-page">
        <h2 className="tasks-title">My Brain Tasks</h2>
        <p className="empty-state">Nessun task ancora. Registra una nota per crearne uno.</p>
      </main>
    );
  }

  return (
    <main className="page tasks-page">
      <h2 className="tasks-title">My Brain Tasks</h2>

      {groups.today.length > 0 && (
        <section className="tasks-section">
          <div className="tasks-section-header">
            <h3 className="section-title">Today</h3>
            <span className="tasks-count">{groups.today.length} task{groups.today.length > 1 ? "s" : ""} left</span>
          </div>
          <TaskList
            items={groups.today}
            onToggle={handleToggle}
            onOpen={(id) => navigate(`/note/${id}`)}
            onDelete={handleDelete}
          />
        </section>
      )}

      {groups.upcoming.length > 0 && (
        <section className="tasks-section">
          <h3 className="section-title">Upcoming</h3>
          <TaskList
            items={groups.upcoming}
            onToggle={handleToggle}
            onOpen={(id) => navigate(`/note/${id}`)}
            onDelete={handleDelete}
            dim
          />
        </section>
      )}

      {groups.completed.length > 0 && (
        <section className="tasks-section">
          <h3 className="section-title">Completed</h3>
          <div className="tasks-list">
            {groups.completed.map((imp) => (
              <SwipeToComplete
                key={imp.id}
                done={false}
                onComplete={() => handleToggle(imp.id, imp.attivo)}
                onTap={() => navigate(`/note/${imp.id}`)}
                onLongPress={() => handleDelete(imp.id)}
              >
                <div className="task-row task-row-done">
                  <button
                    className="checkbox-circle checked"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggle(imp.id, imp.attivo);
                    }}
                    aria-label="Segna come attiva"
                  >
                    <Icon name="check" size={16} />
                  </button>
                  <div className="task-row-body">
                    <p className="task-row-title task-row-title-done">{deriveTitle(imp.trascrizione)}</p>
                    <p className="task-row-sub">Done at {formatTime(imp.data)}</p>
                  </div>
                </div>
              </SwipeToComplete>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function TaskList({ items, onToggle, onOpen, onDelete, dim }) {
  return (
    <div className="tasks-list">
      {items.map((imp) => {
        return (
          <SwipeToComplete
            key={imp.id}
            done={false}
            onComplete={() => onToggle(imp.id, imp.attivo)}
            onTap={() => onOpen(imp.id)}
            onLongPress={() => onDelete(imp.id)}
          >
            <div className={`card task-row${dim ? " task-row-dim" : ""}`}>
              <button
                className="checkbox-circle"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(imp.id, imp.attivo);
                }}
                aria-label="Segna come completata"
              />
              <div className="task-row-body">
                <p className="task-row-title">{deriveTitle(imp.trascrizione)}</p>
                <p className="task-row-sub">
                  {formatFullDate(imp.data)} • {formatTime(imp.data)}
                  {imp.sottotask?.length > 0 &&
                    ` • ${imp.sottotask.filter((s) => s.fatto).length}/${imp.sottotask.length} sottotask`}
                </p>
              </div>
            </div>
          </SwipeToComplete>
        );
      })}
    </div>
  );
}
