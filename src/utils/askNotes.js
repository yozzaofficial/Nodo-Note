import { tuttiGliImpegni } from "../db.js";
import { formatFullDate, formatTime } from "./format.js";

function serializeNotesForContext(notes) {
  if (notes.length === 0) return "(l'utente non ha ancora nessuna nota salvata)";

  return notes
    .map((n) => {
      const sub = (n.sottotask ?? [])
        .map((s) => `  - [${s.fatto ? "x" : " "}] ${s.testo}`)
        .join("\n");
      const stato = n.attivo ? "attiva" : "completata";
      const quando = `${formatFullDate(n.data)} ${formatTime(n.data)}`;
      const promemoria = n.promemoria_at
        ? `\n  Promemoria: ${formatFullDate(n.promemoria_at)} alle ${formatTime(n.promemoria_at)}`
        : "";
      return `- Nota #${n.id} (${stato}, creata ${quando}): ${n.trascrizione}${promemoria}${sub ? `\n${sub}` : ""}`;
    })
    .join("\n");
}

export async function answerQuestion(question) {
  const notes = await tuttiGliImpegni();
  const context = serializeNotesForContext(notes);
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `Sei l'assistente di NodoNote, un'app di note e promemoria vocali. Rispondi alla domanda dell'utente basandoti SOLO sulle note elencate qui sotto: non inventare mai informazioni che non ci sono. Se non trovi nulla di pertinente, dillo chiaramente e in modo naturale invece di inventare una risposta. Rispondi in italiano, in modo breve, diretto e colloquiale, come se stessi parlando con un amico. Non citare gli id delle note nella risposta.\n\nNote dell'utente:\n${context}`,
        },
        { role: "user", content: question },
      ],
      temperature: 0.2,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Errore risposta AI ${resp.status}: ${err}`);
  }

  const json = await resp.json();
  return json.choices[0].message.content.trim();
}
