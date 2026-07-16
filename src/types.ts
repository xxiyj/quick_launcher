export type TargetType = "program" | "shortcut" | "folder" | "url";
export type LaunchMode = "single" | "double";
export type LaunchScheduleMode = "interval" | "daily";
export type Theme = "light" | "dark";
export type ItemKind = "launcher" | "memo" | "workspaceFolder";

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
  kind: ItemKind;
  name: string;
  path: string;
  args?: string;
  targetType?: TargetType;
  categoryId: string;
  parentId?: string | null;
  iconPath?: string;
  schedule?: LaunchSchedule;
  searchKey: string;
  order: number;
  launchCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface LaunchSchedule {
  enabled: boolean;
  mode: LaunchScheduleMode;
  intervalMinutes: number;
  weekdays: number[];
  dailyTimes: string[];
}

export interface LauncherSettings {
  hotkey: string;
  closeToTray: boolean;
  autoStart: boolean;
  autoHideAfterLaunch: boolean;
  autoHideOnBlur: boolean;
  autoSortByLaunchCount: boolean;
  showCardMeta: boolean;
  launchMode: LaunchMode;
  theme: Theme;
  defaultMemoCategoryId?: string;
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

export interface UpdateInfo {
  version: string;
  notes: string;
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
  parentId?: string | null;
  iconPath?: string;
}

export interface WorkspacePathResult {
  path: string;
}
