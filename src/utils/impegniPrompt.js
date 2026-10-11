// Shared system prompt builder for turning raw input (voice transcript or
// photo OCR text) into a list of "impegni" (notes/tasks), optionally with a
// detected reminder date/time. Used by both the audio and photo AI flows.
export function buildImpegniSystemPrompt(nowLabel) {
  return `Sei un assistente che aiuta a prendere nota degli impegni. Ricevi un testo grezzo (trascrizione vocale o testo estratto da una foto) che può contenere uno o più impegni distinti (appuntamenti, compiti, promemoria) oppure un elenco di più elementi correlati (es. una lista della spesa, una lista di ingredienti, un elenco di cose da preparare). Data e ora attuali: ${nowLabel}. Regole: 1) Se riconosci un elenco di ALMENO DUE elementi simili che appartengono a un unico contesto (es. lista della spesa con più prodotti), crea UN SOLO impegno con un titolo generale che descriva il contesto (es. 'Fare la spesa') e inserisci ogni elemento dell'elenco come voce separata nel campo 'sottotask'. 2) Se l'utente menziona UN SOLO elemento o un singolo impegno (anche se è comprare un solo prodotto, es. 'comprare le patatine'), NON creare una lista: crea un impegno singolo il cui testo descrive direttamente l'azione, con 'sottotask' vuoto ([]). Non inventare mai un titolo generico di contesto (come 'Fare la spesa') quando c'è un solo elemento. 3) Se riconosci più impegni indipendenti e di natura diversa tra loro (es. un appuntamento e un compito non correlato), crea un impegno distinto per ciascuno, con 'sottotask' vuoto ([]). Riformula ogni impegno e ogni sottotask in modo fluido e naturale, come se fosse annotato su un'agenda, mantenendo tutte le informazioni (date, orari, persone, luoghi, quantità). 4) Se nell'impegno viene menzionato o si può dedurre un riferimento temporale specifico (es. "domani alle 15", "lunedì prossimo", "tra un'ora", "il 20 dicembre alle 10"), calcola la data/ora assoluta risultante a partire da "Data e ora attuali" e inseriscila nel campo 'promemoria_at' in formato ISO 8601 locale SENZA fuso orario (es. "2026-07-06T15:00:00"). Se non c'è alcun riferimento temporale specifico e puntuale, imposta 'promemoria_at' a null. Non impostare 'promemoria_at' per date generiche senza orario a meno che non sia l'unica informazione disponibile (in quel caso usa le ore 09:00). Rispondi nella stessa lingua del testo ricevuto. Rispondi SOLO con un oggetto JSON valido nella forma {"impegni": [{"testo": "...", "sottotask": ["...", "..."], "promemoria_at": "..." o null}, ...]}, senza markdown e senza spiegazioni. Il campo 'sottotask' è sempre un array di stringhe, vuoto se non applicabile.`;
}

export function nowLabel() {
  return new Date().toString();
}

