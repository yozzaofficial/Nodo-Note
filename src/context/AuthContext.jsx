import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";

const AuthContext = createContext(null);

// Supabase persists the session under a "sb-...-auth-token" localStorage key.
// We use its mere presence (not its contents) as a hint that this device was
// previously logged in, so the app can render immediately offline instead of
// waiting on a network call that may never resolve without a connection.
function hasPersistedSession() {
  try {
    return Object.keys(localStorage).some((k) => k.startsWith("sb-") && k.includes("-auth-token"));
  } catch {
    return false;
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => (hasPersistedSession() ? { __pending: true } : null));
  const [loading, setLoading] = useState(() => !hasPersistedSession());

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session ?? null);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });

    // Safety net: never leave the app stuck on a blank loading screen if the
    // network call above hangs (e.g. no connection).
    const timeout = setTimeout(() => setLoading(false), 3000);

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      clearTimeout(timeout);
      subscription.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
