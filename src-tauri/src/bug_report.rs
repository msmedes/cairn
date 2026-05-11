use std::fs;
use std::path::{Path, PathBuf};

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

// Bug report bundles shell out to the system zip tools so the generated archive
// is readable by GitHub issue reporters without adding a Rust zip dependency.
const ZIP_COMMAND_PATH: &str = "/usr/bin/zip";
#[cfg(test)]
pub(crate) const UNZIP_COMMAND_PATH: &str = "/usr/bin/unzip";

fn bug_report_error(stage: &str, err: impl std::fmt::Display) -> String {
    format!("bug_report_bundle:{stage}:{err}")
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

pub(crate) fn create_bug_report_bundle_in_dir(
    project_path: Option<&Path>,
    dev_events_json: &str,
    meta_json: &str,
    unix_seconds: u64,
    output_dir: &Path,
) -> Result<PathBuf, String> {
    let bundle_name = format!("cairn-bug-{unix_seconds}");
    let temp_dir = std::env::temp_dir();
    let staging_dir = temp_dir.join(&bundle_name);
    fs::create_dir_all(output_dir).map_err(|err| bug_report_error("create_output_dir", err))?;
    let zip_path = output_dir.join(format!("{bundle_name}.zip"));

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

    let output = std::process::Command::new(ZIP_COMMAND_PATH)
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
pub(crate) fn create_bug_report_bundle(
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
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri command handlers receive framework-owned arguments."
)]
pub(crate) fn bug_report_bundler(
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
