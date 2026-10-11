# NodoNote

App di note vocali per iOS (e desktop), costruita con **Tauri v2 + React**. Parli, l'app trascrive, estrae i task e le date, ti manda i promemoria e risponde (anche a voce) a domande sulle tue note. Funziona **offline-first**: tutto si salva in locale e si sincronizza con Supabase quando c'è connessione.

## Funzionalità

- **Note vocali**: registrazione nativa (Rust/cpal) → trascrizione OpenAI (`gpt-4o-transcribe`) → estrazione di note, sottotask e data/ora (GPT-4o).
- **Foto → task**: scatto/scelta foto dal selettore di sistema → OCR e estrazione task con GPT-4o Vision.
- **Promemoria locali**: se l'AI trova una data/ora, programma 3 notifiche (1 giorno, 5 ore e 30 minuti prima; se troppo vicina, una sola all'orario).
- **"Ask your notes"**: lo stesso pulsante microfono classifica l'input come *domanda* o *dettatura*. Se è una domanda, risponde usando solo le tue note (chat in `/ask`) e legge la risposta a voce (Web Speech Synthesis).
- **Offline-first**: cache IndexedDB + coda di sincronizzazione verso Supabase; funziona anche in modalità aereo.
- **Gesture**: swipe per completare, pressione lunga per eliminare (pointer events).
- **Account**: registrazione con username e telefono univoci, campo `licenza` (booleano, per uso futuro, nessuna UI). Il menu profilo mostra l'username.
- **Tema**: chiaro/scuro con palette derivata dal logo (token CSS in `src/css/theme.css`), safe-area iOS (`viewport-fit=cover`).

## Stack

| Livello | Tecnologia |
|---|---|
| Shell nativa | Tauri v2 (Rust) |
| UI | React 19, React Router (HashRouter), Vite |
| Backend | Supabase (Postgres + Auth + Storage, RLS) |
| AI | OpenAI: trascrizione, GPT-4o (testo e Vision) |
| Audio nativo | `cpal` + `hound` (registrazione WAV), `objc2-avf-audio` (AVAudioSession su iOS) |
| Notifiche | `tauri-plugin-notification` |

## Struttura

```
src/
  App.jsx, main.jsx          routing: /login, /, /tasks, /settings, /note/:id, /record, /ask
  db.js                      livello dati: cache locale → coda → sync Supabase (trySync)
  components/                Home, TasksPage, NoteDetail, RecordingPage, AskPage, SwipeToComplete, ...
  context/AuthContext.jsx    sessione (inizializzata da localStorage per funzionare offline)
  state/askConversation.js   store della chat (si svuota alla chiusura)
  utils/
    offlineDb.js             wrapper IndexedDB (cache, alias id temporanei, coda)
    notifications.js         programmazione/cancellazione promemoria
    speech.js                TTS + sblocco audio iOS
    transcribe.js, visionOcr.js, askNotes.js, impegniPrompt.js   chiamate OpenAI e prompt
  css/                       theme.css (token), un file per schermata
src-tauri/
  src/lib.rs                 comandi: start/stop_recording, transcribe_recording,
                             transcribe_raw, prepare_speech_playback
  Info.plist                 permessi iOS e nome app (sopravvive alla rigenerazione di gen/apple)
  tauri.conf.json            frameworks iOS (AudioToolbox, AVFAudio) e developmentTeam
supabase/schema.sql          tabelle `impegni`, `profiles`, bucket `audio`, RLS, trigger
```

## Setup

Requisiti: Node, Rust, Xcode (con runtime iOS), CocoaPods, un account Supabase e una chiave OpenAI.

1. `npm install`
2. Copia `.env.example` in `.env` e compila:
   - `VITE_OPENAI_API_KEY`
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. In Supabase → SQL Editor esegui `supabase/schema.sql`.
4. In `src-tauri/tauri.conf.json` sostituisci `bundle.iOS.developmentTeam` con il **tuo** Team ID Apple.

## Comandi

```bash
npm run dev                      # solo frontend (browser)
npx tauri dev                    # desktop
npx tauri ios init               # genera src-tauri/gen/apple (solo la prima volta)
npx tauri ios build --target aarch64   # build release per iPhone
```

### Installare sull'iPhone (senza App Store)

Con iPhone collegato via USB, sbloccato, con Modalità sviluppatore attiva:

```bash
xcrun devicectl list devices
xcrun devicectl device install app --device <ID> \
  src-tauri/gen/apple/build/nodonote_iOS.xcarchive/Products/Applications/nodonote.app
xcrun devicectl device process launch --device <ID> com.matte.nodonote
```

Se il lancio fallisce con "profile not trusted": Impostazioni → Generali → VPN e gestione dispositivo → autorizza il tuo Apple ID.

**Account gratuito = il certificato scade dopo 7 giorni**: l'app smette di aprirsi e va ricompilata e reinstallata. Con l'Apple Developer Program (99 €/anno) si hanno TestFlight e App Store.

## Cose da sapere (lezioni apprese)

- **`tauri ios init` non aggiorna un progetto esistente.** Per cambiare frameworks o config: `rm -rf src-tauri/gen/apple` e rilancia `init`. Questo cancella l'icona (rigenerala con `npx tauri icon <png> --ios-color "#FFFFFF"`); il Team ID resta perché è in `tauri.conf.json`.
- **`custom-protocol`** in `Cargo.toml` (`[features]`) è obbligatorio, altrimenti la build release cerca il dev server.
- **Audio session iOS**: dopo il TTS la sessione resta in categoria Playback e la registrazione successiva fallisce in silenzio. `start_recording` forza `PlayAndRecord` (+ attesa 200 ms) e cancella il WAV precedente; `prepare_speech_playback` forza `Playback` prima di parlare.
- **Notifiche (bug del plugin v2.3.3)**: `Schedule.at` fallisce in silenzio per un mismatch di formato data Rust/Swift, e `Schedule.interval` ha `year` di tipo `u8`. Si usa `Schedule.interval` **senza `year`** (vedi `utils/notifications.js`). Le notifiche usano 4 id riservati per nota.
- **Offline**: usare `supabase.auth.getSession()` (locale), mai `getUser()` (richiede rete).
- **Gesture**: i tap si affidano al `click` nativo; un flag one-shot sopprime il click solo dopo uno swipe/long-press reale. Evitare controlli stretti su `pointerId`.
- **Sicurezza**: `VITE_OPENAI_API_KEY` finisce nel bundle JS dell'app, quindi è estraibile da chi ha l'app. Va bene per uso personale (metti un limite di spesa sulla chiave); per distribuire l'app serve un proxy lato server (es. Supabase Edge Function). La chiave Supabase `anon` è pubblica per design (protetta da RLS).
- **Utenti creati prima di `profiles`** non hanno username/telefono: il menu profilo ripiega sull'email.

## Idee future

- Spostare trascrizione e OCR on-device (framework `Speech` e `Vision` di Apple): gratis, offline, senza chiave. Classificazione/estrazione/Q&A con Foundation Models richiede iPhone 15 Pro+ e iOS 26+ e ha qualità inferiore a GPT-4o.
- Promemoria basati sulla posizione (geofencing) — non implementato.
- UI per il campo `licenza`.
