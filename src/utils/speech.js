let cachedItalianVoice = null;
let voicesReadyPromise = null;

function loadVoices() {
  if (voicesReadyPromise) return voicesReadyPromise;
  voicesReadyPromise = new Promise((resolve) => {
    const existing = window.speechSynthesis.getVoices();
    if (existing.length > 0) {
      resolve(existing);
      return;
    }
    window.speechSynthesis.onvoiceschanged = () => {
      resolve(window.speechSynthesis.getVoices());
    };
    // Safety net in case the event never fires on some platforms.
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 500);
  });
  return voicesReadyPromise;
}

async function getItalianVoice() {
  if (cachedItalianVoice) return cachedItalianVoice;
  const voices = await loadVoices();
  cachedItalianVoice =
    voices.find((v) => v.lang?.toLowerCase() === "it-it") ??
    voices.find((v) => v.lang?.toLowerCase().startsWith("it")) ??
    null;
  return cachedItalianVoice;
}

export function isSpeechSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

// Builds a short, quiet (but not perfectly silent — some engines skip truly
// zero-amplitude audio) WAV as a data URI, with no file asset needed.
function buildPrimerWavDataUri(durationSeconds = 0.3, sampleRate = 8000) {
  const numSamples = Math.floor(durationSeconds * sampleRate);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, numSamples * 2, true);

  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 60;
    view.setInt16(44 + i * 2, sample, true);
  }

  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return "data:audio/wav;base64," + btoa(binary);
}

let primerAudioEl = null;

// iOS/WebKit plays speechSynthesis through a low, "ambient" audio session by
// default — quiet regardless of the device volume. Playing one real
// <audio> element from a genuine tap switches the page's audio session to
// full "playback" for the rest of the session, which also makes subsequent
// speechSynthesis audio play at normal volume. Must be called synchronously
// from a real user gesture (the mic tap), not from an async callback.
export function unlockSpeech() {
  if (!isSpeechSupported()) return;
  try {
    const unlock = new SpeechSynthesisUtterance(" ");
    unlock.volume = 0;
    window.speechSynthesis.speak(unlock);
  } catch {
    // best-effort only
  }
  try {
    if (!primerAudioEl) {
      primerAudioEl = new Audio(buildPrimerWavDataUri());
      primerAudioEl.volume = 0.2;
    }
    primerAudioEl.currentTime = 0;
    primerAudioEl.play().catch(() => {});
  } catch {
    // best-effort only
  }
}

export async function speak(text) {
  if (!isSpeechSupported() || !text) return;
  stopSpeaking();

  // On iOS, recording audio (for the mic) leaves the app's audio session
  // configured for recording — quiet earpiece output, following the ringer
  // volume. Switch it to a playback session so the answer is heard through
  // the main speaker at normal media volume.
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("prepare_speech_playback");
    } catch (err) {
      console.error("Errore preparazione audio:", err);
    }
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "it-IT";
  utterance.rate = 1;
  utterance.volume = 1;
  const voice = await getItalianVoice();
  if (voice) utterance.voice = voice;

  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (!isSpeechSupported()) return;
  window.speechSynthesis.cancel();
}

export function isSpeaking() {
  return isSpeechSupported() && window.speechSynthesis.speaking;
}
