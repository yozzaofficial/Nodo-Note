import { useRef, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { useAuth } from "../context/AuthContext.jsx";
import "./../css/auth.css";

function friendlyError(message) {
  const m = message?.toLowerCase() ?? "";
  if (m.includes("profiles_username_key") || m.includes("username")) {
    return "Questo username è già in uso, scegline un altro.";
  }
  if (m.includes("profiles_phone_key") || m.includes("phone")) {
    return "Questo numero di telefono è già registrato.";
  }
  if (m.includes("already registered") || m.includes("already exists")) {
    return "Esiste già un account con questa email.";
  }
  if (
    m.includes("failed to fetch") ||
    m.includes("load failed") ||
    m.includes("network") ||
    m.includes("timeout") ||
    m.includes("timed out")
  ) {
    return "Errore di connessione, riprova.";
  }
  return message || "Errore, riprova.";
}

export default function AuthPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login"); // login | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  if (!loading && session) return <Navigate to="/" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    // Guard synchronously against a fast double-tap firing two overlapping
    // submissions before React has re-rendered the disabled button state.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError("");
    setInfo("");
    setSubmitting(true);
    try {
      if (mode === "login") {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        navigate("/", { replace: true });
      } else {
        const { error: err } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              username: username.trim(),
              phone: phone.trim(),
            },
          },
        });
        if (err) throw err;
        setInfo("Controlla la tua email per confermare la registrazione, poi accedi.");
        setMode("login");
      }
    } catch (err) {
      setError(friendlyError(err.message));
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>NodoNote</h1>
        <p className="auth-subtitle">
          {mode === "login" ? "Accedi al tuo spazio" : "Crea un nuovo account"}
        </p>

        {error && <p className="auth-error">{error}</p>}
        {info && <p className="auth-info">{info}</p>}

        <form onSubmit={handleSubmit} className="auth-form">
          {mode === "signup" && (
            <>
              <input
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="none"
                minLength={3}
                required
              />
              <input
                type="tel"
                placeholder="Numero di telefono"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </>
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? "Attendere…" : mode === "login" ? "Accedi" : "Registrati"}
          </button>
        </form>

        <button
          className="auth-switch"
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError("");
            setInfo("");
          }}
        >
          {mode === "login" ? "Non hai un account? Registrati" : "Hai già un account? Accedi"}
        </button>
      </div>
    </div>
  );
}
