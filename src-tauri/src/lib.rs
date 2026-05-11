// Sidecar bridge — owns the bun child process, the JSONL stdio, and the
// Rust-to-frontend event fan-out. Frontend talks to us via Tauri commands;
// we forward to the sidecar; sidecar events come back over `sidecar-event`.

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{absolute, Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_opener::OpenerExt;
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
    // Latest recents payload so the frontend can recover if it subscribes
    // after startup emits the list.
    last_recents: StdMutex<Vec<RecentProjectEntry>>,
    // Latest recoverable open-project error so startup path failures are not
    // lost if they occur before the frontend subscribes.
    last_project_open_error: StdMutex<Option<String>>,
    // Recent raw sidecar dev events. The frontend pulls this after subscribing
    // so events emitted during startup/hydration are not lost.
    last_dev_logs: StdMutex<Vec<Value>>,
    startup_project_path: StdMutex<Option<PathBuf>>,
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
    project_open_error: Option<String>,
    hydrate: Option<Vec<HydratedMessage>>,
    active_project: Option<ActiveProject>,
    recents: Vec<RecentProjectEntry>,
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentProjectEntry {
    path: String,
    display_name: String,
    last_opened_at: String,
}

#[derive(Deserialize)]
struct RecentsEvent {
    entries: Vec<RecentProjectEntry>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CairnSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    anthropic_api_key: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CairnSettingsStatus {
    has_anthropic_api_key: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct McpSettingsStatus {
    config_path: String,
    notion_enabled: bool,
    notion_managed: bool,
    notion_source: Option<String>,
    slack_enabled: bool,
    slack_managed: bool,
    slack_source: Option<String>,
}

const SIDECAR_EVENT: &str = "sidecar-event";
const SIDECAR_DEV_EVENT: &str = "sidecar-dev-log";
const SIDECAR_BIN_NAME: &str = "cairn-sidecar";
const MAX_DEV_LOG_TEXT_CHARS: usize = 240;
const MAX_DEV_LOG_EVENTS: usize = 1000;
const CAIRN_MCP_META_KEY: &str = "_cairn";
const SLACK_MCP_CLIENT_ID: &str = "3660753192626.8903469228982";

fn cairn_store_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    Ok(PathBuf::from(home).join(".cairn"))
}

fn cairn_settings_path() -> Result<PathBuf, String> {
    Ok(cairn_store_dir()?.join("settings.json"))
}

fn read_cairn_settings() -> Result<CairnSettings, String> {
    let path = cairn_settings_path()?;
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents)
            .map_err(|err| format!("failed to parse cairn settings: {}", err)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(CairnSettings::default()),
        Err(err) => Err(format!("failed to read cairn settings: {}", err)),
    }
}

fn write_cairn_settings(settings: &CairnSettings) -> Result<(), String> {
    let path = cairn_settings_path()?;
    let Some(parent) = path.parent() else {
        return Err("cairn settings path has no parent".into());
    };
    fs::create_dir_all(parent).map_err(|err| format!("failed to create .cairn store: {}", err))?;

    let contents = serde_json::to_vec_pretty(settings)
        .map_err(|err| format!("failed to serialize cairn settings: {}", err))?;
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&path)
        .map_err(|err| format!("failed to open cairn settings: {}", err))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = file.set_permissions(fs::Permissions::from_mode(0o600));
    }

    file.write_all(&contents)
        .map_err(|err| format!("failed to write cairn settings: {}", err))?;
    file.write_all(b"\n")
        .map_err(|err| format!("failed to finish cairn settings: {}", err))
}

fn cairn_settings_status(settings: CairnSettings) -> CairnSettingsStatus {
    CairnSettingsStatus {
        has_anthropic_api_key: settings
            .anthropic_api_key
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty()),
    }
}

fn pi_agent_dir() -> Result<PathBuf, String> {
    if let Ok(configured) = std::env::var("PI_CODING_AGENT_DIR") {
        let trimmed = configured.trim();
        if trimmed.is_empty() {
            return Ok(home_dir()?.join(".pi").join("agent"));
        }
        if trimmed == "~" {
            return home_dir();
        }
        if let Some(rest) = trimmed.strip_prefix("~/") {
            return Ok(home_dir()?.join(rest));
        }
        return Ok(PathBuf::from(trimmed));
    }

    Ok(home_dir()?.join(".pi").join("agent"))
}

