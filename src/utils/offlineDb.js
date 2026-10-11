const DB_NAME = "nodonote-offline";
const DB_VERSION = 1;
const STORE_IMPEGNI = "impegni";
const STORE_QUEUE = "queue";
const STORE_ALIASES = "aliases";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_IMPEGNI)) {
        db.createObjectStore(STORE_IMPEGNI, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: "queueId", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_ALIASES)) {
        db.createObjectStore(STORE_ALIASES, { keyPath: "tempId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function cacheGetAll() {
  const db = await openDb();
  const store = db.transaction(STORE_IMPEGNI, "readonly").objectStore(STORE_IMPEGNI);
  const all = await promisifyRequest(store.getAll());
  return all.sort((a, b) => new Date(b.data ?? 0) - new Date(a.data ?? 0));
}

export async function cacheGetOne(id) {
  const db = await openDb();
  const store = db.transaction(STORE_IMPEGNI, "readonly").objectStore(STORE_IMPEGNI);
  return (await promisifyRequest(store.get(String(id)))) ?? null;
}

export async function cacheUpsert(record) {
  const db = await openDb();
  const tx = db.transaction(STORE_IMPEGNI, "readwrite");
  tx.objectStore(STORE_IMPEGNI).put({ ...record, id: String(record.id) });
  await txDone(tx);
}

export async function cacheDelete(id) {
  const db = await openDb();
  const tx = db.transaction(STORE_IMPEGNI, "readwrite");
  tx.objectStore(STORE_IMPEGNI).delete(String(id));
  await txDone(tx);
}

// Replace all server-backed rows with a fresh snapshot, keeping any not-yet-synced
// local-only rows (id starting with "local-") so they stay visible while offline.
export async function mergeServerSnapshot(serverRows) {
  const db = await openDb();
  const tx = db.transaction(STORE_IMPEGNI, "readwrite");
  const store = tx.objectStore(STORE_IMPEGNI);
  const existing = await promisifyRequest(store.getAll());
  const pendingLocalOnly = existing.filter((r) => String(r.id).startsWith("local-"));
  await promisifyRequest(store.clear());
  for (const row of serverRows) {
    store.put({ ...row, id: String(row.id) });
  }
  for (const row of pendingLocalOnly) {
    store.put(row);
  }
  await txDone(tx);
}

export async function cacheReplaceTempWithReal(tempId, realRecord) {
  const db = await openDb();
  const tx = db.transaction([STORE_IMPEGNI, STORE_ALIASES], "readwrite");
  const impegniStore = tx.objectStore(STORE_IMPEGNI);
  const existing = await promisifyRequest(impegniStore.get(tempId));
  impegniStore.delete(tempId);
  impegniStore.put({
    ...realRecord,
    id: String(realRecord.id),
    _localAudioBlob: existing?._localAudioBlob ?? null,
  });
  tx.objectStore(STORE_ALIASES).put({ tempId, realId: String(realRecord.id) });
  await txDone(tx);
}

export async function resolveAlias(id) {
  const db = await openDb();
  const store = db.transaction(STORE_ALIASES, "readonly").objectStore(STORE_ALIASES);
  const row = await promisifyRequest(store.get(String(id)));
  return row?.realId ?? null;
}

export async function queueAdd(op) {
  const db = await openDb();
  const tx = db.transaction(STORE_QUEUE, "readwrite");
  const queueId = await promisifyRequest(
    tx.objectStore(STORE_QUEUE).add({ ...op, createdAt: Date.now() })
  );
  await txDone(tx);
  return queueId;
}

export async function queueGetAllOrdered() {
  const db = await openDb();
  const store = db.transaction(STORE_QUEUE, "readonly").objectStore(STORE_QUEUE);
  const all = await promisifyRequest(store.getAll());
  return all.sort((a, b) => a.queueId - b.queueId);
}

export async function queueRemove(queueId) {
  const db = await openDb();
  const tx = db.transaction(STORE_QUEUE, "readwrite");
  tx.objectStore(STORE_QUEUE).delete(queueId);
  await txDone(tx);
}

export async function queueRemoveByTempId(tempId) {
  const db = await openDb();
  const tx = db.transaction(STORE_QUEUE, "readwrite");
  const store = tx.objectStore(STORE_QUEUE);
  const all = await promisifyRequest(store.getAll());
  for (const op of all) {
    if (op.tempId === tempId || op.id === tempId) store.delete(op.queueId);
  }
  await txDone(tx);
}
