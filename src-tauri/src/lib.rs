// Sidecar bridge — owns the bun child process, the JSONL stdio, and the
// Rust-to-frontend event fan-out. Frontend talks to us via Tauri commands;
// we forward to the sidecar; sidecar events come back over `sidecar-event`.

mod bug_report;
mod dev_log;
mod error;

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{absolute, Component, Path, PathBuf};
use std::process::Stdio;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex, MutexGuard as StdMutexGuard};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tokio::io::{AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex as AsyncMutex;

use bug_report::bug_report_bundler;
#[cfg(test)]
use bug_report::{create_bug_report_bundle, create_bug_report_bundle_in_dir, UNZIP_COMMAND_PATH};
use dev_log::format_sidecar_dev_log;
use error::{app_error, command_error, CairnResult};

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
#[expect(
    clippy::struct_excessive_bools,
    reason = "This is a serialized frontend DTO with explicit per-server status flags."
)]
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
const MENU_EVENT: &str = "menu-event";
const SIDECAR_BIN_NAME: &str = "cairn-sidecar";
const MAX_DEV_LOG_EVENTS: usize = 1000;
const CAIRN_MCP_META_KEY: &str = "_cairn";
const SLACK_MCP_CLIENT_ID: &str = "3660753192626.8903469228982";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum McpServer {
    Notion,
    Slack,
}

impl McpServer {
    const fn key(self) -> &'static str {
        match self {
            Self::Notion => "notion",
            Self::Slack => "slack",
        }
    }

    fn config(self) -> serde_json::Value {
        match self {
            Self::Notion => serde_json::json!({
                "url": "https://mcp.notion.com/mcp",
                "auth": "oauth",
                "lifecycle": "lazy",
                CAIRN_MCP_META_KEY: {
                    "managed": true,
                    "server": self.key()
                }
            }),
            Self::Slack => serde_json::json!({
                "url": "https://mcp.slack.com/mcp",
                "auth": "oauth",
                "oauth": {
                    "clientId": SLACK_MCP_CLIENT_ID
                },
                "lifecycle": "lazy",
                CAIRN_MCP_META_KEY: {
                    "managed": true,
                    "server": self.key()
                }
            }),
        }
    }
}

impl FromStr for McpServer {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "notion" => Ok(Self::Notion),
            "slack" => Ok(Self::Slack),
            _ => Err(format!("unsupported MCP server: {value}")),
        }
    }
}

fn cairn_store_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    Ok(PathBuf::from(home).join(".cairn"))
}

fn cairn_settings_path() -> Result<PathBuf, String> {
    Ok(cairn_store_dir()?.join("settings.json"))
}

fn unique_temp_path(path: &Path) -> CairnResult<PathBuf> {
    let file_name = path
        .file_name()
        .ok_or_else(|| app_error("target path has no file name"))?
        .to_string_lossy();
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|err| app_error(format!("failed to create temporary file name: {err}")))?
        .as_nanos();
    Ok(path.with_file_name(format!(".{file_name}.{unique}.tmp")))
}

fn write_json_atomically<T: Serialize>(
    path: &Path,
    value: &T,
    private_permissions: bool,
) -> CairnResult<()> {
    let Some(parent) = path.parent() else {
        return Err(app_error("target path has no parent"));
    };
    fs::create_dir_all(parent)
        .map_err(|err| app_error(format!("failed to ensure JSON file parent: {err}")))?;
    let temp_path = unique_temp_path(path)?;
    let contents = serde_json::to_vec_pretty(value)
        .map_err(|err| app_error(format!("failed to serialize JSON file: {err}")))?;
    let write_result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)
            .map_err(|err| app_error(format!("failed to open temporary JSON file: {err}")))?;

        #[cfg(unix)]
        if private_permissions {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(fs::Permissions::from_mode(0o600))
                .map_err(|err| {
                    app_error(format!(
                        "failed to set private JSON file permissions: {err}"
                    ))
                })?;
        }

        #[cfg(not(unix))]
        let _ = private_permissions;

        file.write_all(&contents)
            .map_err(|err| app_error(format!("failed to write temporary JSON file: {err}")))?;
        file.write_all(b"\n")
            .map_err(|err| app_error(format!("failed to finish temporary JSON file: {err}")))?;
        file.sync_all()
            .map_err(|err| app_error(format!("failed to sync temporary JSON file: {err}")))?;
        fs::rename(&temp_path, path)
            .map_err(|err| app_error(format!("failed to replace JSON file: {err}")))
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }

    write_result
}

