// Sidecar bridge — owns the bun child process, the JSONL stdio, and the
// Rust-to-frontend event fan-out. Frontend talks to us via Tauri commands;
// we forward to the sidecar; sidecar events come back over `sidecar-event`.

use std::process::Stdio;
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex;

#[derive(Default)]
struct SidecarState {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
}

const SIDECAR_EVENT: &str = "sidecar-event";

fn sidecar_script_path() -> String {
    // dev-time path; the sidecar is a sibling of `src-tauri` at the repo root.
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    format!("{}/../sidecar/index.ts", manifest_dir)
}

async fn write_line(stdin_slot: &Mutex<Option<ChildStdin>>, value: &Value) -> Result<(), String> {
    let line = format!("{}\n", value);
    let mut guard = stdin_slot.lock().await;
    let stdin = guard
        .as_mut()
        .ok_or_else(|| "sidecar not running".to_string())?;
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("write to sidecar: {}", e))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("flush sidecar stdin: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn send_prompt(
    text: String,
    state: State<'_, Arc<SidecarState>>,
) -> Result<(), String> {
    let payload = serde_json::json!({ "type": "prompt", "text": text });
    write_line(&state.stdin, &payload).await
}

async fn spawn_sidecar(app: AppHandle, state: Arc<SidecarState>) -> Result<(), String> {
    let script = sidecar_script_path();

    let mut child = Command::new("bun")
        .arg("run")
        .arg(&script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn sidecar (bun in PATH?): {}", e))?;

    let stdin = child.stdin.take().ok_or("no stdin pipe on sidecar")?;
    let stdout = child.stdout.take().ok_or("no stdout pipe on sidecar")?;
    let stderr = child.stderr.take().ok_or("no stderr pipe on sidecar")?;

    *state.stdin.lock().await = Some(stdin);
    *state.child.lock().await = Some(child);

    // stdout — JSONL events forwarded to the frontend
    {
        let app = app.clone();
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
                                let _ = app.emit(SIDECAR_EVENT, value);
                            }
                            Err(_) => {
                                eprintln!("[sidecar:nonjson] {}", trimmed);
                            }
                        }
                    }
                    Ok(None) => break,
                    Err(err) => {
                        eprintln!("[sidecar:stdout-err] {}", err);
                        break;
                    }
                }
            }
        });
    }

    // stderr — dev log only
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            eprintln!("[sidecar:stderr] {}", line);
        }
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let sidecar_state = Arc::new(SidecarState::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(sidecar_state.clone())
        .invoke_handler(tauri::generate_handler![send_prompt])
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let state = sidecar_state.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = spawn_sidecar(app_handle.clone(), state).await {
                    eprintln!("sidecar startup failed: {}", err);
                    let _ = app_handle.emit(
                        SIDECAR_EVENT,
                        serde_json::json!({
                            "type": "error",
                            "message": format!("sidecar startup failed: {}", err)
                        }),
                    );
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
