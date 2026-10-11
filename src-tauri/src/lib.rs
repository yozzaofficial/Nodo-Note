use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use std::sync::{Arc, Mutex};

// After recording with cpal, iOS leaves the app's audio session configured
// for recording (routed to the quiet earpiece speaker and following the
// ringer volume, not the media volume). Switching the category to Playback
// right before speaking a TTS answer routes audio to the main speaker at
// full media volume instead.
#[cfg(target_os = "ios")]
#[tauri::command]
fn prepare_speech_playback() -> Result<(), String> {
    use objc2_avf_audio::{AVAudioSession, AVAudioSessionCategoryPlayback};

    unsafe {
        let session = AVAudioSession::sharedInstance();
        let category = AVAudioSessionCategoryPlayback.ok_or("Categoria audio non disponibile")?;
        session
            .setCategory_error(category)
            .map_err(|e| e.to_string())?;
        session.setActive_error(true).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(not(target_os = "ios"))]
#[tauri::command]
fn prepare_speech_playback() -> Result<(), String> {
    Ok(())
}

// Recording needs the opposite category from playback. Called right before
// cpal opens the input stream, so a fresh app launch (whatever the OS
// default category is) and a session left in Playback mode by a prior TTS
// answer both get reset to something that actually allows microphone input.
#[cfg(target_os = "ios")]
fn configure_audio_session_for_recording() -> Result<(), String> {
    use objc2_avf_audio::{
        AVAudioSession, AVAudioSessionCategoryOptions, AVAudioSessionCategoryPlayAndRecord,
    };

    unsafe {
        let session = AVAudioSession::sharedInstance();
        let category =
            AVAudioSessionCategoryPlayAndRecord.ok_or("Categoria audio non disponibile")?;
        session
            .setCategory_withOptions_error(category, AVAudioSessionCategoryOptions::DefaultToSpeaker)
            .map_err(|e| e.to_string())?;
        session.setActive_error(true).map_err(|e| e.to_string())?;
    }
    // Switching categories/activating the session can take a moment to
    // actually settle in hardware. Without this, the very first fraction of
    // a second of speech can be clipped or dropped if the user starts
    // talking immediately after tapping the mic.
    std::thread::sleep(std::time::Duration::from_millis(200));
    Ok(())
}

#[cfg(not(target_os = "ios"))]
fn configure_audio_session_for_recording() -> Result<(), String> {
    Ok(())
}

pub struct RecordingState(
    pub Mutex<Option<(std::sync::mpsc::Sender<()>, std::thread::JoinHandle<()>)>>,
);

macro_rules! build_typed_stream {
    ($device:expr, $config:expr, $writer:expr, $ty:ty, $convert:expr) => {{
        let w = $writer.clone();
        $device
            .build_input_stream(
                $config,
                move |data: &[$ty], _| {
                    if let Ok(mut g) = w.lock() {
                        if let Some(ww) = g.as_mut() {
                            for &s in data {
                                let _ = ww.write_sample($convert(s));
                            }
                        }
                    }
                },
                |e| eprintln!("Errore stream: {}", e),
                None,
            )
            .map_err(|e| e.to_string())
    }};
}

// Scopri di più sui comandi Tauri su https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Ciao, {}! Salutato da Rust!", name)
}

#[tauri::command]
fn start_recording(state: tauri::State<'_, RecordingState>) -> Result<String, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Err("Registrazione già in corso".to_string());
    }

    configure_audio_session_for_recording()?;

    let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
    let output_path = std::env::temp_dir().join("nodonote_recording.wav");
    // Remove any previous recording first: if the new recording silently
    // fails to start for some reason, transcription will then error out on a
    // missing file instead of accidentally re-processing stale old audio.
    let _ = std::fs::remove_file(&output_path);
    let output_path_str = output_path.to_string_lossy().to_string();
    let path_clone = output_path.clone();

    let handle = std::thread::spawn(move || {
        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None => {
                eprintln!("Nessun dispositivo di input trovato");
                return;
            }
        };
        let config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("Errore configurazione audio: {}", e);
                return;
            }
        };

        let channels = config.channels();
        let sample_rate = config.sample_rate().0;
        let fmt = config.sample_format();
        let stream_config: cpal::StreamConfig = config.into();

        eprintln!("Formato audio: {:?}, sample_rate: {}, channels: {}", fmt, sample_rate, channels);

        let spec = hound::WavSpec {
            channels,
            sample_rate,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };

        let writer = Arc::new(Mutex::new(match hound::WavWriter::create(&path_clone, spec) {
            Ok(w) => Some(w),
            Err(e) => {
                eprintln!("Errore creazione file WAV: {}", e);
                return;
            }
        }));

        let stream_result: Result<cpal::Stream, String> = match fmt {
            SampleFormat::F32 => {
                build_typed_stream!(&device, &stream_config, writer, f32, |s: f32| s)
            }
            SampleFormat::F64 => {
                build_typed_stream!(&device, &stream_config, writer, f64, |s: f64| s as f32)
            }
            SampleFormat::I16 => {
                build_typed_stream!(&device, &stream_config, writer, i16, |s: i16| {
                    s as f32 / i16::MAX as f32
                })
            }
            SampleFormat::I32 => {
                build_typed_stream!(&device, &stream_config, writer, i32, |s: i32| {
                    s as f32 / i32::MAX as f32
                })
            }
            SampleFormat::U16 => {
                build_typed_stream!(&device, &stream_config, writer, u16, |s: u16| {
                    (s as f32 - 32768.0) / 32768.0
                })
            }
            _ => Err(format!("Formato sample non supportato: {:?}", fmt)),
        };

        let stream = match stream_result {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Errore costruzione stream: {}", e);
                return;
            }
        };

        if let Err(e) = stream.play() {
            eprintln!("Errore avvio stream: {}", e);
            return;
        }

        eprintln!("Registrazione avviata");
        let _ = stop_rx.recv();
        drop(stream);
        eprintln!("Stream fermato, finalizzazione WAV...");

        if let Ok(mut g) = writer.lock() {
            if let Some(w) = g.take() {
                let _ = w.finalize();
            }
        };
        eprintln!("WAV finalizzato");
    });

    *guard = Some((stop_tx, handle));
    Ok(output_path_str)
}