fn lock_state<T>(mutex: &StdMutex<T>) -> StdMutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn read_cairn_settings() -> CairnResult<CairnSettings> {
    let path = cairn_settings_path().map_err(app_error)?;
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents)
            .map_err(|err| app_error(format!("failed to parse cairn settings: {err}"))),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(CairnSettings::default()),
        Err(err) => Err(app_error(format!("failed to read cairn settings: {err}"))),
    }
}

fn write_cairn_settings(settings: &CairnSettings) -> CairnResult<()> {
    let path = cairn_settings_path().map_err(app_error)?;
    let Some(parent) = path.parent() else {
        return Err(app_error("cairn settings path has no parent"));
    };
    fs::create_dir_all(parent)
        .map_err(|err| app_error(format!("failed to create .cairn store: {err}")))?;
    write_json_atomically(&path, settings, true)
}

fn cairn_settings_status(settings: &CairnSettings) -> CairnSettingsStatus {
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

fn read_mcp_config() -> CairnResult<serde_json::Value> {
    let path = mcp_config_path().map_err(app_error)?;
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents)
            .map_err(|err| app_error(format!("failed to parse MCP settings: {err}"))),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            Ok(serde_json::json!({ "mcpServers": {} }))
        }
        Err(err) => Err(app_error(format!("failed to read MCP settings: {err}"))),
    }
}

fn read_optional_json_config(path: &Path) -> Option<serde_json::Value> {
    let contents = fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

fn write_mcp_config(config: &serde_json::Value) -> CairnResult<()> {
    let path = mcp_config_path().map_err(app_error)?;
    let Some(parent) = path.parent() else {
        return Err(app_error("MCP settings path has no parent"));
    };
    fs::create_dir_all(parent)
        .map_err(|err| app_error(format!("failed to create Pi agent dir: {err}")))?;
    write_json_atomically(&path, config, false)
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
        .and_then(serde_json::Value::as_bool)
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
    server: McpServer,
) -> (bool, bool, Option<String>) {
    match entries.get(server.key()) {
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
    let (notion_enabled, notion_managed, notion_source) =
        builtin_server_status(&entries, McpServer::Notion);
    let (slack_enabled, slack_managed, slack_source) =
        builtin_server_status(&entries, McpServer::Slack);

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

fn update_builtin_mcp_server(
    mut writable_config: serde_json::Value,
    server: McpServer,
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
        if let Some(existing) = servers.get(server.key()) {
            if !is_cairn_managed_server(existing) {
                return Err(format!(
                    "MCP server \"{}\" already has custom Pi config. Cairn will not overwrite it.",
                    server.key()
                ));
            }
        }
        servers.insert(server.key().to_string(), server.config());
    } else {
        let Some(existing) = servers.get(server.key()) else {
            return Ok(writable_config);
        };
        if !is_cairn_managed_server(existing) {
            return Err(format!(
                "MCP server \"{}\" has custom Pi config. Cairn will not remove it.",
                server.key()
            ));
        }
        servers.remove(server.key());
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
            .map_err(|err| format!("failed to resolve current directory: {err}"))?
            .join(raw_path)
    };
    let absolute =
        absolute(&candidate).map_err(|err| format!("failed to resolve project path: {err}"))?;
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
            .map_err(|e| format!("resolve resource dir: {e}"))?;
        let exe_dir = std::env::current_exe()
            .map_err(|e| format!("resolve current_exe: {e}"))?
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

fn record_error(state: &SidecarState, message: impl Into<String>, app: &AppHandle) {
    let message = message.into();
    log::error!(target: "cairn::sidecar", "{message}");
    state.ready.store(false, Ordering::Release);
    *lock_state(&state.last_error) = Some(message.clone());
    let _ = app.emit(
        SIDECAR_EVENT,
        serde_json::json!({ "type": "error", "message": message }),
    );
}

async fn write_json_line<W: AsyncWrite + Unpin>(
    writer: &mut W,
    value: &Value,
) -> Result<(), String> {
    let line = format!("{value}\n");
    writer
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("write to sidecar: {e}"))?;
    writer
        .flush()
        .await
        .map_err(|e| format!("flush sidecar stdin: {e}"))?;
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
    *lock_state(&state.active_project) = None;
    *lock_state(&state.last_hydrate) = Some(vec![]);
    lock_state(&state.last_dev_logs).clear();
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
            .map_err(|err| format!("failed to open folder picker: {err}"))?;

        if !output.status.success() {
            return Ok(None);
        }

        let path = String::from_utf8(output.stdout)
            .map_err(|err| format!("folder picker returned invalid text: {err}"))?
            .trim()
            .to_string();
        Ok((!path.is_empty()).then_some(path))
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
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri command handlers receive framework-owned State values."
)]
fn get_sidecar_status(state: State<'_, Arc<SidecarState>>) -> SidecarStatus {
    let error = lock_state(&state.last_error).clone();
    let project_open_error = lock_state(&state.last_project_open_error).clone();
    let hydrate = lock_state(&state.last_hydrate).clone();
    let active_project = lock_state(&state.active_project).clone();
    let recents = lock_state(&state.last_recents).clone();
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
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri command handlers receive framework-owned State values."
)]
fn get_active_project(state: State<'_, Arc<SidecarState>>) -> Option<ActiveProject> {
    lock_state(&state.active_project).clone()
}

