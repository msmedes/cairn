use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter};

const MENU_EVENT: &str = "menu-event";

pub(crate) fn install_app_menu(app: &AppHandle) -> tauri::Result<()> {
    let settings_item = MenuItemBuilder::with_id("menu:settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    #[cfg(debug_assertions)]
    let dev_panel_item = MenuItemBuilder::with_id("menu:dev-panel", "Show Dev Panel")
        .accelerator("CmdOrCtrl+Shift+D")
        .build(app)?;
    let cairn_repo_item =
        MenuItemBuilder::with_id("menu:cairn-repo", "Open Cairn Repo on GitHub").build(app)?;
    let report_bug_item = MenuItemBuilder::with_id("menu:report-bug", "Report a Bug…")
        .accelerator("CmdOrCtrl+Shift+B")
        .build(app)?;

    let app_submenu = SubmenuBuilder::new(app, "Cairn")
        .item(&PredefinedMenuItem::about(app, Some("About Cairn"), None)?)
        .separator()
        .item(&settings_item)
        .item(&report_bug_item)
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

    let dev_submenu = SubmenuBuilder::new(app, "Developer");
    #[cfg(debug_assertions)]
    let dev_submenu = dev_submenu.item(&dev_panel_item);
    let dev_submenu = dev_submenu.item(&cairn_repo_item).build()?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &app_submenu,
            &edit_submenu,
            &view_submenu,
            &window_submenu,
            &dev_submenu,
        ])
        .build()?;

    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let payload = match event.id().as_ref() {
            "menu:settings" => "settings",
            "menu:report-bug" => "report-bug",
            "menu:cairn-repo" => "cairn-repo",
            #[cfg(debug_assertions)]
            "menu:dev-panel" => "dev-panel",
            _ => return,
        };
        let _ = app.emit(MENU_EVENT, payload);
    });

    Ok(())
}
