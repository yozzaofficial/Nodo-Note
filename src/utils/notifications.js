import { isTauri } from "./transcribe.js";

let permissionGrantedCache = null;

async function ensurePermission() {
  if (!isTauri()) return false;
  if (permissionGrantedCache) return true;

  const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
  let granted = await isPermissionGranted();
  if (!granted) {
    const permission = await requestPermission();
    granted = permission === "granted";
  }
  permissionGrantedCache = granted;
  return granted;
}

/**
 * Generates a random, positive 32-bit integer to use as a stable notification
 * id. Leaves headroom below the 32-bit signed max since each note actually
 * uses 3 consecutive ids (base, base+1, base+2) for its lead-time reminders.
 */
export function newNotificationId() {
  return Math.floor(Math.random() * 2147483000) + 1;
}

// tauri-plugin-notification's `Schedule.at(date)` is broken on iOS: the Rust
// side serializes the date with full nanosecond precision and a "+00:00:00"
// offset, but the iOS Swift code parses it with a strict formatter that only
// accepts millisecond precision and a literal "Z" — so the date fails to
// parse and the whole scheduling call fails silently. `Schedule.interval(...)`
// avoids that broken date-string path, but has its own bug: the Rust struct
// declares `year` as a `u8` (max 255), so a real calendar year like 2026
// can't be sent at all — the command rejects with "invalid value: integer
// 2026, expected u8". We work around this by omitting `year` entirely: the
// trigger then matches on month/day/hour/minute/second alone, which fires
// correctly and just happens to also repeat next year if the note is never
// completed or deleted by then (in practice it always is, since completing
// or deleting a note cancels its reminders).
function dateComponents(date) {
  return {
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  };
}

// Each reminder fires ahead of the detected date/time, at these lead times.
// Ids are derived from the note's base notification id (base, base+1, base+2),
// so they never collide with another note's ids in practice. A 4th slot
// (base+3) is reserved for a fallback notification fired right at the target
// time, used only when the event is too close for any of the lead-time
// reminders above to still be in the future.
const LEAD_TIMES = [
  { ms: 24 * 60 * 60 * 1000, label: "Tra 1 giorno" },
  { ms: 5 * 60 * 60 * 1000, label: "Tra 5 ore" },
  { ms: 30 * 60 * 1000, label: "Tra 30 minuti" },
];
const RESERVED_SLOTS = LEAD_TIMES.length + 1; // + the "at the exact time" fallback slot

export async function scheduleReminders(baseId, title, whenIso) {
  if (!isTauri() || !baseId || !whenIso) return;
  const target = new Date(whenIso);
  if (Number.isNaN(target.getTime())) return;

  const due = LEAD_TIMES.map((lead, i) => ({
    id: baseId + i,
    label: lead.label,
    at: new Date(target.getTime() - lead.ms),
  })).filter((r) => r.at.getTime() > Date.now());

  // The event is too close for any advance reminder to still make sense
  // (e.g. it's happening in the next 30 minutes): fall back to a single
  // notification right at the target time, as long as that's still ahead.
  if (due.length === 0 && target.getTime() > Date.now()) {
    due.push({ id: baseId + LEAD_TIMES.length, label: "Adesso", at: target });
  }

  if (due.length === 0) return;

  try {
    const granted = await ensurePermission();
    if (!granted) return;
    const { sendNotification, Schedule } = await import("@tauri-apps/plugin-notification");
    for (const r of due) {
      sendNotification({
        id: r.id,
        title,
        body: r.label,
        schedule: Schedule.interval(dateComponents(r.at)),
      });
    }
  } catch (err) {
    console.error("Errore programmazione promemoria:", err);
  }
}

export async function cancelReminders(baseId) {
  if (!isTauri() || !baseId) return;
  try {
    const { cancel } = await import("@tauri-apps/plugin-notification");
    await cancel(Array.from({ length: RESERVED_SLOTS }, (_, i) => baseId + i));
  } catch (err) {
    console.error("Errore cancellazione promemoria:", err);
  }
}
