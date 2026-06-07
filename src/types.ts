export type TargetType = "program" | "shortcut" | "folder";
export type LaunchMode = "single" | "double";

export interface WindowSize {
  width: number;
  height: number;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  order: number;
}

export interface LauncherItem {
  id: string;
  name: string;
  path: string;
  args: string;
  targetType: TargetType;
  categoryId: string;
  iconPath?: string;
  searchKey: string;
  order: number;
  launchCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface LauncherSettings {
  hotkey: string;
  closeToTray: boolean;
  autoStart: boolean;
  autoHideAfterLaunch: boolean;
  autoHideOnBlur: boolean;
  autoSortByLaunchCount: boolean;
  launchMode: LaunchMode;
  windowSize?: WindowSize;
}

export interface LauncherData {
  version: number;
  categories: Category[];
  items: LauncherItem[];
  settings: LauncherSettings;
}

export interface DataEnvelope {
  data: LauncherData;
  dataPath: string;
  writable: boolean;
  message?: string;
}

export interface ResolvedTarget {
  path: string;
  args: string;
  targetType: TargetType;
}

export interface ItemDraft {
  id?: string;
  name: string;
  path: string;
  args: string;
  targetType: TargetType;
  categoryId: string;
  iconPath?: string;
}