#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri command handlers receive framework-owned State values."
)]
fn get_sidecar_dev_logs(state: State<'_, Arc<SidecarState>>) -> Vec<Value> {
    lock_state(&state.last_dev_logs).clone()
}

#[tauri::command]
fn get_cairn_settings() -> Result<CairnSettingsStatus, String> {
    read_cairn_settings()
        .map(|settings| cairn_settings_status(&settings))
        .map_err(command_error)
}

#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri command handlers receive framework-owned arguments."
)]
fn get_mcp_settings(
    project_path: Option<String>,
    state: State<'_, Arc<SidecarState>>,
) -> Result<McpSettingsStatus, String> {
    let project_path = project_path
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            lock_state(&state.active_project)
                .clone()
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
    let server = McpServer::from_str(&server)?;
    let project_path = lock_state(&state.active_project)
        .clone()
        .map(|project| PathBuf::from(project.path));
    let config =
        update_builtin_mcp_server(read_mcp_config().map_err(command_error)?, server, enabled)?;

    write_mcp_config(&config).map_err(command_error)?;
    let payload = serde_json::json!({ "type": "reload_mcp_config" });
    write_line(&state.stdin, &payload).await?;
    mcp_settings_status(project_path.as_deref())
}

#[tauri::command]
async fn authenticate_mcp_server(
    server: String,
    state: State<'_, Arc<SidecarState>>,
) -> Result<(), String> {
    let server = McpServer::from_str(&server)?;
    let config =
        update_builtin_mcp_server(read_mcp_config().map_err(command_error)?, server, true)?;
    write_mcp_config(&config).map_err(command_error)?;
    let payload = serde_json::json!({
        "type": "authenticate_mcp_server",
        "server": server.key()
    });
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
    write_cairn_settings(&settings).map_err(command_error)?;

    let payload = serde_json::json!({
        "type": "set_api_key",
        "provider": "anthropic",
        "apiKey": trimmed,
    });
    write_line(&state.stdin, &payload).await?;

    Ok(cairn_settings_status(&settings))
}

#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri command handlers receive framework-owned arguments."
)]
fn read_project_file(name: String, state: State<'_, Arc<SidecarState>>) -> Result<String, String> {
    let Some(active_project) = lock_state(&state.active_project).clone() else {
        return Ok(String::new());
    };
    let path = project_file_path(&name, &active_project)?;
    if path.is_dir() {
        let mut entries = fs::read_dir(&path)
            .map_err(|err| format!("failed to read project directory {name}: {err}"))?
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
        Err(err) => Err(format!("failed to read project file {name}: {err}")),
    }
}

fn reset_sidecar_state(state: &SidecarState) {
    state.ready.store(false, Ordering::Release);
    *lock_state(&state.last_error) = None;
    *lock_state(&state.last_hydrate) = None;
    *lock_state(&state.active_project) = None;
    lock_state(&state.last_recents).clear();
    *lock_state(&state.last_project_open_error) = None;
    lock_state(&state.last_dev_logs).clear();
}