#[tauri::command]
fn stop_recording(state: tauri::State<'_, RecordingState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some((tx, handle)) = guard.take() {
        let _ = tx.send(());
        // Aspetta che il thread finalizzi il file WAV prima di ritornare
        handle.join().map_err(|_| "Errore nel thread di registrazione".to_string())?;
        Ok(())
    } else {
        Err("Nessuna registrazione in corso".to_string())
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ImpegnoAI {
    testo: String,
    #[serde(default)]
    sottotask: Vec<String>,
    #[serde(default)]
    promemoria_at: Option<String>,
}

#[derive(serde::Deserialize)]
struct ClassifiedResponse {
    #[serde(default)]
    tipo: String,
    #[serde(default)]
    domanda: Option<String>,
    #[serde(default)]
    impegni: Vec<ImpegnoAI>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscribeOutcome {
    is_question: bool,
    domanda: Option<String>,
    impegni: Vec<ImpegnoAI>,
}

async fn whisper_transcribe(
    client: &reqwest::Client,
    path: &str,
    api_key: &str,
    prompt: &str,
) -> Result<String, String> {
    let file_bytes = std::fs::read(path).map_err(|e| e.to_string())?;

    let file_part = reqwest::multipart::Part::bytes(file_bytes)
        .file_name("recording.wav")
        .mime_str("audio/wav")
        .map_err(|e| e.to_string())?;

    let form = reqwest::multipart::Form::new()
        .part("file", file_part)
        .text("model", "gpt-4o-transcribe")
        .text("prompt", prompt.to_string());

    let whisper_resp = client
        .post("https://api.openai.com/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !whisper_resp.status().is_success() {
        let status = whisper_resp.status();
        let body = whisper_resp.text().await.unwrap_or_default();
        return Err(format!("Errore Whisper {}: {}", status, body));
    }

    let whisper_json: serde_json::Value =
        whisper_resp.json().await.map_err(|e| e.to_string())?;
    Ok(whisper_json["text"]
        .as_str()
        .ok_or("Risposta Whisper non valida".to_string())?
        .trim()
        .to_string())
}

#[tauri::command]
async fn transcribe_raw(path: String, api_key: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    whisper_transcribe(
        &client,
        &path,
        &api_key,
        "L'utente sta dettando un breve elemento da aggiungere a una lista o a un'agenda.",
    )
    .await
}

#[tauri::command]
async fn transcribe_recording(
    path: String,
    api_key: String,
    now_iso: String,
) -> Result<TranscribeOutcome, String> {
    let client = reqwest::Client::new();

    let trascrizione = whisper_transcribe(
        &client,
        &path,
        &api_key,
        "L'utente sta registrando un impegno: un appuntamento, un compito o un promemoria da fare.",
    )
    .await?;

    // Prima stabilisce se è una domanda su note esistenti o un nuovo impegno da
    // salvare; nel secondo caso lo scompone in uno o più impegni (con sottotask).
    let system_prompt = format!(
        "Sei un assistente vocale che aiuta a prendere nota degli impegni. Prima di tutto stabilisci l'intento di chi parla: (A) sta FACENDO UNA DOMANDA su impegni/note che ha già salvato in passato (es. \"cosa dovevo comprare?\", \"quali impegni ho con Marco questa settimana?\", \"ho qualcosa di urgente oggi?\", \"ho già chiamato il dottore?\"), oppure (B) sta DETTANDO un nuovo impegno, compito, promemoria o lista da salvare. Nel dubbio, se la frase è dettata come un'azione da fare o un'informazione da ricordare, trattala come caso B.\n\nSe è il caso (A), rispondi SOLO con un oggetto JSON nella forma {{\"tipo\": \"domanda\", \"domanda\": \"<la domanda riformulata in modo chiaro e completo>\"}}.\n\nSe è il caso (B), applica queste regole: Ricevi una trascrizione vocale grezza che può contenere uno o più impegni distinti (appuntamenti, compiti, promemoria) oppure un elenco di più elementi correlati (es. una lista della spesa, una lista di ingredienti, un elenco di cose da preparare). Data e ora attuali: {now_iso}. Regole: 1) Se riconosci un elenco di ALMENO DUE elementi simili che appartengono a un unico contesto (es. lista della spesa con più prodotti), crea UN SOLO impegno con un titolo generale che descriva il contesto (es. 'Fare la spesa') e inserisci ogni elemento dell'elenco come voce separata nel campo 'sottotask'. 2) Se l'utente menziona UN SOLO elemento o un singolo impegno (anche se è comprare un solo prodotto, es. 'comprare le patatine'), NON creare una lista: crea un impegno singolo il cui testo descrive direttamente l'azione, con 'sottotask' vuoto ([]). Non inventare mai un titolo generico di contesto (come 'Fare la spesa') quando c'è un solo elemento. 3) Se riconosci più impegni indipendenti e di natura diversa tra loro (es. un appuntamento e un compito non correlato), crea un impegno distinto per ciascuno, con 'sottotask' vuoto ([]). Riformula ogni impegno e ogni sottotask in modo fluido e naturale, come se fosse annotato su un'agenda, mantenendo tutte le informazioni (date, orari, persone, luoghi). 4) Se nell'impegno viene menzionata o si può dedurre una data e/o un orario specifico (es. 'domani alle 15', 'lunedì prossimo', 'tra un'ora', 'il 20 dicembre alle 10'), calcola la data/ora assoluta risultante a partire da 'Data e ora attuali' e inseriscila nel campo 'promemoria_at' in formato ISO 8601 locale SENZA fuso orario (es. '2026-07-06T15:00:00'). Se non c'è alcun riferimento temporale specifico e puntuale, imposta 'promemoria_at' a null. Non impostare 'promemoria_at' per date generiche senza orario a meno che non sia l'unica informazione disponibile (in quel caso usa le ore 09:00). Rispondi SOLO con un oggetto JSON valido nella forma {{\"tipo\": \"impegni\", \"impegni\": [{{\"testo\": \"...\", \"sottotask\": [\"...\", \"...\"], \"promemoria_at\": \"...\" o null}}, ...]}}, senza markdown e senza spiegazioni. Il campo 'sottotask' è sempre un array di stringhe, vuoto se non applicabile.\n\nRispondi nella stessa lingua parlata dall'utente. Rispondi SEMPRE e SOLO con un oggetto JSON valido (uno dei due formati sopra), senza markdown e senza spiegazioni."
    );

    let gpt_body = serde_json::json!({
        "model": "gpt-4o",
        "response_format": { "type": "json_object" },
        "messages": [
            {
                "role": "system",
                "content": system_prompt
            },
            {
                "role": "user",
                "content": trascrizione
            }
        ],
        "temperature": 0.3
    });

    let gpt_resp = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&gpt_body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !gpt_resp.status().is_success() {
        let status = gpt_resp.status();
        let err_body = gpt_resp.text().await.unwrap_or_default();
        return Err(format!("Errore GPT-4o {}: {}", status, err_body));
    }

    let gpt_json: serde_json::Value = gpt_resp.json().await.map_err(|e| e.to_string())?;
    let content = gpt_json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("Risposta GPT-4o non valida".to_string())?
        .trim()
        .to_string();

    let parsed: ClassifiedResponse =
        serde_json::from_str(&content).map_err(|e| format!("Errore parsing JSON risposta: {}", e))?;

    if parsed.tipo == "domanda" {
        let domanda = parsed.domanda.unwrap_or_default().trim().to_string();
        if domanda.is_empty() {
            return Err("Domanda non riconosciuta".to_string());
        }
        return Ok(TranscribeOutcome {
            is_question: true,
            domanda: Some(domanda),
            impegni: Vec::new(),
        });
    }

    let impegni: Vec<ImpegnoAI> = parsed
        .impegni
        .into_iter()
        .map(|i| ImpegnoAI {
            testo: i.testo.trim().to_string(),
            sottotask: i
                .sottotask
                .into_iter()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            promemoria_at: i
                .promemoria_at
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
        })
        .filter(|i| !i.testo.is_empty())
        .collect();

    if impegni.is_empty() {
        return Err("Nessun impegno riconosciuto".to_string());
    }

    Ok(TranscribeOutcome {
        is_question: false,
        domanda: None,
        impegni,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(RecordingState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            greet,
            start_recording,
            stop_recording,
            transcribe_recording,
            transcribe_raw,
            prepare_speech_playback
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
