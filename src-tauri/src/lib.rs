// Sidecar bridge — owns the bun child process, the JSONL stdio, and the
// Rust-to-frontend event fan-out. Frontend talks to us via Tauri commands;
// we forward to the sidecar; sidecar events come back over `sidecar-event`.

use std::fs::{self, OpenOptions};
use std::io::Write;
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    kind: Option<String>,
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

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GuideSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    anthropic_api_key: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GuideSettingsStatus {
    has_anthropic_api_key: bool,
}

const SIDECAR_EVENT: &str = "sidecar-event";
const SIDECAR_DEV_EVENT: &str = "sidecar-dev-log";
const SIDECAR_BIN_NAME: &str = "guide-sidecar";
const MAX_DEV_LOG_TEXT_CHARS: usize = 240;

fn guide_store_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    Ok(PathBuf::from(home).join(".guide"))
}

fn guide_settings_path() -> Result<PathBuf, String> {
    Ok(guide_store_dir()?.join("settings.json"))
}

fn read_guide_settings() -> Result<GuideSettings, String> {
    let path = guide_settings_path()?;
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents)
            .map_err(|err| format!("failed to parse guide settings: {}", err)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(GuideSettings::default()),
        Err(err) => Err(format!("failed to read guide settings: {}", err)),
    }
}

fn write_guide_settings(settings: &GuideSettings) -> Result<(), String> {
    let path = guide_settings_path()?;
    let Some(parent) = path.parent() else {
        return Err("guide settings path has no parent".into());
    };
    fs::create_dir_all(parent).map_err(|err| format!("failed to create .guide store: {}", err))?;

    let contents = serde_json::to_vec_pretty(settings)
        .map_err(|err| format!("failed to serialize guide settings: {}", err))?;
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&path)
        .map_err(|err| format!("failed to open guide settings: {}", err))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = file.set_permissions(fs::Permissions::from_mode(0o600));
    }

    file.write_all(&contents)
        .map_err(|err| format!("failed to write guide settings: {}", err))?;
    file.write_all(b"\n")
        .map_err(|err| format!("failed to finish guide settings: {}", err))
}

fn guide_settings_status(settings: GuideSettings) -> GuideSettingsStatus {
    GuideSettingsStatus {
        has_anthropic_api_key: settings
            .anthropic_api_key
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty()),
    }
}

struct ResolvedPaths {
    spawn: SpawnTarget,
    persona: PathBuf,
    skills: PathBuf,
    pi_package_dir: Option<PathBuf>,
}

enum SpawnTarget {
    BunScript(PathBuf),
    Binary(PathBuf),
}

fn resolve_paths(app: &AppHandle) -> Result<ResolvedPaths, String> {
    if cfg!(debug_assertions) {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repo_root = manifest_dir
            .parent()
            .ok_or("CARGO_MANIFEST_DIR has no parent")?
            .to_path_buf();
        Ok(ResolvedPaths {
            spawn: SpawnTarget::BunScript(repo_root.join("sidecar/index.ts")),
            persona: repo_root.join("prompts/persona.md"),
            skills: repo_root.join("prompts/skills"),
            pi_package_dir: None,
        })
    } else {
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|e| format!("resolve resource dir: {}", e))?;
        let exe_dir = std::env::current_exe()
            .map_err(|e| format!("resolve current_exe: {}", e))?
            .parent()
            .ok_or("current_exe has no parent")?
            .to_path_buf();
        Ok(ResolvedPaths {
            spawn: SpawnTarget::Binary(exe_dir.join(SIDECAR_BIN_NAME)),
            persona: resource_dir.join("prompts/persona.md"),
            skills: resource_dir.join("prompts/skills"),
            pi_package_dir: Some(resource_dir.join("pi-package")),
        })
    }
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

fn quote_dev_log_text(text: &str) -> String {
    let single_line = text.replace('\n', "\\n").replace('\r', "\\r");
    let mut shortened = single_line
        .chars()
        .take(MAX_DEV_LOG_TEXT_CHARS)
        .collect::<String>();
    if single_line.chars().count() > MAX_DEV_LOG_TEXT_CHARS {
        shortened.push_str("...");
    }
    serde_json::to_string(&shortened).unwrap_or_else(|_| "\"<unprintable>\"".into())
}

