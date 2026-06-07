#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};
#[cfg(windows)]
use std::{
    ffi::{OsStr, OsString},
    mem::size_of,
    os::windows::ffi::{OsStrExt, OsStringExt},
};
use tauri::{
    menu::{Menu, MenuItem},
    PhysicalSize,
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
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
            CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile,
            CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READ,
        },
        System::Registry::{
            RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegSetValueExW, HKEY_CURRENT_USER,
            KEY_SET_VALUE, REG_SZ,
        },
        UI::{
            Shell::{
                IShellLinkW, SHGetFileInfoW, SHFILEINFOW, ShellExecuteW, ShellLink, SHGFI_ICON,
                SHGFI_LARGEICON, SLGP_UNCPRIORITY,
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
    name: String,
    path: String,
    args: String,
    target_type: TargetType,
    category_id: String,
    icon_path: Option<String>,
    search_key: String,
    order: u32,
    #[serde(default)]
    launch_count: u32,
    created_at: String,
    updated_at: String,
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
    #[serde(default = "default_launch_mode")]
    launch_mode: LaunchMode,
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

struct AppState {
    data_path: PathBuf,
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    if let Some(window) = app.get_webview_window("main") {
                        let visible = window.is_visible().unwrap_or(false);
                        if visible {
                            let _ = window.hide();
                        } else {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            let data_path = data_path();
            app.manage(Mutex::new(AppState { data_path }));
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
            save_window_size
        ])
        .run(tauri::generate_context!())
        .expect("error while running Quick Launcher");
}

fn default_data() -> LauncherData {
    LauncherData {
        version: 1,
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
            launch_mode: LaunchMode::Single,
            window_size: None,
        },
    }
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
    path.parent().unwrap_or_else(|| Path::new(".")).join("icons")
}

fn read_data(path: &Path) -> Result<LauncherData, String> {
    if !path.exists() {
        return Ok(default_data());
    }
    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&text).map_err(|error| error.to_string())
}

fn write_data(path: &Path, data: &LauncherData) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(data).map_err(|error| error.to_string())?;
    fs::write(path, text).map_err(|error| error.to_string())
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

    TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().unwrap())
        .tooltip("Quick Launcher")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { button, .. } = event {
                if button == MouseButton::Left {
                    show_main_window_unchecked(tray.app_handle());
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
                        let _ = window.show();
                        let _ = window.set_focus();
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
    if data.categories.is_empty() {
        data.categories = default_data().categories;
    }

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
fn save_data(app: AppHandle, data: LauncherData) -> Result<(), String> {
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
    };
    Ok(picked.map(|path| path.to_string_lossy().to_string()))
}

fn is_shortcut_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".lnk") || lower.ends_with(".link")
}

fn infer_target_type(path: &str) -> TargetType {
    if Path::new(path).is_dir() {
        TargetType::Folder
    } else if is_shortcut_path(path) {
        TargetType::Shortcut
    } else {
        TargetType::Program
    }
}

#[tauri::command]
fn resolve_target(path: String) -> Result<ResolvedTarget, String> {
    if !is_shortcut_path(&path) {
        return Ok(ResolvedTarget {
            target_type: infer_target_type(&path),
            path,
            args: String::new(),
        });
    }

    match resolve_shortcut_native(&path) {
        Ok((resolved_path, args)) => Ok(ResolvedTarget {
            target_type: infer_target_type(&resolved_path),
            path: resolved_path,
            args,
        }),
        Err(_) => Ok(ResolvedTarget {
            path,
            args: String::new(),
            target_type: TargetType::Shortcut,
        }),
    }
}

#[cfg(not(windows))]
fn resolve_shortcut_native(_path: &str) -> Result<(String, String), String> {
    Err("Shortcut resolution is only available on Windows".into())
}

#[cfg(windows)]
fn resolve_shortcut_native(path: &str) -> Result<(String, String), String> {
    unsafe {
        let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
        let result = (|| {
            let shell_link: IShellLinkW =
                CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
                    .map_err(|error| error.to_string())?;
            let persist_file: IPersistFile = shell_link.cast().map_err(|error| error.to_string())?;
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

#[tauri::command]
fn choose_icon() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .add_filter("图标来源", &["png", "jpg", "jpeg", "ico", "exe", "lnk", "link"])
        .add_filter("程序", &["exe"])
        .add_filter("快捷方式", &["lnk", "link"])
        .add_filter("图片", &["png", "jpg", "jpeg", "ico"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn extract_icon(app: AppHandle, path: String, item_id: String) -> Result<Option<String>, String> {
    match extract_icon_native(&app, &path, &item_id) {
        Ok(icon_path) => Ok(Some(icon_path)),
        Err(_) => Ok(None),
    }
}

#[cfg(not(windows))]
fn extract_icon_native(_app: &AppHandle, _path: &str, _item_id: &str) -> Result<String, String> {
    Err("Native icon extraction is only available on Windows".into())
}

#[cfg(windows)]
fn extract_icon_native(app: &AppHandle, path: &str, item_id: &str) -> Result<String, String> {
    let data_path = state_path(app);
    let dir = icons_dir(&data_path);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let output = dir.join(format!("{item_id}.png"));

    let icon = file_icon(path)?;
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

#[cfg(windows)]
fn wide_path(path: &str) -> Vec<u16> {
    OsStr::new(path).encode_wide().chain(Some(0)).collect()
}

#[cfg(windows)]
fn wide_buffer_to_string(buffer: &[u16]) -> String {
    let len = buffer.iter().position(|value| *value == 0).unwrap_or(buffer.len());
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

#[tauri::command]
fn launch_target(path: String, args: String, target_type: TargetType) -> Result<(), String> {
    launch_target_native(path, args, target_type)
}

#[cfg(windows)]
fn launch_target_native(path: String, args: String, target_type: TargetType) -> Result<(), String> {
    let file = wide_path(&path);
    let params = if matches!(target_type, TargetType::Program) && !args.trim().is_empty() {
        Some(wide_path(args.trim()))
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
            None,
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
            return Err(format!("Open startup registry key failed: {}", open_result.0));
        }

        let result = if enabled {
            let exe = std::env::current_exe().map_err(|error| error.to_string())?;
            let command = format!("\"{}\"", exe.to_string_lossy());
            let data = wide_path(&command);
            let bytes = std::slice::from_raw_parts(
                data.as_ptr() as *const u8,
                data.len() * std::mem::size_of::<u16>(),
            );
            let set_result = RegSetValueExW(key, PCWSTR(value_name.as_ptr()), Some(0), REG_SZ, Some(bytes));
            if set_result.0 == 0 {
                Ok(())
            } else {
                Err(format!("Set startup registry value failed: {}", set_result.0))
            }
        } else {
            let delete_result = RegDeleteValueW(key, PCWSTR(value_name.as_ptr()));
            if delete_result.0 == 0 || delete_result.0 == 2 {
                Ok(())
            } else {
                Err(format!("Delete startup registry value failed: {}", delete_result.0))
            }
        };
        let _ = RegCloseKey(key);
        result
    }
}

#[tauri::command]
fn show_main_window(app: AppHandle) -> Result<(), String> {
    show_main_window_unchecked(&app);
    Ok(())
}

fn show_main_window_unchecked(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn hide_main_window(app: AppHandle) -> Result<(), String> {
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