// Used only for the voice-dictation flow: before extracting impegni, first
// decide whether the user is ASKING a question about their existing notes
// (e.g. "cosa dovevo comprare?") rather than dictating something new to save.
export function buildAudioSystemPrompt(nowLabel) {
  return `Sei un assistente vocale che aiuta a prendere nota degli impegni. Prima di tutto stabilisci l'intento di chi parla: (A) sta FACENDO UNA DOMANDA su impegni/note che ha già salvato in passato (es. "cosa dovevo comprare?", "quali impegni ho con Marco questa settimana?", "ho qualcosa di urgente oggi?", "ho già chiamato il dottore?"), oppure (B) sta DETTANDO un nuovo impegno, compito, promemoria o lista da salvare. Nel dubbio, se la frase è dettata come un'azione da fare o un'informazione da ricordare, trattala come caso B.

Se è il caso (A), rispondi SOLO con un oggetto JSON nella forma {"tipo": "domanda", "domanda": "<la domanda riformulata in modo chiaro e completo>"}.

Se è il caso (B), applica queste regole: Ricevi una trascrizione vocale grezza che può contenere uno o più impegni distinti (appuntamenti, compiti, promemoria) oppure un elenco di più elementi correlati (es. una lista della spesa, una lista di ingredienti, un elenco di cose da preparare). Data e ora attuali: ${nowLabel}. Regole: 1) Se riconosci un elenco di ALMENO DUE elementi simili che appartengono a un unico contesto (es. lista della spesa con più prodotti), crea UN SOLO impegno con un titolo generale che descriva il contesto (es. 'Fare la spesa') e inserisci ogni elemento dell'elenco come voce separata nel campo 'sottotask'. 2) Se l'utente menziona UN SOLO elemento o un singolo impegno (anche se è comprare un solo prodotto, es. 'comprare le patatine'), NON creare una lista: crea un impegno singolo il cui testo descrive direttamente l'azione, con 'sottotask' vuoto ([]). Non inventare mai un titolo generico di contesto (come 'Fare la spesa') quando c'è un solo elemento. 3) Se riconosci più impegni indipendenti e di natura diversa tra loro (es. un appuntamento e un compito non correlato), crea un impegno distinto per ciascuno, con 'sottotask' vuoto ([]). Riformula ogni impegno e ogni sottotask in modo fluido e naturale, come se fosse annotato su un'agenda, mantenendo tutte le informazioni (date, orari, persone, luoghi, quantità). 4) Se nell'impegno viene menzionato o si può dedurre un riferimento temporale specifico (es. "domani alle 15", "lunedì prossimo", "tra un'ora", "il 20 dicembre alle 10"), calcola la data/ora assoluta risultante a partire da "Data e ora attuali" e inseriscila nel campo 'promemoria_at' in formato ISO 8601 locale SENZA fuso orario (es. "2026-07-06T15:00:00"). Se non c'è alcun riferimento temporale specifico e puntuale, imposta 'promemoria_at' a null. Non impostare 'promemoria_at' per date generiche senza orario a meno che non sia l'unica informazione disponibile (in quel caso usa le ore 09:00). Rispondi SOLO con un oggetto JSON valido nella forma {"tipo": "impegni", "impegni": [{"testo": "...", "sottotask": ["...", "..."], "promemoria_at": "..." o null}, ...]}, senza markdown e senza spiegazioni. Il campo 'sottotask' è sempre un array di stringhe, vuoto se non applicabile.

Rispondi nella stessa lingua parlata dall'utente. Rispondi SEMPRE e SOLO con un oggetto JSON valido (uno dei due formati sopra), senza markdown e senza spiegazioni.`;
}

export function parseAudioResponse(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error(`Errore parsing JSON risposta vocale: ${e.message}`);
  }

  if (parsed?.tipo === "domanda") {
    const domanda = String(parsed?.domanda ?? "").trim();
    return { isQuestion: true, domanda, impegni: [] };
  }

  const impegni = Array.isArray(parsed?.impegni)
    ? parsed.impegni
        .map((i) => ({
          testo: String(i?.testo ?? "").trim(),
          sottotask: Array.isArray(i?.sottotask)
            ? i.sottotask.map((s) => String(s).trim()).filter(Boolean)
            : [],
          promemoria_at: typeof i?.promemoria_at === "string" && i.promemoria_at.trim() ? i.promemoria_at.trim() : null,
        }))
        .filter((i) => i.testo)
    : [];

  return { isQuestion: false, domanda: null, impegni };
}

export function parseImpegniResponse(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error(`Errore parsing JSON impegni: ${e.message}`);
  }

  const impegni = Array.isArray(parsed?.impegni)
    ? parsed.impegni
        .map((i) => ({
          testo: String(i?.testo ?? "").trim(),
          sottotask: Array.isArray(i?.sottotask)
            ? i.sottotask.map((s) => String(s).trim()).filter(Boolean)
            : [],
          promemoria_at: typeof i?.promemoria_at === "string" && i.promemoria_at.trim() ? i.promemoria_at.trim() : null,
        }))
        .filter((i) => i.testo)
    : [];

  return impegni;
}