fn build_sidecar_command(paths: &ResolvedPaths) -> Command {
    let mut command = match &paths.spawn {
        SpawnTarget::BunScript(script) => {
            let mut command = Command::new("bun");
            command.arg("run").arg(script);
            command
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

    command
}

fn sidecar_spawn_label(spawn: &SpawnTarget) -> &'static str {
    match spawn {
        SpawnTarget::BunScript(_) => "bun in PATH?",
        SpawnTarget::Binary(_) => "bundled sidecar binary missing?",
    }
}

async fn handle_ready_event(app: &AppHandle, state: &Arc<SidecarState>) {
    state.ready.store(true, Ordering::Release);
    *lock_state(&state.last_error) = None;
    let startup_project_path = lock_state(&state.startup_project_path).take();
    if let Some(path) = startup_project_path {
        let payload = serde_json::json!({
            "type": "open_project",
            "path": path.to_string_lossy(),
            "locateProjectRoot": true,
        });
        if let Err(err) = write_line(&state.stdin, &payload).await {
            record_error(state, format!("failed to open startup project: {err}"), app);
        }
    }
}

async fn handle_sidecar_stdout_value(value: Value, app: &AppHandle, state: &Arc<SidecarState>) {
    match value.get("type").and_then(Value::as_str) {
        Some("ready") => {
            handle_ready_event(app, state).await;
        }
        Some("error") => {
            let recoverable = value
                .get("recoverable")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            if !recoverable {
                state.ready.store(false, Ordering::Release);
            }
            if let Some(message) = value.get("message").and_then(Value::as_str) {
                if recoverable {
                    *lock_state(&state.last_project_open_error) = Some(message.to_string());
                } else {
                    *lock_state(&state.last_error) = Some(message.to_string());
                }
            }
        }
        Some("hydrate") => {
            if let Some(messages) = value.get("messages") {
                if let Ok(parsed) = serde_json::from_value::<Vec<HydratedMessage>>(messages.clone())
                {
                    *lock_state(&state.last_hydrate) = Some(parsed);
                }
            }
        }
        Some("active_project") => {
            if let Ok(parsed) = serde_json::from_value::<ActiveProjectEvent>(value.clone()) {
                *lock_state(&state.active_project) = Some(parsed.project);
                *lock_state(&state.last_project_open_error) = None;
            }
        }
        Some("recents") => {
            if let Ok(parsed) = serde_json::from_value::<RecentsEvent>(value.clone()) {
                *lock_state(&state.last_recents) = parsed.entries;
            }
        }
        _ => {}
    }
    let _ = app.emit(SIDECAR_EVENT, value);
}

fn spawn_stdout_forwarder(app: AppHandle, state: Arc<SidecarState>, stdout: ChildStdout) {
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
                        Ok(value) => handle_sidecar_stdout_value(value, &app, &state).await,
                        Err(_) => {
                            log::warn!(target: "cairn::sidecar", "non-json stdout: {trimmed}");
                        }
                    }
                }
                Ok(None) => {
                    record_error(&state, "sidecar exited unexpectedly", &app);
                    break;
                }
                Err(err) => {
                    record_error(&state, format!("sidecar stdout error: {err}"), &app);
                    break;
                }
            }
        }
    });
}

fn handle_sidecar_stderr_value(value: Value, app: &AppHandle, state: &SidecarState) {
    let log_line = format_sidecar_dev_log(&value).unwrap_or_else(|| value.to_string());
    log::info!(target: "cairn::sidecar", "{log_line}");
    let mut logs = lock_state(&state.last_dev_logs);
    logs.push(value.clone());
    if logs.len() > MAX_DEV_LOG_EVENTS {
        let drain_count = logs.len() - MAX_DEV_LOG_EVENTS;
        logs.drain(0..drain_count);
    }
    let _ = app.emit(SIDECAR_DEV_EVENT, value);
}

fn spawn_stderr_forwarder(app: AppHandle, state: Arc<SidecarState>, stderr: ChildStderr) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            match serde_json::from_str::<Value>(trimmed) {
                Ok(value) => handle_sidecar_stderr_value(value, &app, &state),
                Err(_) => {
                    log::warn!(target: "cairn::sidecar", "stderr: {trimmed}");
                }
            }
        }
    });
}

async fn spawn_sidecar(app: AppHandle, state: Arc<SidecarState>) -> Result<(), String> {
    let paths = resolve_paths(&app)?;

    reset_sidecar_state(&state);

    let spawn_label = sidecar_spawn_label(&paths.spawn);
    let mut command = build_sidecar_command(&paths);
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
        .map_err(|e| format!("failed to spawn sidecar ({spawn_label}): {e}"))?;

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
            .is_ok_and(|slot| slot.is_some()),
    });
    write_json_line(&mut stdin, &init_payload)
        .await
        .map_err(|e| format!("failed to initialize sidecar: {e}"))?;

    *state.stdin.lock().await = Some(stdin);
    *lock_state(&state.child) = Some(child);

    spawn_stdout_forwarder(app.clone(), state.clone(), stdout);
    spawn_stderr_forwarder(app, state, stderr);

    Ok(())
}