fn mcp_config_path() -> Result<PathBuf, String> {
    Ok(pi_agent_dir()?.join("mcp.json"))
}

fn standard_mcp_config_path() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".config").join("mcp").join("mcp.json"))
}

fn project_standard_mcp_config_path(project_path: &Path) -> PathBuf {
    project_path.join(".mcp.json")
}

fn project_pi_mcp_config_path(project_path: &Path) -> PathBuf {
    project_path.join(".pi").join("mcp.json")
}

fn read_mcp_config() -> Result<serde_json::Value, String> {
    let path = mcp_config_path()?;
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents)
            .map_err(|err| format!("failed to parse MCP settings: {}", err)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            Ok(serde_json::json!({ "mcpServers": {} }))
        }
        Err(err) => Err(format!("failed to read MCP settings: {}", err)),
    }
}

fn read_optional_json_config(path: &Path) -> Option<serde_json::Value> {
    let contents = fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

fn write_mcp_config(config: &serde_json::Value) -> Result<(), String> {
    let path = mcp_config_path()?;
    let Some(parent) = path.parent() else {
        return Err("MCP settings path has no parent".into());
    };
    fs::create_dir_all(parent).map_err(|err| format!("failed to create Pi agent dir: {}", err))?;
    let contents = serde_json::to_vec_pretty(config)
        .map_err(|err| format!("failed to serialize MCP settings: {}", err))?;
    fs::write(&path, [contents, b"\n".to_vec()].concat())
        .map_err(|err| format!("failed to write MCP settings: {}", err))
}

fn server_map(config: &serde_json::Value) -> serde_json::Map<String, serde_json::Value> {
    config
        .get("mcpServers")
        .or_else(|| config.get("mcp-servers"))
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default()
}

fn imports(config: &serde_json::Value) -> Vec<String> {
    config
        .get("imports")
        .and_then(|value| value.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn import_config_candidates(kind: &str, cwd: &Path) -> Result<Vec<PathBuf>, String> {
    let home = home_dir()?;
    Ok(match kind {
        "cursor" => vec![home.join(".cursor").join("mcp.json")],
        "claude-code" => vec![
            home.join(".claude").join("mcp.json"),
            home.join(".claude.json"),
            home.join(".claude").join("claude_desktop_config.json"),
        ],
        "claude-desktop" => vec![home
            .join("Library")
            .join("Application Support")
            .join("Claude")
            .join("claude_desktop_config.json")],
        "codex" => vec![home.join(".codex").join("config.json")],
        "windsurf" => vec![home.join(".windsurf").join("mcp.json")],
        "vscode" => vec![cwd.join(".vscode").join("mcp.json")],
        _ => vec![],
    })
}

fn imported_servers(
    config: &serde_json::Value,
    cwd: &Path,
) -> serde_json::Map<String, serde_json::Value> {
    let mut servers = serde_json::Map::new();
    for kind in imports(config) {
        let Ok(candidates) = import_config_candidates(&kind, cwd) else {
            continue;
        };
        let Some(import_path) = candidates.into_iter().find(|path| path.exists()) else {
            continue;
        };
        let Some(imported_config) = read_optional_json_config(&import_path) else {
            continue;
        };
        for (name, definition) in server_map(&imported_config) {
            servers.entry(name).or_insert(definition);
        }
    }
    servers
}

fn config_servers_with_imports(
    config: &serde_json::Value,
    cwd: &Path,
) -> serde_json::Map<String, serde_json::Value> {
    let mut servers = imported_servers(config, cwd);
    for (name, definition) in server_map(config) {
        servers.insert(name, definition);
    }
    servers
}

fn is_cairn_managed_server(definition: &serde_json::Value) -> bool {
    definition
        .get(CAIRN_MCP_META_KEY)
        .and_then(|value| value.as_object())
        .and_then(|meta| meta.get("managed"))
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

struct EffectiveMcpServer {
    definition: serde_json::Value,
    source: String,
}

fn effective_mcp_server_entries(
    project_path: Option<&Path>,
) -> Result<BTreeMap<String, EffectiveMcpServer>, String> {
    let cwd = project_path.unwrap_or_else(|| Path::new("."));
    let pi_path = mcp_config_path()?;
    let mut sources = Vec::new();
    let standard_path = standard_mcp_config_path()?;
    if standard_path != pi_path {
        sources.push(("standard MCP".to_string(), standard_path));
    }
    sources.push(("Pi global".to_string(), pi_path));
    if let Some(project_path) = project_path {
        let project_standard_path = project_standard_mcp_config_path(project_path);
        if !sources
            .iter()
            .any(|(_, path)| path == &project_standard_path)
        {
            sources.push(("project MCP".to_string(), project_standard_path));
        }
        let project_pi_path = project_pi_mcp_config_path(project_path);
        if !sources.iter().any(|(_, path)| path == &project_pi_path) {
            sources.push(("project Pi".to_string(), project_pi_path));
        }
    }

    let mut effective = BTreeMap::new();
    for (source, path) in sources {
        let Some(config) = read_optional_json_config(&path) else {
            continue;
        };
        for (name, definition) in config_servers_with_imports(&config, cwd) {
            effective.insert(
                name,
                EffectiveMcpServer {
                    definition,
                    source: source.clone(),
                },
            );
        }
    }
    Ok(effective)
}

fn builtin_server_status(
    entries: &BTreeMap<String, EffectiveMcpServer>,
    server: &str,
) -> (bool, bool, Option<String>) {
    match entries.get(server) {
        Some(entry) => (
            true,
            is_cairn_managed_server(&entry.definition),
            Some(entry.source.clone()),
        ),
        None => (false, false, None),
    }
}

fn mcp_settings_status(project_path: Option<&Path>) -> Result<McpSettingsStatus, String> {
    let entries = effective_mcp_server_entries(project_path)?;
    let (notion_enabled, notion_managed, notion_source) = builtin_server_status(&entries, "notion");
    let (slack_enabled, slack_managed, slack_source) = builtin_server_status(&entries, "slack");

    Ok(McpSettingsStatus {
        config_path: mcp_config_path()?.display().to_string(),
        notion_enabled,
        notion_managed,
        notion_source,
        slack_enabled,
        slack_managed,
        slack_source,
    })
}

fn mcp_server_config(server: &str) -> Result<serde_json::Value, String> {
    match server {
        "notion" => Ok(serde_json::json!({
            "url": "https://mcp.notion.com/mcp",
            "auth": "oauth",
            "lifecycle": "lazy",
            CAIRN_MCP_META_KEY: {
                "managed": true,
                "server": "notion"
            }
        })),
        "slack" => Ok(serde_json::json!({
            "url": "https://mcp.slack.com/mcp",
            "auth": "oauth",
            "oauth": {
                "clientId": SLACK_MCP_CLIENT_ID
            },
            "lifecycle": "lazy",
            CAIRN_MCP_META_KEY: {
                "managed": true,
                "server": "slack"
            }
        })),
        _ => Err(format!("unsupported MCP server: {}", server)),
    }
}

fn update_builtin_mcp_server(
    mut writable_config: serde_json::Value,
    server: &str,
    enabled: bool,
) -> Result<serde_json::Value, String> {
    if !writable_config.is_object() {
        writable_config = serde_json::json!({});
    }

    let config_object = writable_config
        .as_object_mut()
        .ok_or_else(|| "MCP settings root must be an object".to_string())?;
    let servers_value = config_object
        .entry("mcpServers".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !servers_value.is_object() {
        *servers_value = serde_json::json!({});
    }
    let servers = servers_value
        .as_object_mut()
        .ok_or_else(|| "MCP servers must be an object".to_string())?;

    if enabled {
        if let Some(existing) = servers.get(server) {
            if !is_cairn_managed_server(existing) {
                return Err(format!(
                    "MCP server \"{}\" already has custom Pi config. Cairn will not overwrite it.",
                    server
                ));
            }
        }
        servers.insert(server.to_string(), mcp_server_config(server)?);
    } else {
        let Some(existing) = servers.get(server) else {
            return Ok(writable_config);
        };
        if !is_cairn_managed_server(existing) {
            return Err(format!(
                "MCP server \"{}\" has custom Pi config. Cairn will not remove it.",
                server
            ));
        }
        servers.remove(server);
    }

    Ok(writable_config)
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| "HOME is not set".to_string())
}

fn first_positional_arg(args: Vec<String>) -> Option<String> {
    let mut after_double_dash = false;
    for arg in args {
        if !after_double_dash && arg == "--" {
            after_double_dash = true;
            continue;
        }
        if !after_double_dash && arg.starts_with('-') {
            continue;
        }
        return Some(arg);
    }
    None
}

fn resolve_startup_project_path(raw_path: &Path) -> Result<PathBuf, String> {
    let candidate = if raw_path.is_absolute() {
        raw_path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|err| format!("failed to resolve current directory: {}", err))?
            .join(raw_path)
    };
    let absolute =
        absolute(&candidate).map_err(|err| format!("failed to resolve project path: {}", err))?;
    Ok(absolute)
}

fn startup_project_path_from_args() -> Result<Option<PathBuf>, String> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let Some(raw_path) = first_positional_arg(args) else {
        return Ok(None);
    };
    home_dir()?;
    resolve_startup_project_path(Path::new(&raw_path)).map(Some)
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

    Ok(PathBuf::from(&active_project.path)
        .join(".cairn")
        .join(relative))
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
    if let Ok(mut guard) = state.last_dev_logs.lock() {
        guard.clear();
    }
    let payload = serde_json::json!({ "type": "new_project" });
    write_line(&state.stdin, &payload).await
}

#[tauri::command]
async fn open_project(path: String, state: State<'_, Arc<SidecarState>>) -> Result<(), String> {
    let payload = serde_json::json!({ "type": "open_project", "path": path });
    write_line(&state.stdin, &payload).await
}

#[tauri::command]
fn open_project_dialog() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg("POSIX path of (choose folder with prompt \"Open a Cairn project folder\")")
            .output()
            .map_err(|err| format!("failed to open folder picker: {}", err))?;

        if !output.status.success() {
            return Ok(None);
        }

        let path = String::from_utf8(output.stdout)
            .map_err(|err| format!("folder picker returned invalid text: {}", err))?
            .trim()
            .to_string();
        return Ok((!path.is_empty()).then_some(path));
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("open folder dialog is not supported on this platform yet".into())
    }
}

