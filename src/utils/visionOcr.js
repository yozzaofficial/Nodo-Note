import { buildImpegniSystemPrompt, nowLabel, parseImpegniResponse } from "./impegniPrompt.js";

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function analyzeImageForTasks(imageDataUrl) {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
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
          content: `${buildImpegniSystemPrompt(nowLabel())} L'input è il testo letto da una foto (lista scritta a mano, lavagna, scontrino, elenco stampato, messaggio) invece di una trascrizione vocale. Se non riesci a leggere nessun testo utile nell'immagine, rispondi con {"impegni": []}.`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Estrai gli impegni da questa immagine." },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      temperature: 0.3,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Errore GPT-4o Vision ${resp.status}: ${err}`);
  }

  const json = await resp.json();
  const content = json.choices[0].message.content.trim();
  const impegni = parseImpegniResponse(content);

  if (impegni.length === 0) {
    throw new Error("Nessun testo riconosciuto nella foto");
  }

  return impegni;
}
