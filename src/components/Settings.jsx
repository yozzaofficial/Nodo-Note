import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useAuth } from "../context/AuthContext.jsx";
import Icon from "./Icon.jsx";
import "./../css/settings.css";

function usePersistedToggle(key, defaultValue) {
  const [value, setValue] = useState(() => {
    const stored = localStorage.getItem(key);
    return stored === null ? defaultValue : stored === "true";
  });
  useEffect(() => {
    localStorage.setItem(key, String(value));
  }, [key, value]);
  return [value, setValue];
}

export default function Settings() {
  const { user } = useAuth();
  const [aiTranscription, setAiTranscription] = usePersistedToggle("nodonote:aiTranscription", true);
  const [autoTaskExtraction, setAutoTaskExtraction] = usePersistedToggle("nodonote:autoTaskExtraction", true);
  const [darkMode, setDarkMode] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("nodonote:darkMode", String(darkMode));
  }, [darkMode]);

  return (
    <main className="page settings-page">
      <section className="settings-intro">
        <h2>Settings</h2>
        <p>Manage your sanctuary for thought and cognitive clarity.</p>
      </section>

      <div className="settings-row settings-account">
        <div className="settings-row-left">
          <div className="settings-row-icon settings-icon-secondary">
            <Icon name="menu" />
          </div>
          <div>
            <h3>Account</h3>
            <p>{user?.email}</p>
          </div>
        </div>
        <button className="settings-logout-btn" type="button" onClick={() => supabase.auth.signOut()}>
          Esci
        </button>
      </div>

      <div className="settings-toggles">
        <ToggleRow
          icon="speech_to_text"
          iconClass="settings-icon-primary"
          title="AI Transcription"
          subtitle="Automatically transcribe voice memos to text"
          checked={aiTranscription}
          onChange={setAiTranscription}
        />
        <ToggleRow
          icon="checklist"
          iconClass="settings-icon-tertiary"
          title="Auto Task Extraction"
          subtitle="Identify action items from your notes"
          checked={autoTaskExtraction}
          onChange={setAutoTaskExtraction}
        />
        <ToggleRow
          icon="dark_mode"
          iconClass="settings-icon-secondary"
          title="Dark Mode"
          subtitle="Switch to a darker visual sanctuary"
          checked={darkMode}
          onChange={setDarkMode}
        />
      </div>

      <section className="settings-pro">
        <span className="settings-pro-badge">Premium</span>
        <h2>Pro Version</h2>
        <p>Unlock unlimited cloud sync, advanced semantic search, and multi-brain collaboration tools.</p>
        <button className="settings-pro-btn" type="button">
          Upgrade Now
          <Icon name="arrow_forward" size={20} />
        </button>
      </section>
    </main>
  );
}

function ToggleRow({ icon, iconClass, title, subtitle, checked, onChange }) {
  return (
    <div className="settings-row">
      <div className="settings-row-left">
        <div className={`settings-row-icon ${iconClass}`}>
          <Icon name={icon} />
        </div>
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>
      <label className="toggle-switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="slider" />
      </label>
    </div>
  );
}
