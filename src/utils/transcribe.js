import { buildAudioSystemPrompt, nowLabel, parseAudioResponse } from "./impegniPrompt.js";

export function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

export function pickAudioMimeType() {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
  for (const type of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

function extensionForMimeType(mimeType) {
  if (!mimeType) return "webm";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

async function whisperTranscribe(blob, mimeType, prompt) {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;

  const ext = extensionForMimeType(mimeType || blob.type);
  const form = new FormData();
  form.append("file", blob, `recording.${ext}`);
  form.append("model", "gpt-4o-transcribe");
  form.append("prompt", prompt);

  const whisperResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!whisperResp.ok) {
    const err = await whisperResp.text();
    throw new Error(`Errore Whisper ${whisperResp.status}: ${err}`);
  }

  const { text } = await whisperResp.json();
  return text.trim();
}

export async function transcribeBlobRaw(blob, mimeType) {
  return whisperTranscribe(
    blob,
    mimeType,
    "L'utente sta dettando un breve elemento da aggiungere a una lista o a un'agenda."
  );
}

export async function transcribeBlob(blob, mimeType) {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;

  const trascrizione = await whisperTranscribe(
    blob,
    mimeType,
    "L'utente sta registrando un impegno: un appuntamento, un compito o un promemoria da fare."
  );

  const gptResp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: buildAudioSystemPrompt(nowLabel()),
        },
        { role: "user", content: trascrizione },
      ],
      temperature: 0.3,
    }),
  });

  if (!gptResp.ok) {
    const err = await gptResp.text();
    throw new Error(`Errore GPT-4o ${gptResp.status}: ${err}`);
  }

  const gptJson = await gptResp.json();
  const content = gptJson.choices[0].message.content.trim();
  const result = parseAudioResponse(content);

  if (!result.isQuestion && result.impegni.length === 0) {
    throw new Error("Nessun impegno riconosciuto");
  }

  return result;
}
