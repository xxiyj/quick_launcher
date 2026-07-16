import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { DataEnvelope, LauncherData, ResolvedTarget, TargetType, UpdateInfo, WorkspacePathResult } from "./types";

const isTauri = "__TAURI_INTERNALS__" in window;
const browserPreviewDataKey = "quick-launcher-preview-data";

export function assetUrl(path?: string): string | undefined {
  if (!path) return undefined;
  return isTauri ? convertFileSrc(path) : undefined;
}

export async function loadData(): Promise<DataEnvelope> {
  if (!isTauri) {
    const fallback: LauncherData = {
      version: 2,
      categories: [
        { id: "work", name: "工作", color: "#2f80ed", order: 0 },
        { id: "tools", name: "工具", color: "#27ae60", order: 1 },
      ],
      items: [],
      settings: {
        hotkey: "Ctrl+Space",
        closeToTray: true,
        autoStart: false,
        autoHideAfterLaunch: true,
        autoHideOnBlur: true,
        autoSortByLaunchCount: true,
        showCardMeta: true,
        launchMode: "single",
        theme: "light",
        defaultMemoCategoryId: "work",
      },
    };
    try {
      const saved = window.localStorage.getItem(browserPreviewDataKey);
      if (saved) {
        return {
          writable: true,
          dataPath: "browser-preview",
          data: JSON.parse(saved) as LauncherData,
        };
      }
    } catch {
      // Preview can still run when browser storage is unavailable.
    }
    return {
      writable: true,
      dataPath: "browser-preview",
      data: fallback,
    };
  }
  return invoke<DataEnvelope>("load_data");
}

export async function saveData(data: LauncherData): Promise<void> {
  if (!isTauri) {
    window.localStorage.setItem(browserPreviewDataKey, JSON.stringify(data));
    return;
  }
  await invoke("save_data", { data });
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri) return null;
  return invoke<UpdateInfo | null>("check_for_update");
}

export async function installUpdate(version: string): Promise<void> {
  if (!isTauri) return;
  await invoke("install_update", { version });
}

export async function chooseTarget(targetType: TargetType): Promise<string | null> {
  if (!isTauri) return null;
  return invoke<string | null>("choose_target", { targetType });
}

export async function resolveTarget(path: string): Promise<ResolvedTarget> {
  if (!isTauri) {
    const normalized = path.trim().toLowerCase();
    return {
      path,
      args: "",
      targetType: /^https?:\/\//.test(normalized) || normalized.endsWith(".url")
        ? "url"
        : normalized.endsWith(".lnk")
          ? "shortcut"
          : "program",
    };
  }
  return invoke<ResolvedTarget>("resolve_target", { path });
}

export async function chooseIcon(): Promise<string | null> {
  if (!isTauri) return null;
  return invoke<string | null>("choose_icon");
}

export async function extractIcon(path: string, itemId: string): Promise<string | null> {
  if (!isTauri) return null;
  return invoke<string | null>("extract_icon", { path, itemId });
}

export async function launchTarget(path: string, args: string, targetType: TargetType): Promise<void> {
  if (!isTauri) return;
  await invoke("launch_target", { path, args, targetType });
}

export async function updateHotkey(hotkey: string): Promise<void> {
  if (!isTauri) return;
  await invoke("update_hotkey", { hotkey });
}

export async function updateStartup(enabled: boolean): Promise<void> {
  if (!isTauri) return;
  await invoke("update_startup", { enabled });
}

export async function saveWindowSize(width: number, height: number): Promise<void> {
  if (!isTauri) return;
  await invoke("save_window_size", { width, height });
}

export async function showMainWindow(): Promise<void> {
  if (!isTauri) return;
  await invoke("show_main_window");
}

export async function hideMainWindow(reason?: "blur" | "launch"): Promise<void> {
  if (!isTauri) return;
  await invoke("hide_main_window", { reason });
}

export async function revealDataDir(): Promise<void> {
  if (!isTauri) return;
  await invoke("reveal_data_dir");
}

export async function createWorkspaceFolder(parentPath: string | null, name: string): Promise<WorkspacePathResult> {
  if (!isTauri) return { path: `browser-preview/${name}` };
  return invoke<WorkspacePathResult>("create_workspace_folder", { parentPath, name });
}

export async function renameWorkspaceFolder(path: string, name: string): Promise<WorkspacePathResult> {
  if (!isTauri) return { path: path.replace(/[^\\/]+$/, name) };
  return invoke<WorkspacePathResult>("rename_workspace_folder", { path, name });
}

export async function readMemo(path: string): Promise<string> {
  if (!isTauri) return "";
  return invoke<string>("read_memo", { path });
}

export async function saveMemo(
  path: string | null,
  parentPath: string | null,
  name: string,
  content: string,
): Promise<WorkspacePathResult> {
  if (!isTauri) return { path: path ?? `browser-preview/${name}.md` };
  return invoke<WorkspacePathResult>("save_memo", { path, parentPath, name, content });
}

export async function moveWorkspaceFile(path: string, destinationPath: string): Promise<WorkspacePathResult> {
  if (!isTauri) return { path: `${destinationPath}/${path.split(/[\\/]/).pop() ?? path}` };
  return invoke<WorkspacePathResult>("move_workspace_file", { path, destinationPath });
}

export async function createWorkspaceShortcut(
  sourcePath: string,
  args: string,
  destinationPath: string | null,
  name: string,
): Promise<WorkspacePathResult> {
  if (!isTauri) return { path: `${destinationPath ?? "browser-preview"}/${name}.lnk` };
  return invoke<WorkspacePathResult>("create_workspace_shortcut", {
    sourcePath,
    args,
    destinationPath,
    name,
  });
}

export async function recycleWorkspacePath(path: string): Promise<boolean> {
  if (!isTauri) return false;
  return invoke<boolean>("recycle_workspace_path", { path });
}
