// Sidecar bridge — owns the bun child process, the JSONL stdio, and the
// Rust-to-frontend event fan-out. Frontend talks to us via Tauri commands;
// we forward to the sidecar; sidecar events come back over `sidecar-event`.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tokio::io::{AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex as AsyncMutex;

#[derive(Default)]
struct SidecarState {
    // Sync mutex so a sync window-event handler can lock and kill on close.
    child: StdMutex<Option<Child>>,
    // Async mutex so write_line can hold across awaits.
    stdin: AsyncMutex<Option<ChildStdin>>,
    ready: AtomicBool,
    // Last fatal error from the sidecar lifecycle (spawn failure, EOF, etc.).
    // Pulled by the frontend via get_sidecar_status so the user-visible UI can
    // reflect a dead sidecar even if the error event fired before the
    // frontend's listener was attached.
    last_error: StdMutex<Option<String>>,
    // Latest hydrate payload so the frontend can recover if it subscribes
    // after the sidecar emits the one-shot startup event.
    last_hydrate: StdMutex<Option<Vec<HydratedMessage>>>,
    // Empty on a fresh install until the first prompt creates a project.
    active_project: StdMutex<Option<ActiveProject>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct HydratedMessage {
    id: String,
    role: String,
    text: String,
    done: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarStatus {
    ready: bool,
    error: Option<String>,
    hydrate: Option<Vec<HydratedMessage>>,
    active_project: Option<ActiveProject>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveProject {
    id: String,
    name: String,
    path: String,
    display_name: String,
}

#[derive(Deserialize)]
struct ActiveProjectEvent {
    project: ActiveProject,
}

const SIDECAR_EVENT: &str = "sidecar-event";
const SIDECAR_DEV_EVENT: &str = "sidecar-dev-log";

fn sidecar_script_path() -> String {
    // Dev-time path; release/packaging is a later slice.
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    format!("{}/../sidecar/index.ts", manifest_dir)
}

fn persona_path() -> String {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    format!("{}/../prompts/persona.md", manifest_dir)
}

fn project_file_path(name: &str, active_project: &ActiveProject) -> Result<PathBuf, String> {
    let relative = Path::new(name);

    if relative.is_absolute() {
        return Err("project file path must be relative".into());
    }

    for component in relative.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("project file path must stay inside the project".into());
            }
        }
    }

    Ok(PathBuf::from(&active_project.path).join(relative))
}

fn record_error(state: &SidecarState, message: String, app: &AppHandle) {
    eprintln!("[sidecar:fatal] {}", message);
    state.ready.store(false, Ordering::Release);
    if let Ok(mut slot) = state.last_error.lock() {
        *slot = Some(message.clone());
    }
    let _ = app.emit(
        SIDECAR_EVENT,
        serde_json::json!({ "type": "error", "message": message }),
    );
}

async fn write_json_line<W: AsyncWrite + Unpin>(
    writer: &mut W,
    value: &Value,
) -> Result<(), String> {
    let line = format!("{}\n", value);
    writer
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("write to sidecar: {}", e))?;
    writer
        .flush()
        .await
        .map_err(|e| format!("flush sidecar stdin: {}", e))?;
    Ok(())
}

async fn write_line(
    stdin_slot: &AsyncMutex<Option<ChildStdin>>,
    value: &Value,
) -> Result<(), String> {
    let mut guard = stdin_slot.lock().await;
    let stdin = guard
        .as_mut()
        .ok_or_else(|| "sidecar not running".to_string())?;
    write_json_line(stdin, value).await
}

#[tauri::command]
async fn send_prompt(text: String, state: State<'_, Arc<SidecarState>>) -> Result<(), String> {
    let payload = serde_json::json!({ "type": "prompt", "text": text });
    write_line(&state.stdin, &payload).await
}

#[tauri::command]
fn get_sidecar_status(state: State<'_, Arc<SidecarState>>) -> SidecarStatus {
    let error = state.last_error.lock().ok().and_then(|guard| guard.clone());
    let hydrate = state
        .last_hydrate
        .lock()
        .ok()
        .and_then(|guard| guard.clone());
    let active_project = state
        .active_project
        .lock()
        .ok()
        .and_then(|guard| guard.clone());
    SidecarStatus {
        ready: state.ready.load(Ordering::Acquire),
        error,
        hydrate,
        active_project,
    }
}

