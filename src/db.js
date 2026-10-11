import { supabase } from "./lib/supabaseClient.js";
import {
  cacheGetAll,
  cacheGetOne,
  cacheUpsert,
  cacheDelete,
  mergeServerSnapshot,
  cacheReplaceTempWithReal,
  resolveAlias,
  queueAdd,
  queueGetAllOrdered,
  queueRemove,
  queueRemoveByTempId,
} from "./utils/offlineDb.js";
import { newNotificationId, scheduleReminders, cancelReminders } from "./utils/notifications.js";
import { deriveTitle } from "./utils/format.js";

async function getCurrentUserId() {
  // getSession() reads the persisted session locally and does not require a
  // network round-trip (unlike getUser()), so this keeps working offline.
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

function isOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function extensionForBlob(blob) {
  const type = blob?.type ?? "";
  if (type.includes("mp4") || type.includes("m4a")) return "mp4";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("wav")) return "wav";
  return "webm";
}

async function uploadAudio(userId, audio) {
  if (!audio) return null;
  const path = `${userId}/${crypto.randomUUID()}.${extensionForBlob(audio)}`;
  const { error } = await supabase.storage.from("audio").upload(path, audio, {
    contentType: audio.type || "audio/webm",
  });
  if (error) {
    console.error("Errore upload audio:", error);
    return null;
  }
  return path;
}

// ---------------------------------------------------------------------------
// Sync engine: replays queued operations against Supabase, in order. Safe to
// call anytime (no-ops if offline, already syncing, or queue is empty).
// ---------------------------------------------------------------------------

let syncing = false;

