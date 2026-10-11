import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useAuth } from "../context/AuthContext.jsx";
import { getMyProfile } from "../db.js";
import Icon from "./Icon.jsx";
import "./../css/profileMenu.css";

export default function ProfileMenu({ imgClassName = "" }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    getMyProfile().then((profile) => setUsername(profile?.username ?? null));
  }, [user]);

  return (
    <div className="profile-menu" ref={ref}>
      <button
        className="profile-menu-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-label="Menu profilo"
      >
        <span className={`profile-avatar ${imgClassName}`}>
          <Icon name="person" size={20} />
        </span>
      </button>

      {open && (
        <div className="profile-menu-dropdown">
          {(username || user?.email) && (
            <p className="profile-menu-email">{username ?? user.email}</p>
          )}
          <button
            className="profile-menu-logout"
            onClick={() => {
              setOpen(false);
              supabase.auth.signOut();
            }}
          >
            Esci
          </button>
        </div>
      )}
    </div>
  );
}