#[tauri::command]
async fn list_recents(state: State<'_, Arc<SidecarState>>) -> Result<(), String> {
    let payload = serde_json::json!({ "type": "list_recents" });
    write_line(&state.stdin, &payload).await
}

#[tauri::command]
fn get_sidecar_status(state: State<'_, Arc<SidecarState>>) -> SidecarStatus {
    let error = state.last_error.lock().ok().and_then(|guard| guard.clone());
    let project_open_error = state
        .last_project_open_error
        .lock()
        .ok()
        .and_then(|guard| guard.clone());
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
    let recents = state
        .last_recents
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    SidecarStatus {
        ready: state.ready.load(Ordering::Acquire),
        error,
        project_open_error,
        hydrate,
        active_project,
        recents,
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
fn get_sidecar_dev_logs(state: State<'_, Arc<SidecarState>>) -> Vec<Value> {
    state
        .last_dev_logs
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default()
}

#[tauri::command]
fn get_cairn_settings() -> Result<CairnSettingsStatus, String> {
    read_cairn_settings().map(cairn_settings_status)
}

#[tauri::command]
fn get_mcp_settings(
    project_path: Option<String>,
    state: State<'_, Arc<SidecarState>>,
) -> Result<McpSettingsStatus, String> {
    let project_path = project_path
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            state
                .active_project
                .lock()
                .ok()
                .and_then(|guard| guard.clone())
                .map(|project| PathBuf::from(project.path))
        });
    mcp_settings_status(project_path.as_deref())
}

