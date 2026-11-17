//! Tauri commands. Everything the webview can ask of the system is listed in
//! [`run`]; the HTTP and storage logic itself lives in `zman-core`.
//!
//! The webview is given no file-system or dialog permissions. File pickers
//! are opened from here, and a picked file is read or written here, so the
//! page can only touch files a person chose in a native dialog.

use std::path::{Path, PathBuf};

use base64::Engine as _;
use serde::Serialize;
use tauri::{Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use zman_core::http::{HttpEngine, HttpError, RequestSpec, ResponseBody, ResponseData};
use zman_core::storage::{Kind, Store};

struct AppState {
    http: HttpEngine,
    store: Store,
}

#[tauri::command]
async fn http_send(
    state: State<'_, AppState>,
    id: String,
    spec: RequestSpec,
) -> Result<ResponseData, HttpError> {
    state.http.send(&id, spec).await
}

#[tauri::command]
fn http_cancel(state: State<'_, AppState>, id: String) -> bool {
    state.http.cancel(&id)
}

#[tauri::command]
fn http_clear_cookies(state: State<'_, AppState>) {
    state.http.clear_cookies();
}

fn kind(text: &str) -> Result<Kind, String> {
    text.parse()
        .map_err(|e: zman_core::storage::StoreError| e.to_string())
}

#[tauri::command(async)]
fn store_list(state: State<'_, AppState>, kind: String) -> Result<Vec<String>, String> {
    state
        .store
        .list(self::kind(&kind)?)
        .map_err(|e| e.to_string())
}

#[tauri::command(async)]
fn store_read(
    state: State<'_, AppState>,
    kind: String,
    id: String,
) -> Result<Option<String>, String> {
    state
        .store
        .read(self::kind(&kind)?, &id)
        .map_err(|e| e.to_string())
}

#[tauri::command(async)]
fn store_write(
    state: State<'_, AppState>,
    kind: String,
    id: String,
    contents: String,
) -> Result<(), String> {
    state
        .store
        .write(self::kind(&kind)?, &id, &contents)
        .map_err(|e| e.to_string())
}

#[tauri::command(async)]
fn store_delete(state: State<'_, AppState>, kind: String, id: String) -> Result<(), String> {
    state
        .store
        .delete(self::kind(&kind)?, &id)
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct PickedFile {
    name: String,
    contents: String,
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Lets the person choose files to import and returns their contents.
#[tauri::command(async)]
fn import_pick_files(window: WebviewWindow) -> Result<Vec<PickedFile>, String> {
    let picked = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Import")
        .add_filter("JSON", &["json"])
        .add_filter("All files", &["*"])
        .blocking_pick_files()
        .unwrap_or_default();

    let mut files = Vec::new();
    for file in picked {
        let path: PathBuf = file.into_path().map_err(|e| e.to_string())?;
        let contents = std::fs::read_to_string(&path)
            .map_err(|e| format!("Could not read {}: {e}", path.display()))?;
        files.push(PickedFile {
            name: file_name(&path),
            contents,
        });
    }
    Ok(files)
}

/// Returns the path of a file chosen for a form field or a binary body. The
/// file is only read later, by the HTTP engine, when the request is sent.
#[tauri::command(async)]
fn pick_file_path(window: WebviewWindow) -> Result<Option<String>, String> {
    let Some(file) = window
        .dialog()
        .file()
        .set_parent(&window)
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

fn save_with_dialog(
    window: &WebviewWindow,
    default_name: &str,
    bytes: &[u8],
) -> Result<Option<String>, String> {
    let Some(file) = window
        .dialog()
        .file()
        .set_parent(window)
        .set_file_name(default_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| format!("Could not write {}: {e}", path.display()))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Asks where to save, then writes the text. Returns the chosen path, or
/// `None` if the dialog was cancelled.
#[tauri::command(async)]
fn export_save_file(
    window: WebviewWindow,
    default_name: String,
    contents: String,
) -> Result<Option<String>, String> {
    save_with_dialog(&window, &default_name, contents.as_bytes())
}

#[tauri::command(async)]
fn save_response_body(
    window: WebviewWindow,
    default_name: String,
    body: ResponseBody,
) -> Result<Option<String>, String> {
    let bytes = match body {
        ResponseBody::Text { text } => text.into_bytes(),
        ResponseBody::Base64 { data } => base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|e| format!("The response body is not valid base64: {e}"))?,
    };
    save_with_dialog(&window, &default_name, &bytes)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    data_dir: String,
}

#[tauri::command]
fn app_info(app: tauri::AppHandle, state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: state.store.root().to_string_lossy().into_owned(),
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            app.manage(AppState {
                http: HttpEngine::new(),
                store: Store::new(data_dir),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            http_send,
            http_cancel,
            http_clear_cookies,
            store_list,
            store_read,
            store_write,
            store_delete,
            import_pick_files,
            pick_file_path,
            export_save_file,
            save_response_body,
            app_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running zman");
}