#[tauri::command]
fn get_active_project(state: State<'_, Arc<SidecarState>>) -> Option<ActiveProject> {
    state
        .active_project
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

#[tauri::command]
fn read_project_file(name: String, state: State<'_, Arc<SidecarState>>) -> Result<String, String> {
    let active_project = match state
        .active_project
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
    {
        Some(project) => project,
        None => return Ok(String::new()),
    };
    let path = project_file_path(&name, &active_project)?;
    match fs::read_to_string(&path) {
        Ok(contents) => Ok(contents),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(err) => Err(format!("failed to read project file {}: {}", name, err)),
    }
}

async fn spawn_sidecar(app: AppHandle, state: Arc<SidecarState>) -> Result<(), String> {
    let script = sidecar_script_path();
    let persona = persona_path();

    state.ready.store(false, Ordering::Release);
    if let Ok(mut slot) = state.last_error.lock() {
        *slot = None;
    }
    if let Ok(mut slot) = state.last_hydrate.lock() {
        *slot = None;
    }
    if let Ok(mut slot) = state.active_project.lock() {
        *slot = None;
    }

    let mut child = Command::new("bun")
        .arg("run")
        .arg(&script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Belt-and-suspenders: explicit shutdown handlers cover normal close,
        // but kill_on_drop catches the early-error paths (e.g. take()-ing one
        // of the stdio pipes returns None and we bail) where the Child handle
        // drops before the handlers see it.
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("failed to spawn sidecar (bun in PATH?): {}", e))?;

    let mut stdin = child.stdin.take().ok_or("no stdin pipe on sidecar")?;
    let stdout = child.stdout.take().ok_or("no stdout pipe on sidecar")?;
    let stderr = child.stderr.take().ok_or("no stderr pipe on sidecar")?;

    let init_payload = serde_json::json!({
        "type": "init",
        "personaPath": persona,
    });
    write_json_line(&mut stdin, &init_payload)
        .await
        .map_err(|e| format!("failed to initialize sidecar: {}", e))?;

    *state.stdin.lock().await = Some(stdin);
    if let Ok(mut slot) = state.child.lock() {
        *slot = Some(child);
    }

    // stdout — JSONL events forwarded to the frontend.
    {
        let app = app.clone();
        let state = state.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        match serde_json::from_str::<Value>(trimmed) {
                            Ok(value) => {
                                match value.get("type").and_then(|v| v.as_str()) {
                                    Some("ready") => {
                                        state.ready.store(true, Ordering::Release);
                                        if let Ok(mut slot) = state.last_error.lock() {
                                            *slot = None;
                                        }
                                    }
                                    Some("error") => {
                                        state.ready.store(false, Ordering::Release);
                                        if let Some(message) =
                                            value.get("message").and_then(|v| v.as_str())
                                        {
                                            if let Ok(mut slot) = state.last_error.lock() {
                                                *slot = Some(message.to_string());
                                            }
                                        }
                                    }
                                    Some("hydrate") => {
                                        if let Some(messages) = value.get("messages") {
                                            if let Ok(parsed) =
                                                serde_json::from_value::<Vec<HydratedMessage>>(
                                                    messages.clone(),
                                                )
                                            {
                                                if let Ok(mut slot) = state.last_hydrate.lock() {
                                                    *slot = Some(parsed);
                                                }
                                            }
                                        }
                                    }
                                    Some("active_project") => {
                                        if let Ok(parsed) =
                                            serde_json::from_value::<ActiveProjectEvent>(
                                                value.clone(),
                                            )
                                        {
                                            if let Ok(mut slot) = state.active_project.lock() {
                                                *slot = Some(parsed.project);
                                            }
                                        }
                                    }
                                    _ => {}
                                }
                                let _ = app.emit(SIDECAR_EVENT, value);
                            }
                            Err(_) => {
                                eprintln!("[sidecar:nonjson] {}", trimmed);
                            }
                        }
                    }
                    Ok(None) => {
                        record_error(&state, "sidecar exited unexpectedly".into(), &app);
                        break;
                    }
                    Err(err) => {
                        record_error(&state, format!("sidecar stdout error: {}", err), &app);
                        break;
                    }
                }
            }
        });
    }

    // stderr — dev log only.
    {
        let app = app.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                match serde_json::from_str::<Value>(trimmed) {
                    Ok(value) => {
                        eprintln!("[sidecar:dev] {}", value);
                        let _ = app.emit(SIDECAR_DEV_EVENT, value);
                    }
                    Err(_) => {
                        eprintln!("[sidecar:stderr] {}", trimmed);
                    }
                }
            }
        });
    }

    Ok(())
}

fn shutdown_sidecar(state: &SidecarState) {
    let mut guard = match state.child.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(mut child) = guard.take() {
        // start_kill is sync and doesn't await; sufficient to ensure the
        // bun process gets a SIGKILL before the parent exits.
        let _ = child.start_kill();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let sidecar_state = Arc::new(SidecarState::default());

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(sidecar_state.clone())
        .invoke_handler(tauri::generate_handler![
            send_prompt,
            get_active_project,
            get_sidecar_status,
            read_project_file
        ])
        .on_window_event({
            let state = sidecar_state.clone();
            move |_window, event| {
                if let WindowEvent::Destroyed = event {
                    shutdown_sidecar(&state);
                }
            }
        })
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let state = sidecar_state.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = spawn_sidecar(app_handle.clone(), state.clone()).await {
                    record_error(&state, err, &app_handle);
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            if let Some(state) = app.try_state::<Arc<SidecarState>>() {
                shutdown_sidecar(state.inner());
            }
        }
    });
}
