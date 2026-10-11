// Minimal in-memory store for the "ask your notes" conversation. Deliberately
// not persisted: it's a lightweight scratch conversation, reset on app reload.
let messages = [];
const listeners = new Set();

function notify() {
  for (const cb of listeners) cb(messages);
}

export function getMessages() {
  return messages;
}

export function addMessage(role, text) {
  messages = [...messages, { role, text, id: crypto.randomUUID() }];
  notify();
}

export function clearMessages() {
  messages = [];
  notify();
}

export function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