#[tauri::command]
async fn set_mcp_server_enabled(
    server: String,
    enabled: bool,
    state: State<'_, Arc<SidecarState>>,
) -> Result<McpSettingsStatus, String> {
    mcp_server_config(&server)?;
    let project_path = state
        .active_project
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
        .map(|project| PathBuf::from(project.path));
    let config = update_builtin_mcp_server(read_mcp_config()?, &server, enabled)?;

    write_mcp_config(&config)?;
    let payload = serde_json::json!({ "type": "reload_mcp_config" });
    write_line(&state.stdin, &payload).await?;
    mcp_settings_status(project_path.as_deref())
}

#[tauri::command]
async fn authenticate_mcp_server(
    server: String,
    state: State<'_, Arc<SidecarState>>,
) -> Result<(), String> {
    mcp_server_config(&server)?;
    let config = update_builtin_mcp_server(read_mcp_config()?, &server, true)?;
    write_mcp_config(&config)?;
    let payload = serde_json::json!({ "type": "authenticate_mcp_server", "server": server });
    write_line(&state.stdin, &payload).await
}

#[tauri::command]
async fn set_anthropic_api_key(
    api_key: String,
    state: State<'_, Arc<SidecarState>>,
) -> Result<CairnSettingsStatus, String> {
    let trimmed = api_key.trim().to_string();
    if trimmed.is_empty() {
        return Err("API key cannot be empty".into());
    }

    let settings = CairnSettings {
        anthropic_api_key: Some(trimmed.clone()),
    };
    write_cairn_settings(&settings)?;

    let payload = serde_json::json!({
        "type": "set_api_key",
        "provider": "anthropic",
        "apiKey": trimmed,
    });
    write_line(&state.stdin, &payload).await?;

    Ok(cairn_settings_status(settings))
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

fn bug_report_error(stage: &str, err: impl std::fmt::Display) -> String {
    format!("bug_report_bundle:{}:{}", stage, err)
}

fn copy_dir_all(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|err| bug_report_error("create_cairn_dir", err))?;
    for entry in fs::read_dir(from).map_err(|err| bug_report_error("read_cairn_dir", err))? {
        let entry = entry.map_err(|err| bug_report_error("read_cairn_entry", err))?;
        let file_type = entry
            .file_type()
            .map_err(|err| bug_report_error("read_cairn_entry_type", err))?;
        let target = to.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), &target)
                .map_err(|err| bug_report_error("copy_cairn_file", err))?;
        }
    }
    Ok(())
}