async function applyOpToServer(op) {
  if (op.type === "create") {
    const { trascrizione, durata, audio, sottotask, promemoriaAt, notificationId } = op.payload;
    const userId = await getCurrentUserId();
    if (!userId) throw new Error("Utente non autenticato");
    const audioPath = await uploadAudio(userId, audio);
    const { data, error } = await supabase
      .from("impegni")
      .insert({
        user_id: userId,
        trascrizione,
        attivo: true,
        data: op.payload.createdAtIso ?? new Date().toISOString(),
        durata: durata ?? null,
        audio_path: audioPath,
        sottotask: Array.isArray(sottotask) ? sottotask : [],
        promemoria_at: promemoriaAt ?? null,
        notification_id: notificationId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    await cacheReplaceTempWithReal(op.tempId, data);
  } else if (op.type === "update") {
    const realId = (await resolveAlias(op.id)) ?? op.id;
    const { error } = await supabase
      .from("impegni")
      .update(op.payload)
      .eq("id", Number(realId));
    if (error) throw error;
  } else if (op.type === "delete") {
    const realId = (await resolveAlias(op.id)) ?? op.id;
    if (op.payload?.audio_path) {
      await supabase.storage.from("audio").remove([op.payload.audio_path]);
    }
    const { error } = await supabase.from("impegni").delete().eq("id", Number(realId));
    if (error) throw error;
  }
}

export async function trySync() {
  if (syncing || !isOnline()) return;
  syncing = true;
  try {
    const ops = await queueGetAllOrdered();
    for (const op of ops) {
      try {
        await applyOpToServer(op);
        await queueRemove(op.queueId);
      } catch (err) {
        console.error("Errore sincronizzazione, riprovo più tardi:", err);
        break; // preserve ordering: stop and retry the whole queue next time
      }
    }
  } finally {
    syncing = false;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => trySync());
  setInterval(() => trySync(), 20000);
  trySync();
}

// ---------------------------------------------------------------------------
// Public API (same shape as before) — reads/writes go through the local
// cache first, then sync to Supabase opportunistically when online.
// ---------------------------------------------------------------------------

export async function salvaImpegno(trascrizione, durata, audio, sottotask, promemoriaAt) {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const tempId = `local-${crypto.randomUUID()}`;
  const nowIso = new Date().toISOString();
  // Build the subtask objects once (with a stable id each) and reuse the same
  // array for the local cache and the queued sync payload, so the ids never
  // change once assigned (keeps React list keys stable across a sync).
  const sottotaskObjs = Array.isArray(sottotask)
    ? sottotask.filter(Boolean).map((testo) => ({ id: crypto.randomUUID(), testo, fatto: false }))
    : [];

  // The AI returns a naive local datetime string (no timezone offset), which
  // the JS Date parser interprets as local time — exactly what we want both
  // for scheduling the on-device notification and for storing an accurate
  // UTC instant in the timestamptz column.
  let promemoriaAtIso = null;
  if (promemoriaAt) {
    const parsed = new Date(promemoriaAt);
    if (!Number.isNaN(parsed.getTime())) promemoriaAtIso = parsed.toISOString();
  }
  const notificationId = promemoriaAtIso ? newNotificationId() : null;

  const record = {
    id: tempId,
    user_id: userId,
    trascrizione,
    attivo: true,
    data: nowIso,
    durata: durata ?? null,
    audio_path: null,
    sottotask: sottotaskObjs,
    promemoria_at: promemoriaAtIso,
    notification_id: notificationId,
    _localAudioBlob: audio ?? null,
  };

  await cacheUpsert(record);
  await queueAdd({
    type: "create",
    tempId,
    payload: {
      trascrizione,
      durata,
      audio,
      sottotask: sottotaskObjs,
      createdAtIso: nowIso,
      promemoriaAt: promemoriaAtIso,
      notificationId,
    },
  });
  trySync();

  if (promemoriaAtIso) {
    scheduleReminders(notificationId, deriveTitle(trascrizione), promemoriaAtIso);
  }

  return tempId;
}

export async function tuttiGliImpegni() {
  if (isOnline()) {
    try {
      await trySync();
      const { data, error } = await supabase
        .from("impegni")
        .select("*")
        .order("id", { ascending: false });
      if (!error) await mergeServerSnapshot(data);
    } catch (err) {
      console.error("Errore lettura impegni, uso la cache locale:", err);
    }
  }
  return cacheGetAll();
}

export async function getImpegno(id) {
  const idStr = String(id);
  const realId = (await resolveAlias(idStr)) ?? idStr;

  if (isOnline() && !realId.startsWith("local-")) {
    try {
      await trySync();
      const { data, error } = await supabase
        .from("impegni")
        .select("*")
        .eq("id", Number(realId))
        .maybeSingle();
      if (!error && data) {
        await cacheUpsert(data);
        return data;
      }
    } catch (err) {
      console.error("Errore lettura impegno, uso la cache locale:", err);
    }
  }
  return cacheGetOne(realId);
}

export async function toggleAttivo(id, attivo) {
  const idStr = String(id);
  const cached = await cacheGetOne(idStr);
  if (!cached) return;
  const nuovoAttivo = !attivo;
  await cacheUpsert({ ...cached, attivo: nuovoAttivo });

  if (cached.notification_id) {
    if (!nuovoAttivo) {
      // Marked as completed: no point reminding about something already done.
      cancelReminders(cached.notification_id);
    } else if (cached.promemoria_at && new Date(cached.promemoria_at).getTime() > Date.now()) {
      // Reopened before the reminder time: schedule the reminders again.
      scheduleReminders(cached.notification_id, deriveTitle(cached.trascrizione), cached.promemoria_at);
    }
  }

  if (idStr.startsWith("local-")) return nuovoAttivo; // will be created with attivo:true, nothing else to queue yet
  await queueAdd({ type: "update", id: idStr, payload: { attivo: nuovoAttivo } });
  trySync();
  return nuovoAttivo;
}

export async function toggleSottotask(id, index) {
  const idStr = String(id);
  const cached = await cacheGetOne(idStr);
  if (!cached?.sottotask?.[index]) return;
  const sottotask = cached.sottotask.map((st, i) => (i === index ? { ...st, fatto: !st.fatto } : st));
  await cacheUpsert({ ...cached, sottotask });
  await queueAdd({ type: "update", id: idStr, payload: { sottotask } });
  trySync();
  return sottotask;
}

export async function aggiungiSottotask(id, testo) {
  if (!testo) return;
  const idStr = String(id);
  const cached = await cacheGetOne(idStr);
  if (!cached) return;
  const sottotask = [...(cached.sottotask ?? []), { id: crypto.randomUUID(), testo, fatto: false }];
  await cacheUpsert({ ...cached, sottotask });
  await queueAdd({ type: "update", id: idStr, payload: { sottotask } });
  trySync();
  return sottotask;
}

export async function eliminaSottotask(id, index) {
  const idStr = String(id);
  const cached = await cacheGetOne(idStr);
  if (!cached?.sottotask?.[index]) return;
  const sottotask = cached.sottotask.filter((_, i) => i !== index);
  await cacheUpsert({ ...cached, sottotask });
  await queueAdd({ type: "update", id: idStr, payload: { sottotask } });
  trySync();
  return sottotask;
}

export async function eliminaImpegno(id) {
  const idStr = String(id);
  const cached = await cacheGetOne(idStr);
  if (cached?.notification_id) cancelReminders(cached.notification_id);
  await cacheDelete(idStr);

  if (idStr.startsWith("local-")) {
    await queueRemoveByTempId(idStr);
    return;
  }
  await queueAdd({ type: "delete", id: idStr, payload: { audio_path: cached?.audio_path ?? null } });
  trySync();
}

export async function getMyProfile() {
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("username, phone, licenza")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("Errore lettura profilo:", error);
    return null;
  }
  return data;
}
