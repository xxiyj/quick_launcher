#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
#[cfg(windows)]
use std::{
    ffi::{OsStr, OsString},
    mem::size_of,
    os::windows::ffi::{OsStrExt, OsStringExt},
};
use std::{
    fs,
    io::{Error as IoError, ErrorKind},
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalSize, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
#[cfg(windows)]
use windows::{
    core::{Interface, PCWSTR},
    Win32::{
        Graphics::Gdi::{
            DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO,
            BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        },
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
            COINIT_APARTMENTTHREADED, STGM_READ,
        },
        System::Registry::{
            RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegSetValueExW, HKEY_CURRENT_USER,
            KEY_SET_VALUE, REG_SZ,
        },
        UI::{
            Shell::{
                IShellLinkW, SHFileOperationW, SHGetFileInfoW, ShellExecuteW, ShellLink,
                FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_SILENT, FO_DELETE, SHFILEINFOW,
                SHFILEOPSTRUCTW, SHGFI_ICON, SHGFI_LARGEICON, SLGP_UNCPRIORITY,
            },
            WindowsAndMessaging::{DestroyIcon, GetIconInfo, ICONINFO, SW_SHOWNORMAL},
        },
    },
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Category {
    id: String,
    name: String,
    color: String,
    order: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LauncherItem {
    id: String,
    #[serde(default = "default_item_kind")]
    kind: ItemKind,
    name: String,
    path: String,
    #[serde(default)]
    args: String,
    #[serde(default)]
    target_type: Option<TargetType>,
    category_id: String,
    #[serde(default)]
    parent_id: Option<String>,
    icon_path: Option<String>,
    search_key: String,
    order: u32,
    #[serde(default)]
    launch_count: u32,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum ItemKind {
    Launcher,
    Memo,
    WorkspaceFolder,
}

fn default_item_kind() -> ItemKind {
    ItemKind::Launcher
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LauncherSettings {
    hotkey: String,
    close_to_tray: bool,
    #[serde(default)]
    auto_start: bool,
    #[serde(default = "default_true")]
    auto_hide_after_launch: bool,
    #[serde(default = "default_true")]
    auto_hide_on_blur: bool,
    #[serde(default = "default_true")]
    auto_sort_by_launch_count: bool,
    #[serde(default = "default_true")]
    show_card_meta: bool,
    #[serde(default = "default_launch_mode")]
    launch_mode: LaunchMode,
    #[serde(default)]
    default_memo_category_id: String,
    #[serde(default)]
    window_size: Option<SavedWindowSize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum LaunchMode {
    Single,
    Double,
}

fn default_launch_mode() -> LaunchMode {
    LaunchMode::Single
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedWindowSize {
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LauncherData {
    version: u32,
    categories: Vec<Category>,
    items: Vec<LauncherItem>,
    settings: LauncherSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum TargetType {
    Program,
    Shortcut,
    Folder,
    Url,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DataEnvelope {
    data: LauncherData,
    data_path: String,
    writable: bool,
    message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolvedTarget {
    path: String,
    args: String,
    target_type: TargetType,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspacePathResult {
    path: String,
}

struct AppState {
    data_path: PathBuf,
    last_shortcut_at: Option<Instant>,
    suppress_blur_hide_until: Option<Instant>,
}

const SHORTCUT_DEBOUNCE: Duration = Duration::from_millis(350);
const BLUR_HIDE_SUPPRESSION: Duration = Duration::from_millis(1500);
const ALL_CATEGORY_ID: &str = "all";

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window_from_external_trigger(app);
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let should_ignore = app
                        .state::<Mutex<AppState>>()
                        .lock()
                        .map(|mut state| {
                            should_ignore_shortcut(&mut state.last_shortcut_at, Instant::now())
                        })
                        .unwrap_or(false);
                    if should_ignore {
                        return;
                    }
                    if let Some(window) = app.get_webview_window("main") {
                        let visible = window.is_visible().unwrap_or(false);
                        let minimized = window.is_minimized().unwrap_or(false);
                        if visible && !minimized {
                            let _ = window.hide();
                        } else {
                            show_main_window_from_external_trigger(app);
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            let data_path = data_path();
            app.manage(Mutex::new(AppState {
                data_path,
                last_shortcut_at: None,
                suppress_blur_hide_until: None,
            }));
            setup_tray(app.handle())?;

            if let Ok(data) = read_data(&state_path(app.handle())) {
                apply_saved_window_size(app.handle(), &data);
                let _ = register_hotkey(app.handle(), &data.settings.hotkey);
            } else {
                let _ = register_hotkey(app.handle(), "Ctrl+Space");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if should_close_to_tray(window.app_handle()) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            choose_target,
            resolve_target,
            choose_icon,
            extract_icon,
            launch_target,
            update_hotkey,
            update_startup,
            show_main_window,
            hide_main_window,
            reveal_data_dir,
            save_window_size,
            create_workspace_folder,
            rename_workspace_folder,
            read_memo,
            save_memo,
            move_workspace_file,
            create_workspace_shortcut,
            recycle_workspace_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running Quick Launcher");
}

fn default_data() -> LauncherData {
    LauncherData {
        version: 2,
        categories: vec![Category {
            id: "default".into(),
            name: "常用".into(),
            color: "#2f80ed".into(),
            order: 0,
        }],
        items: vec![],
        settings: LauncherSettings {
            hotkey: "Ctrl+Space".into(),
            close_to_tray: true,
            auto_start: false,
            auto_hide_after_launch: true,
            auto_hide_on_blur: true,
            auto_sort_by_launch_count: true,
            show_card_meta: true,
            launch_mode: LaunchMode::Single,
            default_memo_category_id: "default".into(),
            window_size: None,
        },
    }
}

fn should_ignore_shortcut(last_shortcut_at: &mut Option<Instant>, now: Instant) -> bool {
    if last_shortcut_at.is_some_and(|last| now.duration_since(last) < SHORTCUT_DEBOUNCE) {
        true
    } else {
        *last_shortcut_at = Some(now);
        false
    }
}

fn should_ignore_blur_hide(suppress_blur_hide_until: Option<Instant>, now: Instant) -> bool {
    suppress_blur_hide_until.is_some_and(|until| now < until)
}

fn data_path() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        .join("launcher-data.json")
}

fn state_path(app: &AppHandle) -> PathBuf {
    app.state::<Mutex<AppState>>()
        .lock()
        .map(|state| state.data_path.clone())
        .unwrap_or_else(|_| data_path())
}

fn icons_dir(path: &Path) -> PathBuf {
    path.parent()
        .unwrap_or_else(|| Path::new("."))
        .join("icons")
}

fn read_data(path: &Path) -> Result<LauncherData, String> {
    if !path.exists() {
        return Ok(default_data());
    }
    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let mut data: LauncherData = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    normalize_data(&mut data);
    Ok(data)
}

fn normalize_data(data: &mut LauncherData) {
    if data.categories.is_empty() {
        data.categories = default_data().categories;
    }

    let fallback_category = data
        .categories
        .first()
        .map(|category| category.id.clone())
        .unwrap_or_else(|| "default".into());
    if !data
        .categories
        .iter()
        .any(|category| category.id == data.settings.default_memo_category_id)
    {
        data.settings.default_memo_category_id = fallback_category.clone();
    }

    for item in &mut data.items {
        if item.category_id != ALL_CATEGORY_ID
            && !data
                .categories
                .iter()
                .any(|category| category.id == item.category_id)
        {
            item.category_id = fallback_category.clone();
        }
    }
    data.version = 2;
}

fn write_data(path: &Path, data: &LauncherData) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(data).map_err(|error| error.to_string())?;
    fs::write(path, text).map_err(|error| error.to_string())
}

fn workspace_root(app: &AppHandle) -> PathBuf {
    state_path(app)
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("launcher-workspace")
}

fn canonical_workspace_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = workspace_root(app);
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    fs::canonicalize(root).map_err(|error| error.to_string())
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    left.to_string_lossy()
        .eq_ignore_ascii_case(&right.to_string_lossy())
}

fn workspace_entry_path(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let root = canonical_workspace_root(app)?;
    let entry = fs::canonicalize(sanitize_path(path)).map_err(|error| error.to_string())?;
    if paths_equal(&entry, &root) || !entry.starts_with(&root) {
        return Err("只能操作应用工作区中的文件".into());
    }
    Ok(entry)
}

fn workspace_parent_path(app: &AppHandle, parent_path: Option<String>) -> Result<PathBuf, String> {
    let root = canonical_workspace_root(app)?;
    let parent = match parent_path {
        Some(path) if !path.trim().is_empty() => workspace_entry_path(app, &path)?,
        _ => root,
    };
    if !parent.is_dir() {
        return Err("目标文件夹不存在".into());
    }
    Ok(parent)
}

fn clean_workspace_name(value: &str) -> Result<String, String> {
    let cleaned = value
        .trim()
        .chars()
        .map(|character| {
            if character.is_control() || "<>:\"/\\|?*".contains(character) {
                ' '
            } else {
                character
            }
        })
        .collect::<String>();
    let cleaned = cleaned
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_end_matches(|character: char| character == '.' || character == ' ')
        .to_string();

    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        return Err("名称不能为空".into());
    }

    let stem = cleaned
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || stem
            .strip_prefix("COM")
            .or_else(|| stem.strip_prefix("LPT"))
            .is_some_and(|suffix| {
                matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            })
    {
        return Err("名称不能使用 Windows 保留设备名".into());
    }

    Ok(cleaned)
}

fn unique_workspace_path(
    parent: &Path,
    requested_name: &str,
    extension: Option<&str>,
    current_path: Option<&Path>,
) -> Result<PathBuf, String> {
    let mut stem = clean_workspace_name(requested_name)?;
    if let Some(extension) = extension {
        let suffix = format!(".{extension}");
        if stem
            .to_ascii_lowercase()
            .ends_with(&suffix.to_ascii_lowercase())
        {
            stem.truncate(stem.len() - suffix.len());
            stem = clean_workspace_name(&stem)?;
        }
    }

    for index in 1..10_000 {
        let name = if index == 1 {
            stem.clone()
        } else {
            format!("{stem} ({index})")
        };
        let file_name = extension
            .map(|extension| format!("{name}.{extension}"))
            .unwrap_or(name);
        let candidate = parent.join(file_name);
        if current_path.is_some_and(|current| paths_equal(&candidate, current))
            || !candidate.exists()
        {
            return Ok(candidate);
        }
    }

    Err("无法生成可用文件名".into())
}

fn workspace_path_result(path: PathBuf) -> WorkspacePathResult {
    WorkspacePathResult {
        path: path.to_string_lossy().to_string(),
    }
}

#[tauri::command]
fn create_workspace_folder(
    app: AppHandle,
    parent_path: Option<String>,
    name: String,
) -> Result<WorkspacePathResult, String> {
    let parent = workspace_parent_path(&app, parent_path)?;
    let output = unique_workspace_path(&parent, &name, None, None)?;
    fs::create_dir(&output).map_err(|error| error.to_string())?;
    Ok(workspace_path_result(output))
}

#[tauri::command]
fn rename_workspace_folder(
    app: AppHandle,
    path: String,
    name: String,
) -> Result<WorkspacePathResult, String> {
    let current = workspace_entry_path(&app, &path)?;
    if !current.is_dir() {
        return Err("目标不是应用工作区文件夹".into());
    }
    let parent = current
        .parent()
        .ok_or_else(|| "无法确定父文件夹".to_string())?;
    let output = unique_workspace_path(parent, &name, None, Some(&current))?;
    if !paths_equal(&current, &output) {
        fs::rename(&current, &output).map_err(|error| error.to_string())?;
    }
    Ok(workspace_path_result(output))
}

#[tauri::command]
fn read_memo(app: AppHandle, path: String) -> Result<String, String> {
    let path = workspace_entry_path(&app, &path)?;
    if path.is_dir()
        || !path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
    {
        return Err("目标不是备忘录文件".into());
    }
    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_memo(
    app: AppHandle,
    path: Option<String>,
    parent_path: Option<String>,
    name: String,
    content: String,
) -> Result<WorkspacePathResult, String> {
    let parent = workspace_parent_path(&app, parent_path)?;
    let output = match path.filter(|path| !path.trim().is_empty()) {
        Some(path) => {
            let current = workspace_entry_path(&app, &path)?;
            if current.is_dir() {
                return Err("目标不是备忘录文件".into());
            }
            let output = unique_workspace_path(&parent, &name, Some("md"), Some(&current))?;
            if !paths_equal(&current, &output) {
                fs::rename(&current, &output).map_err(|error| error.to_string())?;
            }
            output
        }
        None => unique_workspace_path(&parent, &name, Some("md"), None)?,
    };
    fs::write(&output, content).map_err(|error| error.to_string())?;
    Ok(workspace_path_result(output))
}

#[tauri::command]
fn move_workspace_file(
    app: AppHandle,
    path: String,
    destination_path: String,
) -> Result<WorkspacePathResult, String> {
    let source = workspace_entry_path(&app, &path)?;
    if source.is_dir() {
        return Err("只能移动工作区中的文件".into());
    }
    let destination = workspace_entry_path(&app, &destination_path)?;
    if !destination.is_dir() {
        return Err("目标不是文件夹".into());
    }
    let output = move_file_to_directory(&source, &destination)?;
    Ok(workspace_path_result(output))
}

fn move_file_to_directory(source: &Path, destination: &Path) -> Result<PathBuf, String> {
    if !source.is_file() {
        return Err("只能移动工作区中的文件".into());
    }
    if !destination.is_dir() {
        return Err("目标不是文件夹".into());
    }
    let source_parent = source
        .parent()
        .ok_or_else(|| "无法确定父文件夹".to_string())?;
    if paths_equal(source_parent, destination) {
        return Ok(source.to_path_buf());
    }
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "文件名无效".to_string())?;
    let extension = source.extension().and_then(|value| value.to_str());
    let output = unique_workspace_path(destination, stem, extension, None)?;
    fs::rename(source, &output).map_err(|error| error.to_string())?;
    Ok(output)
}

#[tauri::command]
fn create_workspace_shortcut(
    app: AppHandle,
    source_path: String,
    args: String,
    destination_path: Option<String>,
    name: String,
) -> Result<WorkspacePathResult, String> {
    let destination = workspace_parent_path(&app, destination_path)?;

    let source_path = sanitize_path(&source_path);
    if is_shortcut_path(&source_path) || is_internet_shortcut_path(&source_path) {
        if let Ok(managed_shortcut) = workspace_entry_path(&app, &source_path) {
            if managed_shortcut.is_file() {
                return move_file_to_directory(&managed_shortcut, &destination)
                    .map(workspace_path_result);
            }
        }
    }

    if is_url_path(&source_path) {
        let output = unique_workspace_path(&destination, &name, Some("url"), None)?;
        write_internet_shortcut(&source_path, &output)?;
        return Ok(workspace_path_result(output));
    }

    let (target, shortcut_args) = if is_shortcut_path(&source_path) {
        resolve_shortcut_native(&source_path)?
    } else {
        (source_path, args)
    };
    let output = unique_workspace_path(&destination, &name, Some("lnk"), None)?;
    create_shortcut_native(&target, &shortcut_args, &output)?;
    Ok(workspace_path_result(output))
}

fn write_internet_shortcut(url: &str, output: &Path) -> Result<(), String> {
    let url = url.replace('\r', "").replace('\n', "");
    if !is_url_path(&url) {
        return Err("网址必须以 http:// 或 https:// 开头".into());
    }
    fs::write(output, format!("[InternetShortcut]\r\nURL={url}\r\n"))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn recycle_workspace_path(app: AppHandle, path: String) -> Result<bool, String> {
    let root = workspace_root(&app);
    if !root.exists() {
        return Ok(false);
    }
    let root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    let path = PathBuf::from(sanitize_path(&path));
    if !path.exists() {
        return Ok(false);
    }
    let path = fs::canonicalize(path).map_err(|error| error.to_string())?;
    if paths_equal(&path, &root) || !path.starts_with(&root) {
        return Ok(false);
    }
    recycle_path_native(&path)?;
    Ok(true)
}

fn apply_saved_window_size(app: &AppHandle, data: &LauncherData) {
    let Some(size) = &data.settings.window_size else {
        return;
    };
    if size.width < 980 || size.height < 680 {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_size(PhysicalSize::new(size.width, size.height));
    }
}

fn should_close_to_tray(app: &AppHandle) -> bool {
    read_data(&state_path(app))
        .map(|data| data.settings.close_to_tray)
        .unwrap_or(true)
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示/隐藏", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &settings, &quit])?;
    let icon = app.default_window_icon().cloned().ok_or_else(|| {
        tauri::Error::InvalidIcon(IoError::new(
            ErrorKind::NotFound,
            "default window icon is missing",
        ))
    })?;

    TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Quick Launcher")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { button, .. } = event {
                if button == MouseButton::Left {
                    show_main_window_from_external_trigger(tray.app_handle());
                }
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" | "settings" => {
                if let Some(window) = app.get_webview_window("main") {
                    let visible = window.is_visible().unwrap_or(false);
                    if visible && event.id().as_ref() == "show" {
                        let _ = window.hide();
                    } else {
                        show_main_window_from_external_trigger(app);
                    }
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn normalize_hotkey(value: &str) -> String {
    value
        .replace("Control", "Ctrl")
        .replace("CommandOrControl", "Ctrl")
        .replace("CmdOrControl", "Ctrl")
        .replace(' ', "")
}

fn register_hotkey(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let shortcut = normalize_hotkey(hotkey);
    app.global_shortcut()
        .unregister_all()
        .map_err(|error| error.to_string())?;
    app.global_shortcut()
        .register(shortcut.as_str())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn load_data(app: AppHandle) -> Result<DataEnvelope, String> {
    let path = state_path(&app);
    let mut data = read_data(&path)?;
    normalize_data(&mut data);

    let writable = write_data(&path, &data).is_ok();
    let message = if writable {
        None
    } else {
        Some("exe 所在目录不可写，请移动到可写目录或以合适权限运行。".into())
    };

    Ok(DataEnvelope {
        data,
        data_path: path.to_string_lossy().to_string(),
        writable,
        message,
    })
}

#[tauri::command]
fn save_data(app: AppHandle, mut data: LauncherData) -> Result<(), String> {
    normalize_data(&mut data);
    write_data(&state_path(&app), &data)
}

#[tauri::command]
fn choose_target(target_type: TargetType) -> Result<Option<String>, String> {
    let picked = match target_type {
        TargetType::Folder => rfd::FileDialog::new().pick_folder(),
        TargetType::Program => rfd::FileDialog::new()
            .add_filter("程序", &["exe"])
            .add_filter("快捷方式", &["lnk", "link"])
            .pick_file(),
        TargetType::Shortcut => rfd::FileDialog::new()
            .add_filter("快捷方式", &["lnk", "link"])
            .pick_file(),
        TargetType::Url => None,
    };
    Ok(picked.map(|path| path.to_string_lossy().to_string()))
}

fn is_shortcut_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".lnk") || lower.ends_with(".link")
}

fn is_internet_shortcut_path(path: &str) -> bool {
    path.trim().to_ascii_lowercase().ends_with(".url")
}

fn is_url_path(path: &str) -> bool {
    let path = path.trim().to_ascii_lowercase();
    path.starts_with("https://") || path.starts_with("http://")
}

fn sanitize_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        trimmed[1..trimmed.len() - 1].to_string()
    } else {
        trimmed.to_string()
    }
}

fn infer_target_type(path: &str) -> TargetType {
    if is_url_path(path) || is_internet_shortcut_path(path) {
        TargetType::Url
    } else if Path::new(path).is_dir() {
        TargetType::Folder
    } else if is_shortcut_path(path) {
        TargetType::Shortcut
    } else {
        TargetType::Program
    }
}

#[tauri::command]
fn resolve_target(path: String) -> Result<ResolvedTarget, String> {
    let path = sanitize_path(&path);
    if is_url_path(&path) || is_internet_shortcut_path(&path) {
        return Ok(ResolvedTarget {
            target_type: TargetType::Url,
            path,
            args: String::new(),
        });
    }
    if !is_shortcut_path(&path) {
        return Ok(ResolvedTarget {
            target_type: infer_target_type(&path),
            path,
            args: String::new(),
        });
    }

    let (resolved_path, args) = resolve_shortcut_native(&path)?;
    Ok(ResolvedTarget {
        target_type: infer_target_type(&resolved_path),
        path: resolved_path,
        args,
    })
}

#[cfg(not(windows))]
fn resolve_shortcut_native(_path: &str) -> Result<(String, String), String> {
    Err("Shortcut resolution is only available on Windows".into())
}

#[cfg(windows)]
fn resolve_shortcut_native(path: &str) -> Result<(String, String), String> {
    resolve_shortcut_shell_link(path).or_else(|_| resolve_shortcut_wscript(path))
}

#[cfg(windows)]
fn resolve_shortcut_shell_link(path: &str) -> Result<(String, String), String> {
    unsafe {
        let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
        let result = (|| {
            let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
                .map_err(|error| error.to_string())?;
            let persist_file: IPersistFile =
                shell_link.cast().map_err(|error| error.to_string())?;
            let shortcut_path = wide_path(path);
            persist_file
                .Load(PCWSTR(shortcut_path.as_ptr()), STGM_READ)
                .map_err(|error| error.to_string())?;

            let mut target = vec![0u16; 32768];
            shell_link
                .GetPath(&mut target, std::ptr::null_mut(), SLGP_UNCPRIORITY.0 as u32)
                .map_err(|error| error.to_string())?;

            let mut args = vec![0u16; 4096];
            shell_link
                .GetArguments(&mut args)
                .map_err(|error| error.to_string())?;

            let resolved_path = wide_buffer_to_string(&target);
            if resolved_path.trim().is_empty() {
                Err("Shortcut target is empty".into())
            } else {
                Ok((resolved_path, wide_buffer_to_string(&args)))
            }
        })();
        if initialized {
            CoUninitialize();
        }
        result
    }
}

#[cfg(windows)]
fn resolve_shortcut_wscript(path: &str) -> Result<(String, String), String> {
    let escaped_path = path.replace('\'', "''");
    let script = format!(
        "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{escaped_path}'); [Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Output $s.TargetPath; Write-Output $s.Arguments"
    );
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut lines = stdout.lines();
    let resolved_path = lines.next().unwrap_or_default().trim().to_string();
    let args = lines.next().unwrap_or_default().trim().to_string();

    if resolved_path.is_empty() {
        Err("Shortcut target is empty".into())
    } else {
        Ok((resolved_path, args))
    }
}

#[cfg(windows)]
fn create_shortcut_native(target: &str, args: &str, output: &Path) -> Result<(), String> {
    unsafe {
        let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
        let result = (|| {
            let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
                .map_err(|error| error.to_string())?;
            let target_path = wide_path(target);
            shell_link
                .SetPath(PCWSTR(target_path.as_ptr()))
                .map_err(|error| error.to_string())?;

            if !args.trim().is_empty() {
                let arguments = wide_path(args);
                shell_link
                    .SetArguments(PCWSTR(arguments.as_ptr()))
                    .map_err(|error| error.to_string())?;
            }
            if let Some(parent) = Path::new(target).parent() {
                let working_dir = wide_path(&parent.to_string_lossy());
                let _ = shell_link.SetWorkingDirectory(PCWSTR(working_dir.as_ptr()));
            }

            let persist_file: IPersistFile =
                shell_link.cast().map_err(|error| error.to_string())?;
            let output_path = wide_path(&output.to_string_lossy());
            persist_file
                .Save(PCWSTR(output_path.as_ptr()), true)
                .map_err(|error| error.to_string())
        })();
        if initialized {
            CoUninitialize();
        }
        result
    }
}

#[cfg(not(windows))]
fn create_shortcut_native(_target: &str, _args: &str, _output: &Path) -> Result<(), String> {
    Err("Shortcut creation is only available on Windows".into())
}

#[cfg(windows)]
fn recycle_path_native(path: &Path) -> Result<(), String> {
    let mut from = wide_path(&path.to_string_lossy());
    from.push(0);
    let mut operation = SHFILEOPSTRUCTW {
        wFunc: FO_DELETE,
        pFrom: PCWSTR(from.as_ptr()),
        fFlags: (FOF_ALLOWUNDO.0 | FOF_NOCONFIRMATION.0 | FOF_SILENT.0) as u16,
        ..Default::default()
    };
    let result = unsafe { SHFileOperationW(&mut operation) };
    if result != 0 {
        return Err(format!("移入回收站失败：{result}"));
    }
    if operation.fAnyOperationsAborted.as_bool() {
        return Err("已取消移入回收站".into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn recycle_path_native(_path: &Path) -> Result<(), String> {
    Err("Recycle Bin integration is only available on Windows".into())
}

#[tauri::command]
fn choose_icon() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .add_filter(
            "图标来源",
            &["png", "jpg", "jpeg", "ico", "exe", "lnk", "link"],
        )
        .add_filter("程序", &["exe"])
        .add_filter("快捷方式", &["lnk", "link"])
        .add_filter("图片", &["png", "jpg", "jpeg", "ico"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn extract_icon(app: AppHandle, path: String, item_id: String) -> Result<Option<String>, String> {
    let path = sanitize_path(&path);
    match extract_icon_native(&app, &path, &item_id) {
        Ok(icon_path) => Ok(Some(icon_path)),
        Err(_) => Ok(None),
    }
}

#[cfg(not(windows))]
fn split_args(args: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quoted = false;

    for char in args.chars() {
        match char {
            '"' => quoted = !quoted,
            ' ' if !quoted => {
                if !current.is_empty() {
                    parts.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(char),
        }
    }

    if !current.is_empty() {
        parts.push(current);
    }
    parts
}

#[cfg(windows)]
fn extract_icon_native(_app: &AppHandle, _path: &str, _item_id: &str) -> Result<String, String> {
    let data_path = state_path(_app);
    let dir = icons_dir(&data_path);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let output = dir.join(format!("{_item_id}.png"));

    let icon = file_icon(_path)?;
    let result = hicon_to_png(icon, &output);
    unsafe {
        let _ = DestroyIcon(icon);
    }
    result?;

    if output.exists() {
        Ok(output.to_string_lossy().to_string())
    } else {
        Err("Icon extraction did not create an output file".into())
    }
}

#[cfg(not(windows))]
fn extract_icon_native(_app: &AppHandle, _path: &str, _item_id: &str) -> Result<String, String> {
    Err("Native icon extraction is only available on Windows".into())
}

#[cfg(windows)]
fn wide_path(path: &str) -> Vec<u16> {
    OsStr::new(path).encode_wide().chain(Some(0)).collect()
}

#[cfg(windows)]
fn wide_buffer_to_string(buffer: &[u16]) -> String {
    let len = buffer
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(buffer.len());
    OsString::from_wide(&buffer[..len])
        .to_string_lossy()
        .to_string()
}

#[cfg(windows)]
fn file_icon(path: &str) -> Result<windows::Win32::UI::WindowsAndMessaging::HICON, String> {
    let wide = wide_path(path);
    let mut info = SHFILEINFOW::default();
    let result = unsafe {
        SHGetFileInfoW(
            PCWSTR(wide.as_ptr()),
            windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES(0),
            Some(&mut info),
            size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        )
    };

    if result == 0 || info.hIcon.is_invalid() {
        Err("No icon was returned for this file".into())
    } else {
        Ok(info.hIcon)
    }
}

#[cfg(windows)]
fn hicon_to_png(
    icon: windows::Win32::UI::WindowsAndMessaging::HICON,
    output: &Path,
) -> Result<(), String> {
    let mut icon_info = ICONINFO::default();
    unsafe {
        GetIconInfo(icon, &mut icon_info).map_err(|error| error.to_string())?;
    }

    let bitmap_handle = if !icon_info.hbmColor.is_invalid() {
        icon_info.hbmColor
    } else {
        icon_info.hbmMask
    };

    let mut bitmap = BITMAP::default();
    let object_size = unsafe {
        GetObjectW(
            bitmap_handle.into(),
            size_of::<BITMAP>() as i32,
            Some(&mut bitmap as *mut _ as *mut _),
        )
    };
    if object_size == 0 {
        unsafe {
            let _ = DeleteObject(icon_info.hbmColor.into());
            let _ = DeleteObject(icon_info.hbmMask.into());
        }
        return Err("Unable to inspect icon bitmap".into());
    }

    let width = bitmap.bmWidth as u32;
    let height = if icon_info.hbmColor.is_invalid() {
        (bitmap.bmHeight / 2) as u32
    } else {
        bitmap.bmHeight as u32
    };

    if width == 0 || height == 0 {
        unsafe {
            let _ = DeleteObject(icon_info.hbmColor.into());
            let _ = DeleteObject(icon_info.hbmMask.into());
        }
        return Err("Icon bitmap has no size".into());
    }

    let mut bitmap_info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: -(height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };

    let mut bgra = vec![0u8; (width * height * 4) as usize];
    let dc = unsafe { GetDC(None) };
    if dc.is_invalid() {
        unsafe {
            let _ = DeleteObject(icon_info.hbmColor.into());
            let _ = DeleteObject(icon_info.hbmMask.into());
        }
        return Err("Unable to acquire a device context".into());
    }

    let lines = unsafe {
        GetDIBits(
            dc,
            bitmap_handle,
            0,
            height,
            Some(bgra.as_mut_ptr() as *mut _),
            &mut bitmap_info,
            DIB_RGB_COLORS,
        )
    };
    unsafe {
        let _ = ReleaseDC(None, dc);
        let _ = DeleteObject(icon_info.hbmColor.into());
        let _ = DeleteObject(icon_info.hbmMask.into());
    }

    if lines == 0 {
        return Err("Unable to read icon pixels".into());
    }

    for pixel in bgra.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
    if !bgra.chunks_exact(4).any(|pixel| pixel[3] != 0) {
        for pixel in bgra.chunks_exact_mut(4) {
            pixel[3] = 255;
        }
    }

    image::RgbaImage::from_raw(width, height, bgra)
        .ok_or_else(|| "Unable to build icon image".to_string())?
        .save(output)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn launch_target(path: String, args: String, target_type: TargetType) -> Result<(), String> {
    launch_target_native(sanitize_path(&path), args, target_type)
}

#[cfg(windows)]
fn launch_target_native(path: String, args: String, target_type: TargetType) -> Result<(), String> {
    let file = wide_path(&path);
    let params = if matches!(target_type, TargetType::Program) && !args.trim().is_empty() {
        Some(wide_path(args.trim()))
    } else {
        None
    };
    let working_dir = if matches!(target_type, TargetType::Program) {
        Path::new(&path)
            .parent()
            .map(|dir| wide_path(&dir.to_string_lossy()))
    } else {
        None
    };
    let result = unsafe {
        ShellExecuteW(
            None,
            None,
            PCWSTR(file.as_ptr()),
            params
                .as_ref()
                .map(|value| PCWSTR(value.as_ptr()))
                .unwrap_or(PCWSTR::null()),
            working_dir
                .as_ref()
                .map(|value| PCWSTR(value.as_ptr()))
                .unwrap_or(PCWSTR::null()),
            SW_SHOWNORMAL,
        )
    };
    let code = result.0 as isize;
    if code <= 32 {
        Err(format!("ShellExecute failed with code {code}"))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn launch_target_native(path: String, args: String, target_type: TargetType) -> Result<(), String> {
    match target_type {
        TargetType::Folder => {
            Command::new("explorer")
                .arg(path)
                .spawn()
                .map_err(|error| error.to_string())?;
        }
        TargetType::Program => {
            Command::new(path)
                .args(split_args(&args))
                .spawn()
                .map_err(|error| error.to_string())?;
        }
        TargetType::Shortcut => {
            Command::new("cmd")
                .args(["/C", "start", "", &path])
                .spawn()
                .map_err(|error| error.to_string())?;
        }
        TargetType::Url => {
            Command::new("xdg-open")
                .arg(path)
                .spawn()
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn update_hotkey(app: AppHandle, hotkey: String) -> Result<(), String> {
    register_hotkey(&app, &hotkey)
}

#[tauri::command]
fn update_startup(enabled: bool) -> Result<(), String> {
    set_startup_enabled(enabled)
}

#[tauri::command]
fn save_window_size(app: AppHandle, width: u32, height: u32) -> Result<(), String> {
    if width < 980 || height < 680 {
        return Ok(());
    }
    let path = state_path(&app);
    let mut data = read_data(&path)?;
    data.settings.window_size = Some(SavedWindowSize { width, height });
    write_data(&path, &data)
}

#[cfg(not(windows))]
fn set_startup_enabled(_enabled: bool) -> Result<(), String> {
    Err("Startup registration is only available on Windows".into())
}

#[cfg(windows)]
fn set_startup_enabled(enabled: bool) -> Result<(), String> {
    let subkey = wide_path("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    let value_name = wide_path("Quick Launcher");
    let mut key = windows::Win32::System::Registry::HKEY::default();
    unsafe {
        let open_result = RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey.as_ptr()),
            Some(0),
            KEY_SET_VALUE,
            &mut key,
        );
        if open_result.0 != 0 {
            return Err(format!(
                "Open startup registry key failed: {}",
                open_result.0
            ));
        }

        let result = if enabled {
            let exe = std::env::current_exe().map_err(|error| error.to_string())?;
            let command = format!("\"{}\"", exe.to_string_lossy());
            let data = wide_path(&command);
            let bytes = std::slice::from_raw_parts(
                data.as_ptr() as *const u8,
                data.len() * std::mem::size_of::<u16>(),
            );
            let set_result = RegSetValueExW(
                key,
                PCWSTR(value_name.as_ptr()),
                Some(0),
                REG_SZ,
                Some(bytes),
            );
            if set_result.0 == 0 {
                Ok(())
            } else {
                Err(format!(
                    "Set startup registry value failed: {}",
                    set_result.0
                ))
            }
        } else {
            let delete_result = RegDeleteValueW(key, PCWSTR(value_name.as_ptr()));
            if delete_result.0 == 0 || delete_result.0 == 2 {
                Ok(())
            } else {
                Err(format!(
                    "Delete startup registry value failed: {}",
                    delete_result.0
                ))
            }
        };
        let _ = RegCloseKey(key);
        result
    }
}

#[tauri::command]
fn show_main_window(app: AppHandle) -> Result<(), String> {
    show_main_window_from_external_trigger(&app);
    Ok(())
}

fn show_main_window_from_external_trigger(app: &AppHandle) {
    if let Ok(mut state) = app.state::<Mutex<AppState>>().lock() {
        state.suppress_blur_hide_until = Some(Instant::now() + BLUR_HIDE_SUPPRESSION);
    }
    show_main_window_unchecked(app);
}

fn show_main_window_unchecked(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn hide_main_window(app: AppHandle, reason: Option<String>) -> Result<(), String> {
    if reason.as_deref() == Some("blur") {
        let should_ignore = app
            .state::<Mutex<AppState>>()
            .lock()
            .map(|state| should_ignore_blur_hide(state.suppress_blur_hide_until, Instant::now()))
            .unwrap_or(false);
        if should_ignore {
            return Ok(());
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn reveal_data_dir(app: AppHandle) -> Result<(), String> {
    let path = state_path(&app);
    if let Some(parent) = path.parent() {
        Command::new("explorer")
            .arg(parent)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shortcut_debounce_ignores_immediate_repeat() {
        let start = Instant::now();
        let mut last_shortcut_at = None;

        assert!(!should_ignore_shortcut(&mut last_shortcut_at, start));
        assert!(should_ignore_shortcut(
            &mut last_shortcut_at,
            start + SHORTCUT_DEBOUNCE - Duration::from_millis(1)
        ));
        assert!(!should_ignore_shortcut(
            &mut last_shortcut_at,
            start + SHORTCUT_DEBOUNCE
        ));
    }

    #[test]
    fn blur_hide_suppression_expires() {
        let start = Instant::now();
        assert!(should_ignore_blur_hide(
            Some(start + BLUR_HIDE_SUPPRESSION),
            start
        ));
        assert!(!should_ignore_blur_hide(
            Some(start + BLUR_HIDE_SUPPRESSION),
            start + BLUR_HIDE_SUPPRESSION
        ));
    }

    #[test]
    fn legacy_data_migrates_to_workspace_nodes() {
        let mut data: LauncherData = serde_json::from_value(serde_json::json!({
            "version": 1,
            "categories": [{ "id": "current", "name": "当前", "color": "#2f80ed", "order": 0 }],
            "items": [{
                "id": "legacy",
                "name": "Legacy App",
                "path": "C:\\Tools\\legacy.exe",
                "args": "",
                "targetType": "program",
                "categoryId": "missing",
                "searchKey": "legacy",
                "order": 0,
                "createdAt": "2026-01-01T00:00:00.000Z",
                "updatedAt": "2026-01-01T00:00:00.000Z"
            }],
            "settings": {
                "hotkey": "Ctrl+Space",
                "closeToTray": true,
                "autoStart": false,
                "autoHideAfterLaunch": true,
                "autoHideOnBlur": true,
                "autoSortByLaunchCount": true,
                "launchMode": "single"
            }
        }))
        .unwrap();

        normalize_data(&mut data);

        assert_eq!(data.version, 2);
        assert_eq!(data.settings.default_memo_category_id, "current");
        assert!(data.settings.show_card_meta);
        assert_eq!(data.items[0].kind, ItemKind::Launcher);
        assert_eq!(data.items[0].parent_id, None);
        assert_eq!(data.items[0].category_id, "current");
        assert!(matches!(
            data.items[0].target_type,
            Some(TargetType::Program)
        ));
    }

    #[test]
    fn virtual_all_category_is_preserved() {
        let mut data: LauncherData = serde_json::from_value(serde_json::json!({
            "version": 2,
            "categories": [{ "id": "current", "name": "当前", "color": "#2f80ed", "order": 0 }],
            "items": [{
                "id": "ungrouped",
                "kind": "launcher",
                "name": "Ungrouped App",
                "path": "C:\\Tools\\ungrouped.exe",
                "args": "",
                "targetType": "program",
                "categoryId": "all",
                "parentId": null,
                "searchKey": "ungrouped",
                "order": 0,
                "createdAt": "2026-01-01T00:00:00.000Z",
                "updatedAt": "2026-01-01T00:00:00.000Z"
            }],
            "settings": {
                "hotkey": "Ctrl+Space",
                "closeToTray": true,
                "autoStart": false,
                "autoHideAfterLaunch": true,
                "autoHideOnBlur": true,
                "autoSortByLaunchCount": true,
                "launchMode": "single",
                "defaultMemoCategoryId": "current"
            }
        }))
        .unwrap();

        normalize_data(&mut data);

        assert_eq!(data.items[0].category_id, ALL_CATEGORY_ID);
    }

    #[test]
    fn workspace_names_are_sanitized_and_unique() {
        assert_eq!(clean_workspace_name("  项目<>计划  ").unwrap(), "项目 计划");
        assert!(clean_workspace_name("CON").is_err());
        assert!(clean_workspace_name("...").is_err());

        let unique = format!(
            "quick-launcher-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let directory = std::env::temp_dir().join(unique);
        fs::create_dir_all(&directory).unwrap();
        let first = unique_workspace_path(&directory, "会议记录", Some("md"), None).unwrap();
        fs::write(&first, "test").unwrap();
        let second = unique_workspace_path(&directory, "会议记录", Some("md"), None).unwrap();

        assert_eq!(
            first.file_name().and_then(|name| name.to_str()),
            Some("会议记录.md")
        );
        assert_eq!(
            second.file_name().and_then(|name| name.to_str()),
            Some("会议记录 (2).md")
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn workspace_files_move_into_nested_directories() {
        let unique = format!(
            "quick-launcher-move-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let directory = std::env::temp_dir().join(unique);
        let source_directory = directory.join("source");
        let destination_directory = directory.join("destination").join("nested");
        fs::create_dir_all(&source_directory).unwrap();
        fs::create_dir_all(&destination_directory).unwrap();
        let source = source_directory.join("memo.md");
        fs::write(&source, "# test").unwrap();

        let output = move_file_to_directory(&source, &destination_directory).unwrap();

        assert!(!source.exists());
        assert_eq!(fs::read_to_string(&output).unwrap(), "# test");
        assert_eq!(output.parent(), Some(destination_directory.as_path()));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn internet_shortcuts_are_written_as_url_files() {
        let unique = format!(
            "quick-launcher-url-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let directory = std::env::temp_dir().join(unique);
        fs::create_dir_all(&directory).unwrap();
        let output = directory.join("OpenAI.url");

        write_internet_shortcut("https://openai.com", &output).unwrap();

        assert_eq!(
            fs::read_to_string(&output).unwrap(),
            "[InternetShortcut]\r\nURL=https://openai.com\r\n"
        );
        assert!(is_url_path("https://openai.com"));
        assert!(is_internet_shortcut_path("OpenAI.url"));
        fs::remove_dir_all(directory).unwrap();
    }
}