fn bug_report_output_dir() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(home);
        let downloads = home.join("Downloads");
        if downloads.is_dir() {
            return downloads;
        }
        let desktop = home.join("Desktop");
        if desktop.is_dir() {
            return desktop;
        }
    }

    std::env::temp_dir()
}

fn create_bug_report_bundle_in_dir(
    project_path: Option<&Path>,
    dev_events_json: &str,
    meta_json: &str,
    unix_seconds: u64,
    output_dir: &Path,
) -> Result<PathBuf, String> {
    let bundle_name = format!("cairn-bug-{}", unix_seconds);
    let temp_dir = std::env::temp_dir();
    let staging_dir = temp_dir.join(&bundle_name);
    fs::create_dir_all(output_dir).map_err(|err| bug_report_error("create_output_dir", err))?;
    let zip_path = output_dir.join(format!("{}.zip", bundle_name));

    if staging_dir.exists() {
        fs::remove_dir_all(&staging_dir)
            .map_err(|err| bug_report_error("clear_existing_staging", err))?;
    }
    if zip_path.exists() {
        fs::remove_file(&zip_path).map_err(|err| bug_report_error("clear_existing_zip", err))?;
    }
    fs::create_dir_all(&staging_dir).map_err(|err| bug_report_error("create_staging", err))?;

    let mut zip_inputs = Vec::new();
    if let Some(project_path) = project_path {
        let cairn_dir = project_path.join(".cairn");
        if cairn_dir.is_dir() {
            copy_dir_all(&cairn_dir, &staging_dir.join("cairn"))?;
            zip_inputs.push("cairn");
        }
    }

    fs::write(staging_dir.join("dev-events.json"), dev_events_json)
        .map_err(|err| bug_report_error("write_dev_events", err))?;
    fs::write(staging_dir.join("meta.json"), meta_json)
        .map_err(|err| bug_report_error("write_meta", err))?;
    zip_inputs.push("dev-events.json");
    zip_inputs.push("meta.json");

    let output = std::process::Command::new("/usr/bin/zip")
        .arg("-rq")
        .arg(&zip_path)
        .args(zip_inputs)
        .current_dir(&staging_dir)
        .output()
        .map_err(|err| bug_report_error("run_zip", err))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _ = fs::remove_dir_all(&staging_dir);
        return Err(bug_report_error(
            "zip_failed",
            format!("status={} stderr={}", output.status, stderr.trim()),
        ));
    }

    fs::remove_dir_all(&staging_dir).map_err(|err| bug_report_error("remove_staging", err))?;
    Ok(zip_path)
}