fn text_from_content(content: Option<&Value>) -> Option<String> {
    let text = content?
        .as_array()?
        .iter()
        .filter_map(|part| {
            if part.get("type").and_then(Value::as_str) == Some("text") {
                part.get("text").and_then(Value::as_str)
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("");

    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn format_usage(message: &Value) -> String {
    let Some(usage) = message.get("usage") else {
        return String::new();
    };

    let mut parts = Vec::new();
    if let Some(tokens) = usage.get("totalTokens").and_then(Value::as_u64) {
        parts.push(format!("tokens={}", tokens));
    }
    if let Some(total_cost) = usage
        .get("cost")
        .and_then(|cost| cost.get("total"))
        .and_then(Value::as_f64)
    {
        parts.push(format!("cost={:.6}", total_cost));
    }

    if parts.is_empty() {
        String::new()
    } else {
        format!(" {}", parts.join(" "))
    }
}

fn format_session_dev_event(event: &Value) -> Option<String> {
    let event_type = event.get("type").and_then(Value::as_str)?;

    match event_type {
        "agent_start" | "turn_start" => Some(event_type.to_string()),
        "agent_end" => {
            let message_count = event
                .get("messages")
                .and_then(Value::as_array)
                .map(|messages| messages.len())
                .unwrap_or(0);
            Some(format!("agent_end messages={}", message_count))
        }
        "turn_end" => {
            let tool_result_count = event
                .get("toolResults")
                .and_then(Value::as_array)
                .map(|results| results.len())
                .unwrap_or(0);
            Some(format!("turn_end toolResults={}", tool_result_count))
        }
        "message_start" => {
            let message = event.get("message")?;
            let role = message
                .get("role")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            if role == "assistant" {
                let model = message
                    .get("model")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown-model");
                Some(format!("assistant_start model={}", model))
            } else {
                Some(format!("{}_start", role))
            }
        }
        "message_end" => {
            let message = event.get("message")?;
            let role = message
                .get("role")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let text = text_from_content(message.get("content"))
                .map(|text| format!(" {}", quote_dev_log_text(&text)))
                .unwrap_or_default();
            let usage = if role == "assistant" {
                format_usage(message)
            } else {
                String::new()
            };
            Some(format!("{}_final{}{}", role, text, usage))
        }
        "message_update" => {
            let assistant_event = event.get("assistantMessageEvent")?;
            let assistant_event_type = assistant_event.get("type").and_then(Value::as_str)?;
            match assistant_event_type {
                "text_delta" => {
                    let delta = assistant_event
                        .get("delta")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    Some(format!("assistant_delta {}", quote_dev_log_text(delta)))
                }
                "text_start" => Some("assistant_text_start".into()),
                "text_end" => Some("assistant_text_end".into()),
                other => Some(format!("assistant_event {}", other)),
            }
        }
        "tool_execution_start" => {
            let name = event
                .get("toolName")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            Some(format!("tool_start {}", name))
        }
        "tool_execution_end" => {
            let name = event
                .get("toolName")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let ok = !event
                .get("isError")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            Some(format!("tool_end {} ok={}", name, ok))
        }
        other => Some(format!("session_event {}", other)),
    }
}

fn format_sidecar_dev_log(value: &Value) -> Option<String> {
    match value.get("type").and_then(Value::as_str)? {
        "project_state" => {
            let phase = value
                .get("phase")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let brief = value.get("brief").and_then(Value::as_bool).unwrap_or(false);
            let prd_count = value
                .get("prds")
                .and_then(Value::as_array)
                .map(|prds| prds.len())
                .unwrap_or(0);
            let issue_count = value
                .get("issues")
                .and_then(Value::as_array)
                .map(|issues| issues.len())
                .unwrap_or(0);
            Some(format!(
                "project_state phase={} brief={} prds={} issues={}",
                phase, brief, prd_count, issue_count
            ))
        }
        "session_event" => format_session_dev_event(value.get("event")?),
        "tool_start" => {
            let name = value
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            Some(format!("tool_start {}", name))
        }
        "tool_end" => {
            let name = value
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let ok = value.get("ok").and_then(Value::as_bool).unwrap_or(false);
            Some(format!("tool_end {} ok={}", name, ok))
        }
        "assistant_error" => {
            let message = value
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("unknown assistant error");
            Some(format!("assistant_error {}", quote_dev_log_text(message)))
        }
        other => Some(format!("{} {}", other, value)),
    }
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
async fn new_project(state: State<'_, Arc<SidecarState>>) -> Result<(), String> {
    if let Ok(mut guard) = state.active_project.lock() {
        *guard = None;
    }
    if let Ok(mut guard) = state.last_hydrate.lock() {
        *guard = Some(vec![]);
    }
    let payload = serde_json::json!({ "type": "new_project" });
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
fn get_guide_settings() -> Result<GuideSettingsStatus, String> {
    read_guide_settings().map(guide_settings_status)
}

#[tauri::command]
async fn set_anthropic_api_key(
    api_key: String,
    state: State<'_, Arc<SidecarState>>,
) -> Result<GuideSettingsStatus, String> {
    let trimmed = api_key.trim().to_string();
    if trimmed.is_empty() {
        return Err("API key cannot be empty".into());
    }

    let settings = GuideSettings {
        anthropic_api_key: Some(trimmed.clone()),
    };
    write_guide_settings(&settings)?;

    let payload = serde_json::json!({
        "type": "set_api_key",
        "provider": "anthropic",
        "apiKey": trimmed,
    });
    write_line(&state.stdin, &payload).await?;

    Ok(guide_settings_status(settings))
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
    if path.is_dir() {
        let mut entries = fs::read_dir(&path)
            .map_err(|err| format!("failed to read project directory {}: {}", name, err))?
            .filter_map(|entry| {
                let entry = entry.ok()?;
                let file_type = entry.file_type().ok()?;
                if !file_type.is_file() {
                    return None;
                }
                entry.file_name().into_string().ok()
            })
            .collect::<Vec<_>>();
        entries.sort();
        return Ok(entries.join("\n"));
    }
    match fs::read_to_string(&path) {
        Ok(contents) => Ok(contents),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(err) => Err(format!("failed to read project file {}: {}", name, err)),
    }
}

async fn spawn_sidecar(app: AppHandle, state: Arc<SidecarState>) -> Result<(), String> {
    let paths = resolve_paths(&app)?;

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

    let mut command = match &paths.spawn {
        SpawnTarget::BunScript(script) => {
            let mut c = Command::new("bun");
            c.arg("run").arg(script);
            c
        }
        SpawnTarget::Binary(path) => Command::new(path),
    };
    if let Some(dir) = &paths.pi_package_dir {
        command.env("PI_PACKAGE_DIR", dir);
    }
    if let Ok(settings) = read_guide_settings() {
        if let Some(api_key) = settings.anthropic_api_key {
            let trimmed = api_key.trim().to_string();
            if !trimmed.is_empty() {
                command.env("ANTHROPIC_API_KEY", trimmed);
            }
        }
    }
    let spawn_label = match &paths.spawn {
        SpawnTarget::BunScript(_) => "bun in PATH?",
        SpawnTarget::Binary(_) => "bundled sidecar binary missing?",
    };
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Belt-and-suspenders: explicit shutdown handlers cover normal close,
        // but kill_on_drop catches the early-error paths (e.g. take()-ing one
        // of the stdio pipes returns None and we bail) where the Child handle
        // drops before the handlers see it.
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("failed to spawn sidecar ({}): {}", spawn_label, e))?;

    let mut stdin = child.stdin.take().ok_or("no stdin pipe on sidecar")?;
    let stdout = child.stdout.take().ok_or("no stdout pipe on sidecar")?;
    let stderr = child.stderr.take().ok_or("no stderr pipe on sidecar")?;

    let init_payload = serde_json::json!({
        "type": "init",
        "personaPath": paths.persona.to_string_lossy(),
        "skillsPath": paths.skills.to_string_lossy(),
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
                        let log_line =
                            format_sidecar_dev_log(&value).unwrap_or_else(|| value.to_string());
                        eprintln!("[sidecar:dev] {}", log_line);
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn formats_streaming_text_delta_without_nested_json() {
        let value = json!({
            "type": "session_event",
            "event": {
                "type": "message_update",
                "assistantMessageEvent": {
                    "type": "text_delta",
                    "delta": "hello\nworld"
                },
                "message": {
                    "role": "assistant",
                    "content": [{ "type": "text", "text": "hello\nworld" }]
                }
            }
        });

        assert_eq!(
            format_sidecar_dev_log(&value).as_deref(),
            Some("assistant_delta \"hello\\\\nworld\"")
        );
    }

    #[test]
    fn formats_assistant_final_with_usage_summary() {
        let value = json!({
            "type": "session_event",
            "event": {
                "type": "message_end",
                "message": {
                    "role": "assistant",
                    "content": [{ "type": "text", "text": "Done." }],
                    "usage": {
                        "totalTokens": 42,
                        "cost": { "total": 0.1234567 }
                    }
                }
            }
        });

        assert_eq!(
            format_sidecar_dev_log(&value).as_deref(),
            Some("assistant_final \"Done.\" tokens=42 cost=0.123457")
        );
    }

    #[test]
    fn formats_project_state_as_counts() {
        let value = json!({
            "type": "project_state",
            "brief": false,
            "phase": "scoping",
            "prds": ["a.md", "b.md"],
            "issues": ["1.md"]
        });

        assert_eq!(
            format_sidecar_dev_log(&value).as_deref(),
            Some("project_state phase=scoping brief=false prds=2 issues=1")
        );
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
            new_project,
            get_active_project,
            get_guide_settings,
            set_anthropic_api_key,
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
