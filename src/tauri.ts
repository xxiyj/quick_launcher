import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { DataEnvelope, LauncherData, ResolvedTarget, TargetType } from "./types";

const isTauri = "__TAURI_INTERNALS__" in window;

export function assetUrl(path?: string): string | undefined {
  if (!path) return undefined;
  return isTauri ? convertFileSrc(path) : undefined;
}

export async function loadData(): Promise<DataEnvelope> {
  if (!isTauri) {
    return {
      writable: true,
      dataPath: "browser-preview",
      data: {
        version: 1,
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
          launchMode: "single",
        },
      },
    };
  }
  return invoke<DataEnvelope>("load_data");
}

export async function saveData(data: LauncherData): Promise<void> {
  if (!isTauri) return;
  await invoke("save_data", { data });
}

export async function chooseTarget(targetType: TargetType): Promise<string | null> {
  if (!isTauri) return null;
  return invoke<string | null>("choose_target", { targetType });
}

export async function resolveTarget(path: string): Promise<ResolvedTarget> {
  if (!isTauri) {
    return { path, args: "", targetType: path.toLowerCase().endsWith(".lnk") ? "shortcut" : "program" };
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