#[cfg(test)]
fn create_bug_report_bundle(
    project_path: Option<&Path>,
    dev_events_json: &str,
    meta_json: &str,
    unix_seconds: u64,
) -> Result<PathBuf, String> {
    create_bug_report_bundle_in_dir(
        project_path,
        dev_events_json,
        meta_json,
        unix_seconds,
        &std::env::temp_dir(),
    )
}

#[tauri::command]
fn bug_report_bundler(
    app: AppHandle,
    project_path: Option<String>,
    dev_events_json: String,
    meta_json: String,
    github_url: String,
) -> Result<String, String> {
    let unix_seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|err| bug_report_error("timestamp", err))?
        .as_secs();
    let project_path = project_path.as_deref().map(Path::new);
    let output_dir = bug_report_output_dir();
    let zip_path = create_bug_report_bundle_in_dir(
        project_path,
        &dev_events_json,
        &meta_json,
        unix_seconds,
        &output_dir,
    )?;

    app.opener()
        .open_url(github_url, None::<&str>)
        .map_err(|err| bug_report_error("open_github", err))?;
    app.opener()
        .reveal_item_in_dir(&zip_path)
        .map_err(|err| bug_report_error("reveal_zip", err))?;

    Ok(zip_path.to_string_lossy().to_string())
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
    if let Ok(mut slot) = state.last_recents.lock() {
        slot.clear();
    }
    if let Ok(mut slot) = state.last_project_open_error.lock() {
        *slot = None;
    }
    if let Ok(mut slot) = state.last_dev_logs.lock() {
        slot.clear();
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
    if let Ok(settings) = read_cairn_settings() {
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
        "skipAutoOpen": state
            .startup_project_path
            .lock()
            .map(|slot| slot.is_some())
            .unwrap_or(false),
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
                                        let startup_project_path = state
                                            .startup_project_path
                                            .lock()
                                            .ok()
                                            .and_then(|mut slot| slot.take());
                                        if let Some(path) = startup_project_path {
                                            let payload = serde_json::json!({
                                                "type": "open_project",
                                                "path": path.to_string_lossy(),
                                                "locateProjectRoot": true,
                                            });
                                            if let Err(err) =
                                                write_line(&state.stdin, &payload).await
                                            {
                                                record_error(
                                                    &state,
                                                    format!(
                                                        "failed to open startup project: {}",
                                                        err
                                                    ),
                                                    &app,
                                                );
                                            }
                                        }
                                    }
                                    Some("error") => {
                                        let recoverable = value
                                            .get("recoverable")
                                            .and_then(|v| v.as_bool())
                                            .unwrap_or(false);
                                        if !recoverable {
                                            state.ready.store(false, Ordering::Release);
                                        }
                                        if let Some(message) =
                                            value.get("message").and_then(|v| v.as_str())
                                        {
                                            if !recoverable {
                                                if let Ok(mut slot) = state.last_error.lock() {
                                                    *slot = Some(message.to_string());
                                                }
                                            } else if let Ok(mut slot) =
                                                state.last_project_open_error.lock()
                                            {
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
                                            if let Ok(mut slot) =
                                                state.last_project_open_error.lock()
                                            {
                                                *slot = None;
                                            }
                                        }
                                    }
                                    Some("recents") => {
                                        if let Ok(parsed) =
                                            serde_json::from_value::<RecentsEvent>(value.clone())
                                        {
                                            if let Ok(mut slot) = state.last_recents.lock() {
                                                *slot = parsed.entries;
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
        let state = state.clone();
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
                        if let Ok(mut slot) = state.last_dev_logs.lock() {
                            slot.push(value.clone());
                            if slot.len() > MAX_DEV_LOG_EVENTS {
                                let drain_count = slot.len() - MAX_DEV_LOG_EVENTS;
                                slot.drain(0..drain_count);
                            }
                        }
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

    #[test]
    fn project_file_path_reads_from_cairn_dir_and_rejects_traversal() {
        let active_project = ActiveProject {
            id: "demo".into(),
            name: "Demo".into(),
            path: "/tmp/demo-project".into(),
            display_name: "Demo".into(),
        };

        assert_eq!(
            project_file_path("brief.json", &active_project).unwrap(),
            PathBuf::from("/tmp/demo-project/.cairn/brief.json")
        );
        assert!(project_file_path("../brief.json", &active_project).is_err());
        assert!(project_file_path("../../etc/passwd", &active_project).is_err());
    }

    #[test]
    fn mcp_builtin_enable_writes_managed_config() {
        let writable = json!({ "mcpServers": {} });

        let next = update_builtin_mcp_server(writable, "notion", true).unwrap();

        assert_eq!(
            next["mcpServers"]["notion"],
            mcp_server_config("notion").unwrap()
        );
    }

    #[test]
    fn mcp_builtin_slack_uses_static_oauth_client_id() {
        let config = mcp_server_config("slack").unwrap();

        assert_eq!(config["url"], json!("https://mcp.slack.com/mcp"));
        assert_eq!(config["auth"], json!("oauth"));
        assert_eq!(
            config["oauth"]["clientId"],
            json!("3660753192626.8903469228982")
        );
    }

    #[test]
    fn mcp_builtin_enable_repairs_old_managed_slack_config() {
        let writable = json!({
            "mcpServers": {
                "slack": {
                    "url": "https://mcp.slack.com/mcp",
                    "auth": "oauth",
                    "_cairn": {
                        "managed": true,
                        "server": "slack"
                    }
                }
            }
        });

        let next = update_builtin_mcp_server(writable, "slack", true).unwrap();

        assert_eq!(
            next["mcpServers"]["slack"]["oauth"]["clientId"],
            json!("3660753192626.8903469228982")
        );
    }

    #[test]
    fn mcp_builtin_disable_refuses_custom_pi_config() {
        let writable = json!({
            "mcpServers": {
                "notion": {
                    "url": "https://custom.example/mcp",
                    "auth": "oauth",
                    "excludeTools": ["search"]
                }
            }
        });

        let err = update_builtin_mcp_server(writable, "notion", false).unwrap_err();

        assert!(err.contains("custom Pi config"));
    }

    #[test]
    fn mcp_builtin_disable_removes_only_cairn_managed_config() {
        let writable = json!({
            "mcpServers": {
                "notion": mcp_server_config("notion").unwrap(),
                "custom": {
                    "url": "https://custom.example/mcp"
                }
            }
        });

        let next = update_builtin_mcp_server(writable, "notion", false).unwrap();

        assert_eq!(
            next,
            json!({
                "mcpServers": {
                    "custom": {
                        "url": "https://custom.example/mcp"
                    }
                }
            })
        );
    }

    #[test]
    fn first_positional_arg_ignores_flags() {
        let args = vec![
            "--dev".to_string(),
            "--".to_string(),
            "relative/project".to_string(),
            "ignored".to_string(),
        ];

        assert_eq!(
            first_positional_arg(args).as_deref(),
            Some("relative/project")
        );
        assert_eq!(
            first_positional_arg(vec!["--dev".to_string(), "--verbose".to_string()]),
            None
        );
    }

    #[test]
    fn startup_project_path_resolves_absolute_paths_without_locating_root() {
        let temp = unique_temp_dir("cairn-rust-locator");
        let project = temp.join("home").join("project");
        let subdir = project.join("src").join("nested");
        fs::create_dir_all(project.join(".cairn")).unwrap();
        fs::create_dir_all(&subdir).unwrap();

        assert_eq!(resolve_startup_project_path(&subdir).unwrap(), subdir);
    }

    #[test]
    fn startup_project_path_keeps_missing_paths_for_sidecar_error_reporting() {
        let temp = unique_temp_dir("cairn-rust-missing-path");
        let missing = temp.join("missing");

        assert_eq!(resolve_startup_project_path(&missing).unwrap(), missing);
    }

    #[test]
    fn bug_report_bundle_includes_cairn_dir_and_json_files() {
        let temp = unique_temp_dir("cairn-bug-report-fixture");
        let project = temp.join("project");
        fs::create_dir_all(project.join(".cairn").join("sessions")).unwrap();
        fs::write(
            project.join(".cairn").join("sessions").join("0.jsonl"),
            "{}\n",
        )
        .unwrap();
        fs::write(
            project.join(".cairn").join("project.json"),
            "{\"name\":\"Demo\"}",
        )
        .unwrap();

        let zip_path = create_bug_report_bundle(
            Some(project.as_path()),
            "[{\"type\":\"tool_start\"}]",
            "{\"title\":\"Bug\"}",
            1_777_000_001,
        )
        .unwrap();

        assert_eq!(
            zip_entries(&zip_path),
            vec![
                "cairn/project.json",
                "cairn/sessions/0.jsonl",
                "dev-events.json",
                "meta.json",
            ]
        );
        let _ = fs::remove_file(zip_path);
    }

    #[test]
    fn bug_report_bundle_without_project_only_includes_json_files() {
        let zip_path =
            create_bug_report_bundle(None, "[]", "{\"title\":\"Startup\"}", 1_777_000_002).unwrap();

        assert_eq!(zip_entries(&zip_path), vec!["dev-events.json", "meta.json"]);
        let _ = fs::remove_file(zip_path);
    }

    #[test]
    fn bug_report_bundle_project_without_cairn_only_includes_json_files() {
        let temp = unique_temp_dir("cairn-bug-report-no-cairn");
        let project = temp.join("project");
        fs::create_dir_all(&project).unwrap();
        let zip_path = create_bug_report_bundle(
            Some(project.as_path()),
            "[]",
            "{\"title\":\"Missing\"}",
            1_777_000_003,
        )
        .unwrap();

        assert_eq!(zip_entries(&zip_path), vec!["dev-events.json", "meta.json"]);
        let _ = fs::remove_file(zip_path);
    }

    #[test]
    fn bug_report_bundle_writes_zip_to_requested_output_dir() {
        let temp = unique_temp_dir("cairn-bug-report-output-dir");
        let output_dir = temp.join("Downloads");
        fs::create_dir_all(&output_dir).unwrap();
        let zip_path = create_bug_report_bundle_in_dir(
            None,
            "[]",
            "{\"title\":\"Output\"}",
            1_777_000_004,
            &output_dir,
        )
        .unwrap();

        assert_eq!(zip_path, output_dir.join("cairn-bug-1777000004.zip"));
        assert_eq!(zip_entries(&zip_path), vec!["dev-events.json", "meta.json"]);
        let _ = fs::remove_file(zip_path);
    }

    fn zip_entries(path: &Path) -> Vec<String> {
        let output = std::process::Command::new("/usr/bin/unzip")
            .arg("-Z1")
            .arg(path)
            .output()
            .unwrap();
        assert!(output.status.success());
        let mut entries = String::from_utf8(output.stdout)
            .unwrap()
            .lines()
            .filter(|entry| !entry.ends_with('/'))
            .map(str::to_string)
            .collect::<Vec<_>>();
        entries.sort();
        entries
    }

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "{}-{}",
            prefix,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let startup_project_path = match startup_project_path_from_args() {
        Ok(path) => path,
        Err(err) => {
            eprintln!("[startup:args] {}", err);
            None
        }
    };
    let sidecar_state = Arc::new(SidecarState {
        startup_project_path: StdMutex::new(startup_project_path),
        ..SidecarState::default()
    });

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(sidecar_state.clone())
        .invoke_handler(tauri::generate_handler![
            send_prompt,
            new_project,
            open_project,
            open_project_dialog,
            list_recents,
            get_active_project,
            get_cairn_settings,
            get_mcp_settings,
            set_mcp_server_enabled,
            authenticate_mcp_server,
            set_anthropic_api_key,
            get_sidecar_status,
            get_sidecar_dev_logs,
            read_project_file,
            bug_report_bundler
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