fn install_app_menu(app: &AppHandle) -> tauri::Result<()> {
    let settings_item = MenuItemBuilder::with_id("menu:settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let dev_panel_item = MenuItemBuilder::with_id("menu:dev-panel", "Show Dev Panel")
        .accelerator("CmdOrCtrl+Shift+D")
        .build(app)?;
    let report_bug_item = MenuItemBuilder::with_id("menu:report-bug", "Report a Bug…").build(app)?;

    let app_submenu = SubmenuBuilder::new(app, "Cairn")
        .item(&PredefinedMenuItem::about(app, Some("About Cairn"), None)?)
        .separator()
        .item(&settings_item)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_submenu = SubmenuBuilder::new(app, "View")
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    let window_submenu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    let dev_submenu = SubmenuBuilder::new(app, "Developer")
        .item(&dev_panel_item)
        .build()?;

    let help_submenu = SubmenuBuilder::new(app, "Help")
        .item(&report_bug_item)
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &app_submenu,
            &edit_submenu,
            &view_submenu,
            &window_submenu,
            &dev_submenu,
            &help_submenu,
        ])
        .build()?;

    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let payload = match event.id().as_ref() {
            "menu:settings" => "settings",
            "menu:report-bug" => "report-bug",
            "menu:dev-panel" => "dev-panel",
            _ => return,
        };
        let _ = app.emit(MENU_EVENT, payload);
    });

    Ok(())
}

fn shutdown_sidecar(state: &SidecarState) {
    let mut guard = lock_state(&state.child);
    if let Some(mut child) = guard.take() {
        // start_kill is sync and doesn't await; sufficient to ensure the
        // bun process gets a SIGKILL before the parent exits.
        let _ = child.start_kill();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Runs the Tauri application shell.
///
/// # Panics
///
/// Panics if Tauri cannot build the application from its generated context.
pub fn run() {
    let startup_project_path = match startup_project_path_from_args() {
        Ok(path) => path,
        Err(err) => {
            log::warn!(target: "cairn::startup", "failed to parse startup args: {err}");
            None
        }
    };
    let sidecar_state = Arc::new(SidecarState {
        startup_project_path: StdMutex::new(startup_project_path),
        ..SidecarState::default()
    });

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_opener::init());

    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_mcp_bridge::init());

    let app = builder
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
            install_app_menu(&app_handle)?;
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
                        "cost": { "total": 0.123_456_7 }
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

        let next = update_builtin_mcp_server(writable, McpServer::Notion, true).unwrap();

        assert_eq!(next["mcpServers"]["notion"], McpServer::Notion.config());
    }

    #[test]
    fn mcp_builtin_slack_uses_static_oauth_client_id() {
        let config = McpServer::Slack.config();

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

        let next = update_builtin_mcp_server(writable, McpServer::Slack, true).unwrap();

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

        let err = update_builtin_mcp_server(writable, McpServer::Notion, false).unwrap_err();

        assert!(err.contains("custom Pi config"));
    }

    #[test]
    fn mcp_builtin_disable_removes_only_cairn_managed_config() {
        let writable = json!({
            "mcpServers": {
                "notion": McpServer::Notion.config(),
                "custom": {
                    "url": "https://custom.example/mcp"
                }
            }
        });

        let next = update_builtin_mcp_server(writable, McpServer::Notion, false).unwrap();

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
    fn atomic_json_write_replaces_existing_file() {
        let temp = unique_temp_dir("cairn-atomic-json");
        let path = temp.join("settings.json");

        write_json_atomically(&path, &json!({ "first": true }), false).unwrap();
        write_json_atomically(&path, &json!({ "second": true }), false).unwrap();

        assert_eq!(
            fs::read_to_string(path).unwrap(),
            "{\n  \"second\": true\n}\n"
        );
    }

    #[test]
    fn lock_state_recovers_poisoned_mutex() {
        let value = Arc::new(StdMutex::new(1_u8));
        let poisoned = value.clone();
        let result = std::thread::spawn(move || {
            let _guard = poisoned.lock().unwrap();
            panic!("poison test mutex");
        })
        .join();

        assert!(result.is_err());
        assert_eq!(*lock_state(&value), 1);
    }

    #[cfg(unix)]
    #[test]
    fn private_atomic_json_write_sets_owner_only_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let temp = unique_temp_dir("cairn-private-json");
        let path = temp.join("settings.json");

        write_json_atomically(&path, &json!({ "secret": true }), true).unwrap();

        assert_eq!(
            fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
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
        let output = std::process::Command::new(UNZIP_COMMAND_PATH)
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
