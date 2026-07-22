import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AppWindow,
  ChevronRight,
  Clock3,
  Download,
  Edit3,
  Eye,
  FilePenLine,
  Folder,
  FolderOpen,
  FolderPlus,
  Grid2X2,
  Keyboard,
  Link2,
  Maximize2,
  Minus,
  MousePointer2,
  Moon,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  StickyNote,
  Sun,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import packageJson from "../package.json";
import { buildSearchKey, matchesSearch } from "./search";
import {
  assetUrl,
  backupShortcut,
  checkForUpdate,
  chooseIcon,
  chooseTarget,
  createWorkspaceFolder,
  createWorkspaceShortcut,
  extractIcon,
  hideMainWindow,
  installUpdate,
  launchTarget,
  loadData,
  moveWorkspaceFile,
  openProgramInExplorer,
  openProgramInTerminal,
  readMemo,
  recycleWorkspacePath,
  renameWorkspaceFolder,
  revealDataDir,
  resolveTarget,
  saveData,
  saveMemo,
  saveWindowSize,
  storeIcon,
  updateHotkey,
  updateStartup,
} from "./tauri";
import type { Category, ItemDraft, LauncherData, LauncherItem, LaunchMode, LaunchSchedule, LaunchScheduleMode, TargetType, Theme, UpdateInfo } from "./types";

const COLORS = ["#2f80ed", "#27ae60", "#f2994a", "#eb5757", "#9b51e0", "#00a3a3"];
const APP_VERSION = packageJson.version.replace(/\.0$/, "");
const BLUR_HIDE_DELAY_MS = 150;
const TITLEBAR_BLUR_SUPPRESSION_MS = 1500;
const WINDOW_MOVE_BLUR_SUPPRESSION_MS = 500;
const UPDATE_CHECK_FEEDBACK_MS = 350;
const DEFAULT_HOTKEY = "Alt+R";
const DEFAULT_DAILY_TIME = "08:00";
const INTERVAL_PRESETS = [5, 15, 30, 60];
const WEEKDAYS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 7, label: "周日" },
];

const emptyDraft: ItemDraft = {
  name: "",
  path: "",
  args: "",
  targetType: "program",
  categoryId: "default",
};

interface MemoDraft {
  id?: string;
  name: string;
  content: string;
  path?: string;
  categoryId: string;
  parentId: string | null;
  lockCategory: boolean;
  createdAt?: string;
}

interface FolderDraft {
  id?: string;
  name: string;
  path?: string;
  categoryId: string;
  parentId: string | null;
  lockCategory: boolean;
  createdAt?: string;
}

interface DeleteConfirmation {
  kind: "category" | "node";
  targetId: string;
  title: string;
  description: string;
}

interface CardContextMenuState {
  item: LauncherItem;
  x: number;
  y: number;
}

interface ScheduleDraft extends LaunchSchedule {
  itemId: string;
}

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function localMemoTitle(now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function isValidScheduleTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  return Number(match[1]) < 24 && Number(match[2]) < 60;
}

function normalizeLaunchSchedule(schedule?: LaunchSchedule): LaunchSchedule {
  const intervalMinutes = Math.min(10_080, Math.max(1, Math.floor(Number(schedule?.intervalMinutes) || 30)));
  const weekdays = [...new Set((schedule?.weekdays ?? WEEKDAYS.map((day) => day.value)).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))].sort((a, b) => a - b);
  const dailyTimes = [...new Set((schedule?.dailyTimes ?? []).filter(isValidScheduleTime))].sort();
  return {
    enabled: schedule?.enabled ?? true,
    mode: schedule?.mode === "daily" ? "daily" : "interval",
    intervalMinutes,
    weekdays: weekdays.length ? weekdays : WEEKDAYS.map((day) => day.value),
    dailyTimes: dailyTimes.length ? dailyTimes : [DEFAULT_DAILY_TIME],
  };
}

function localScheduleDay(now: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function localScheduleTime(now: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function localScheduleWeekday(now: Date) {
  return now.getDay() || 7;
}

function nextAvailableScheduleTime(times: string[]) {
  const existing = new Set(times);
  for (const candidate of ["08:00", "12:00", "18:00", "20:30"]) {
    if (!existing.has(candidate)) return candidate;
  }
  for (let minute = 0; minute < 24 * 60; minute += 15) {
    const candidate = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    if (!existing.has(candidate)) return candidate;
  }
  return DEFAULT_DAILY_TIME;
}

function defaultData(): LauncherData {
  return {
    version: 2,
    categories: [{ id: "default", name: "常用", color: "#2f80ed", order: 0 }],
    items: [],
    settings: {
      hotkey: DEFAULT_HOTKEY,
      closeToTray: true,
      autoStart: false,
      autoHideAfterLaunch: true,
      autoHideOnBlur: true,
      autoSortByLaunchCount: true,
      showCardMeta: true,
      launchMode: "single",
      theme: "light",
      defaultMemoCategoryId: "default",
    },
  };
}

function normalizeData(data: LauncherData): LauncherData {
  const defaults = defaultData();
  const categories = data.categories.length ? data.categories : defaults.categories;
  const defaultMemoCategoryId = categories.some((category) => category.id === data.settings.defaultMemoCategoryId)
    ? data.settings.defaultMemoCategoryId
    : categories[0]?.id ?? "default";

  return {
    ...data,
    version: 2,
    categories,
    items: data.items.map((item) => ({
      ...item,
      kind: item.kind ?? "launcher",
      parentId: item.parentId ?? null,
      args: item.args ?? "",
      targetType: item.targetType ?? "program",
      schedule: item.schedule ? normalizeLaunchSchedule(item.schedule) : undefined,
    })),
    settings: {
      ...defaults.settings,
      ...data.settings,
      defaultMemoCategoryId,
    },
  };
}

function inferName(path: string) {
  const clean = path.replace(/[\\/]+$/, "");
  const file = clean.split(/[\\/]/).pop() ?? "";
  return file.replace(/\.(exe|lnk|link)$/i, "") || "新启动项";
}

function isShortcutPath(path: string) {
  return /\.(lnk|link)$/i.test(path);
}

function isUrlPath(path: string) {
  return /^https?:\/\//i.test(path.trim());
}

function isImageIconPath(path: string) {
  return /\.(png|jpe?g|ico)$/i.test(path);
}

function isExtractableIconPath(path: string) {
  return /\.(exe|lnk|link)$/i.test(path);
}

function inferType(path: string): TargetType {
  if (isUrlPath(path) || /\.url$/i.test(path.trim())) return "url";
  if (isShortcutPath(path)) return "shortcut";
  if (/\.exe$/i.test(path)) return "program";
  return "folder";
}

function targetLabel(targetType?: TargetType) {
  if (targetType === "url") return "网址";
  if (targetType === "folder") return "文件夹";
  if (targetType === "shortcut") return "快捷方式";
  return "程序";
}

function isLauncher(item: LauncherItem): item is LauncherItem & { kind: "launcher"; targetType: TargetType; args: string } {
  return item.kind === "launcher" && Boolean(item.targetType);
}

function isWorkspaceFolder(item: LauncherItem | undefined): item is LauncherItem & { kind: "workspaceFolder" } {
  return item?.kind === "workspaceFolder";
}

function itemLabel(item: LauncherItem) {
  if (item.kind === "memo") return "备忘录";
  if (item.kind === "workspaceFolder") return "应用文件夹";
  return targetLabel(item.targetType);
}

function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string) {
  const normalizedPath = path.replace(/\//g, "\\");
  const normalizedOld = oldPrefix.replace(/\//g, "\\").replace(/\\+$/, "");
  const normalizedNew = newPrefix.replace(/\//g, "\\").replace(/\\+$/, "");
  if (normalizedPath.toLowerCase() === normalizedOld.toLowerCase()) return normalizedNew;
  const withSeparator = `${normalizedOld}\\`;
  if (normalizedPath.toLowerCase().startsWith(withSeparator.toLowerCase())) {
    return `${normalizedNew}${normalizedPath.slice(normalizedOld.length)}`;
  }
  return path;
}

function collectDescendantIds(items: LauncherItem[], rootId: string) {
  const ids = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of items) {
      if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
        ids.add(item.id);
        changed = true;
      }
    }
  }
  return ids;
}

function folderPathLabel(folder: LauncherItem, folders: LauncherItem[]) {
  const byId = new Map(folders.map((item) => [item.id, item]));
  const names = [folder.name];
  const seen = new Set<string>([folder.id]);
  let parent = folder.parentId ? byId.get(folder.parentId) : undefined;
  while (parent && !seen.has(parent.id)) {
    names.unshift(parent.name);
    seen.add(parent.id);
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  return names.join(" / ");
}

export default function App() {
  const [data, setData] = useState<LauncherData>(defaultData);
  const [dataPath, setDataPath] = useState("");
  const [status, setStatus] = useState("正在读取启动器数据...");
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [memoDraft, setMemoDraft] = useState<MemoDraft | null>(null);
  const [folderDraft, setFolderDraft] = useState<FolderDraft | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null);
  const [cardContextMenu, setCardContextMenu] = useState<CardContextMenuState | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resizeSaveTimer = useRef<number | undefined>(undefined);
  const pendingBlurHide = useRef<number | undefined>(undefined);
  const ignoreAutoHideUntil = useRef(0);
  const lastSavedWindowSize = useRef<{ width: number; height: number } | undefined>(undefined);
  const intervalScheduleState = useRef(new Map<string, { signature: string; lastRunAt: number }>());
  const dailyScheduleRuns = useRef(new Set<string>());
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const categories = useMemo(
    () => [...data.categories].sort((a, b) => a.order - b.order),
    [data.categories],
  );
  const currentFolder = useMemo(
    () => data.items.find((item) => item.id === currentFolderId && item.kind === "workspaceFolder"),
    [currentFolderId, data.items],
  );
  const modalOpen = Boolean(draft || memoDraft || folderDraft || deleteConfirmation || settingsOpen || scheduleDraft);

  useEffect(() => {
    loadData()
      .then((envelope) => {
        const nextData = normalizeData(envelope.data);
        setData(nextData);
        lastSavedWindowSize.current = nextData.settings.windowSize;
        setDataPath(envelope.dataPath);
        setStatus(envelope.writable ? "已准备好" : envelope.message ?? "数据目录不可写");
        setLoaded(true);
      })
      .catch((error) => {
        setStatus(String(error));
        setLoaded(true);
      });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    setSaving(true);
    const id = window.setTimeout(() => {
      saveData(data)
        .then(() => setStatus("已保存"))
        .catch((error) => setStatus(`保存失败：${String(error)}`))
        .finally(() => setSaving(false));
    }, 250);
    return () => window.clearTimeout(id);
  }, [data, loaded]);

  useEffect(() => {
    if (!loaded) return;
    const checkSchedules = () => {
      const now = new Date();
      const nowMs = now.getTime();
      const time = localScheduleTime(now);
      const day = localScheduleDay(now);
      const weekday = localScheduleWeekday(now);
      const activeIntervalIds = new Set<string>();

      for (const item of data.items) {
        if (!isLauncher(item) || item.targetType === "url" || !item.schedule?.enabled) continue;
        const schedule = normalizeLaunchSchedule(item.schedule);
        if (schedule.mode === "interval") {
          activeIntervalIds.add(item.id);
          const signature = `${schedule.intervalMinutes}`;
          const state = intervalScheduleState.current.get(item.id);
          if (!state || state.signature !== signature) {
            intervalScheduleState.current.set(item.id, { signature, lastRunAt: nowMs });
            continue;
          }
          if (nowMs - state.lastRunAt >= schedule.intervalMinutes * 60_000) {
            state.lastRunAt = nowMs;
            void runItem(item, "scheduled");
          }
          continue;
        }

        if (!schedule.weekdays.includes(weekday) || !schedule.dailyTimes.includes(time)) continue;
        const runKey = `${item.id}:${day}:${time}`;
        if (dailyScheduleRuns.current.has(runKey)) continue;
        dailyScheduleRuns.current.add(runKey);
        void runItem(item, "scheduled");
      }

      for (const id of intervalScheduleState.current.keys()) {
        if (!activeIntervalIds.has(id)) intervalScheduleState.current.delete(id);
      }
      if (dailyScheduleRuns.current.size > 512) {
        const todayPrefix = `:${day}:`;
        dailyScheduleRuns.current = new Set([...dailyScheduleRuns.current].filter((key) => key.includes(todayPrefix)));
      }
    };

    checkSchedules();
    const timer = window.setInterval(checkSchedules, 15_000);
    return () => window.clearInterval(timer);
  }, [data.items, loaded]);

  useEffect(() => {
    if (!cardContextMenu) return;
    const closeMenu = () => setCardContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [cardContextMenu]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;

    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setDragActive(true);
          return;
        }
        if (event.payload.type === "leave") {
          setDragActive(false);
          return;
        }
        setDragActive(false);
        if (event.payload.paths.length > 0) void addDroppedPaths(event.payload.paths);
      })
      .then((cleanup) => {
        unlisten = cleanup;
      })
      .catch((error) => setStatus(`拖动监听失败：${String(error)}`));

    return () => unlisten?.();
  }, [categories, currentFolder, data.items, data.settings.defaultMemoCategoryId, selectedCategory]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const appWindow = getCurrentWindow();
    let cleanup: (() => void) | undefined;

    appWindow
      .onResized(async (event) => {
        if (await appWindow.isMaximized() || await appWindow.isMinimized()) return;
        window.clearTimeout(resizeSaveTimer.current);
        resizeSaveTimer.current = window.setTimeout(() => {
          const windowSize = { width: event.payload.width, height: event.payload.height };
          const saved = lastSavedWindowSize.current;
          if (saved?.width === windowSize.width && saved.height === windowSize.height) return;
          lastSavedWindowSize.current = windowSize;
          setData((current) => ({
            ...current,
            settings: { ...current.settings, windowSize },
          }));
          void saveWindowSize(windowSize.width, windowSize.height);
        }, 500);
      })
      .then((unlisten) => {
        cleanup = unlisten;
      })
      .catch((error) => setStatus(`窗口尺寸监听失败：${String(error)}`));

    return () => {
      window.clearTimeout(resizeSaveTimer.current);
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const appWindow = getCurrentWindow();
    let cleanup: (() => void) | undefined;

    appWindow
      .onMoved(() => {
        // A native titlebar drag can briefly report a blur before the move completes.
        ignoreAutoHideUntil.current = Date.now() + WINDOW_MOVE_BLUR_SUPPRESSION_MS;
        window.clearTimeout(pendingBlurHide.current);
        pendingBlurHide.current = undefined;
      })
      .then((unlisten) => {
        cleanup = unlisten;
      })
      .catch((error) => setStatus(`窗口移动监听失败：${String(error)}`));

    return () => cleanup?.();
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const appWindow = getCurrentWindow();
    let cleanup: (() => void) | undefined;

    function cancelPendingBlurHide() {
      window.clearTimeout(pendingBlurHide.current);
      pendingBlurHide.current = undefined;
    }

    appWindow
      .onFocusChanged((event) => {
        if (event.payload) {
          cancelPendingBlurHide();
          return;
        }
        if (!data.settings.autoHideOnBlur || modalOpen) return;
        if (Date.now() < ignoreAutoHideUntil.current) return;
        cancelPendingBlurHide();
        pendingBlurHide.current = window.setTimeout(() => {
          pendingBlurHide.current = undefined;
          void appWindow
            .isFocused()
            .then((focused) => {
              if (focused || Date.now() < ignoreAutoHideUntil.current) return;
              return hideMainWindow("blur");
            })
            .catch((error) => setStatus(`窗口焦点检查失败：${String(error)}`));
        }, BLUR_HIDE_DELAY_MS);
      })
      .then((unlisten) => {
        cleanup = unlisten;
      })
      .catch((error) => setStatus(`窗口焦点监听失败：${String(error)}`));

    return () => {
      cancelPendingBlurHide();
      cleanup?.();
    };
  }, [data.settings.autoHideOnBlur, modalOpen]);

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false;
      return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (modalOpen || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      if (event.key.length === 1 && /[\p{L}\p{N}]/u.test(event.key)) {
        event.preventDefault();
        setQuery((current) => `${current}${event.key}`);
        requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }
      if (event.key === "Backspace" && query) {
        event.preventDefault();
        setQuery((current) => current.slice(0, -1));
        requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }
      if (event.key === "Escape" && query) {
        event.preventDefault();
        setQuery("");
        requestAnimationFrame(() => searchInputRef.current?.focus());
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modalOpen, query]);

  const visibleItems = useMemo(() => {
    const searching = Boolean(query.trim());
    const scoped = data.items
      .filter((item) => {
        if (searching) return matchesSearch(item.name, item.searchKey, query);
        if (currentFolder) return item.parentId === currentFolder.id;
        return item.parentId == null && (selectedCategory === "all" || item.categoryId === selectedCategory);
      })
      .sort((a, b) => {
        if (data.settings.autoSortByLaunchCount) {
          return (b.launchCount ?? 0) - (a.launchCount ?? 0) || a.order - b.order || a.name.localeCompare(b.name, "zh-Hans-CN");
        }
        return a.order - b.order || a.name.localeCompare(b.name, "zh-Hans-CN");
      });
    return scoped;
  }, [currentFolder, data.items, data.settings.autoSortByLaunchCount, query, selectedCategory]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of data.items) counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1);
    return counts;
  }, [data.items]);

  const breadcrumbs = useMemo(() => {
    const chain: LauncherItem[] = [];
    const seen = new Set<string>();
    let folder = currentFolder;
    while (folder && !seen.has(folder.id)) {
      chain.unshift(folder);
      seen.add(folder.id);
      folder = data.items.find((item) => item.id === folder?.parentId && item.kind === "workspaceFolder");
    }
    return chain;
  }, [currentFolder, data.items]);

  function selectedCategoryId() {
    if (currentFolder) return currentFolder.categoryId;
    if (selectedCategory !== "all") return selectedCategory;
    return categories[0]?.id ?? "default";
  }

  function persist(updater: (value: LauncherData) => LauncherData) {
    setData((current) => updater(current));
  }

  function toggleTheme() {
    const theme = data.settings.theme === "light" ? "dark" : "light";
    persist((current) => ({
      ...current,
      settings: { ...current.settings, theme },
    }));
    setStatus(theme === "dark" ? "已切换为深色模式" : "已切换为浅色模式");
  }

  function selectCategory(id: string) {
    setQuery("");
    setCurrentFolderId(null);
    setSelectedCategory(id);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function enterFolder(folder: LauncherItem) {
    setQuery("");
    setCurrentFolderId(folder.id);
    setSelectedCategory(folder.categoryId);
  }

  function reorderVisibleItems(activeId: string, overId: string) {
    const oldIndex = visibleItems.findIndex((item) => item.id === activeId);
    const newIndex = visibleItems.findIndex((item) => item.id === overId);
    if (oldIndex < 0 || newIndex < 0) return;
    const orderMap = new Map(arrayMove(visibleItems, oldIndex, newIndex).map((item, order) => [item.id, order]));
    persist((current) => ({
      ...current,
      items: current.items.map((item) => (orderMap.has(item.id) ? { ...item, order: orderMap.get(item.id) ?? item.order } : item)),
    }));
  }

  async function moveNodeIntoFolder(source: LauncherItem, destination: LauncherItem) {
    if (!isWorkspaceFolder(destination) || source.kind === "workspaceFolder") return;
    try {
      let result;
      if (source.kind === "memo") {
        result = await moveWorkspaceFile(source.path, destination.path);
      } else if (isLauncher(source)) {
        result = await createWorkspaceShortcut(source.shortcutPath ?? source.path, source.args, destination.path, source.name);
      } else {
        return;
      }

      const now = new Date().toISOString();
      persist((current) => ({
        ...current,
        items: current.items.map((item) => {
          if (item.id !== source.id) return item;
          if (item.kind === "launcher") {
            return {
              ...item,
              path: result.path,
              args: "",
              targetType: item.targetType === "url" ? "url" : "shortcut",
              shortcutPath: undefined,
              parentId: destination.id,
              categoryId: destination.categoryId,
              searchKey: buildSearchKey(item.name, result.path),
              updatedAt: now,
            };
          }
          return {
            ...item,
            path: result.path,
            parentId: destination.id,
            categoryId: destination.categoryId,
            updatedAt: now,
          };
        }),
      }));
      if (isLauncher(source) && source.targetType !== "url") void fillExtractedIcon(result.path, source.id);
      setStatus(`已移入「${destination.name}」`);
    } catch (error) {
      setStatus(`移动失败：${String(error)}`);
    }
  }

  function handleItemDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const rawOverId = event.over ? String(event.over.id) : "";
    const overId = rawOverId.startsWith("folder-drop-") ? rawOverId.slice("folder-drop-".length) : rawOverId;
    if (!overId || activeId === overId) return;
    const source = data.items.find((item) => item.id === activeId);
    const destination = data.items.find((item) => item.id === overId);
    if (!source || !destination) return;

    if (destination.kind === "workspaceFolder" && source.kind !== "workspaceFolder") {
      void moveNodeIntoFolder(source, destination);
      return;
    }
    if (query.trim() || data.settings.autoSortByLaunchCount) return;
    if ((source.parentId ?? null) !== (destination.parentId ?? null)) return;
    reorderVisibleItems(activeId, overId);
  }

  function reorderCategories(activeId: string, overId: string) {
    const oldIndex = categories.findIndex((category) => category.id === activeId);
    const newIndex = categories.findIndex((category) => category.id === overId);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(categories, oldIndex, newIndex).map((category, order) => ({ ...category, order }));
    persist((current) => ({
      ...current,
      categories: current.categories.map((category) => reordered.find((value) => value.id === category.id) ?? category),
    }));
  }

  async function importTarget(path: string) {
    const resolved = await resolveTarget(path);
    return {
      displayName: inferName(isShortcutPath(path) ? path : resolved.path),
      path: resolved.path,
      args: resolved.args,
      targetType: resolved.targetType,
    };
  }

  function instantDraftFromPath(path: string): ItemDraft {
    return {
      ...emptyDraft,
      name: inferName(path),
      path,
      targetType: inferType(path),
      sourceShortcutPath: isShortcutPath(path) ? path : undefined,
      categoryId: selectedCategoryId(),
      parentId: currentFolder?.id ?? null,
    };
  }

  async function hydrateDraftFromPath(originalPath: string) {
    try {
      setStatus("正在解析目标...");
      const imported = await importTarget(originalPath);
      const placeholderName = inferName(originalPath);
      setDraft((current) => {
        if (!current || current.path !== originalPath) return current;
        return {
          ...current,
          name: current.name === placeholderName ? imported.displayName : current.name,
          path: imported.path,
          args: current.args || imported.args,
          targetType: imported.targetType,
        };
      });
      setStatus("目标已解析，请确认后保存");
    } catch (error) {
      setStatus(`目标解析失败，已保留原始路径：${String(error)}`);
    }
  }

  async function fillExtractedIcon(path: string, itemId: string) {
    try {
      const iconPath = (await extractIcon(path, itemId)) ?? undefined;
      if (!iconPath) return;
      setData((current) => ({
        ...current,
        items: current.items.map((item) =>
          item.id === itemId && item.kind === "launcher" && !item.iconPath
            ? { ...item, iconPath, updatedAt: new Date().toISOString() }
            : item,
        ),
      }));
    } catch {
      // Icon extraction is best-effort and should never block adding an item.
    }
  }

  async function hydrateItemFromPath(originalPath: string, itemId: string) {
    try {
      const imported = await importTarget(originalPath);
      const sourceShortcutPath = isShortcutPath(originalPath) ? originalPath : undefined;
      const duplicateBeforeBackup = data.items.some(
        (item) => item.id !== itemId && item.kind === "launcher" && item.path.toLowerCase() === imported.path.toLowerCase(),
      );
      if (duplicateBeforeBackup) {
        setData((current) => ({ ...current, items: current.items.filter((item) => item.id !== itemId) }));
        return;
      }
      const shortcutPath = sourceShortcutPath
        ? (await backupShortcut(sourceShortcutPath, imported.displayName)).path
        : undefined;
      let shouldExtractIcon = false;
      setData((current) => {
        const duplicate = current.items.some(
          (item) => item.id !== itemId && item.kind === "launcher" && item.path.toLowerCase() === imported.path.toLowerCase(),
        );
        if (duplicate) return { ...current, items: current.items.filter((item) => item.id !== itemId) };
        shouldExtractIcon = true;
        return {
          ...current,
          items: current.items.map((item) =>
            item.id === itemId && item.kind === "launcher"
              ? {
                  ...item,
                  name: item.name === inferName(originalPath) ? imported.displayName : item.name,
                  path: imported.path,
                  args: item.args || imported.args,
                  targetType: imported.targetType,
                  shortcutPath,
                  searchKey: buildSearchKey(imported.displayName, `${imported.path} ${imported.args}`),
                  updatedAt: new Date().toISOString(),
                }
              : item,
          ),
        };
      });
      if (shouldExtractIcon) void fillExtractedIcon(imported.path, itemId);
    } catch {
      void fillExtractedIcon(originalPath, itemId);
    }
  }

  async function addDroppedPaths(paths: string[]) {
    const uniquePaths = [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
    if (!uniquePaths.length) return;

    if (uniquePaths.length === 1) {
      const path = uniquePaths[0];
      try {
        setStatus("正在解析拖入目标...");
        const imported = await importTarget(path);
        setDraft({
          ...emptyDraft,
          name: imported.displayName,
          path: imported.path,
          args: imported.args,
          targetType: imported.targetType,
          sourceShortcutPath: isShortcutPath(path) ? path : undefined,
          categoryId: selectedCategoryId(),
          parentId: currentFolder?.id ?? null,
        });
        setStatus("已读取实际目标，请确认后保存");
      } catch {
        setDraft(instantDraftFromPath(path));
        setStatus("已读取拖入目标，请确认后保存");
        void hydrateDraftFromPath(path);
      }
      return;
    }

    const existing = new Set(
      data.items.filter((item) => item.kind === "launcher").map((item) => item.path.toLowerCase()),
    );
    const now = new Date().toISOString();
    const categoryId = selectedCategoryId();
    const additions: LauncherItem[] = [];
    for (const path of uniquePaths) {
      if (existing.has(path.toLowerCase())) continue;
      existing.add(path.toLowerCase());
      const id = newId("item");
      const name = inferName(path);
      additions.push({
        id,
        kind: "launcher",
        name,
        path,
        args: "",
        targetType: inferType(path),
        categoryId,
        parentId: null,
        iconPath: undefined,
        searchKey: buildSearchKey(name, path),
        order: data.items.length + additions.length,
        launchCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (!additions.length) {
      setStatus("拖入的目标已存在");
      return;
    }
    persist((current) => ({ ...current, items: [...current.items, ...additions] }));
    setStatus(`已添加 ${additions.length} 个拖入目标，正在后台解析`);
    additions.forEach((item) => void hydrateItemFromPath(item.path, item.id));
  }

  function addCategory(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const category: Category = {
      id: newId("cat"),
      name: trimmed,
      color: COLORS[data.categories.length % COLORS.length],
      order: data.categories.length,
    };
    persist((current) => ({ ...current, categories: [...current.categories, category] }));
    selectCategory(category.id);
    setStatus("已新建分组");
  }

  function renameCategory(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      setStatus("分组名称不能为空");
      return;
    }
    persist((current) => ({
      ...current,
      categories: current.categories.map((category) => (category.id === id ? { ...category, name: trimmed } : category)),
    }));
    setStatus("分组名称已更新");
  }

  function requestDeleteCategory(id: string) {
    if (data.categories.length <= 1) {
      setStatus("至少保留一个分组");
      return;
    }
    const category = categories.find((value) => value.id === id);
    if (!category) return;
    const itemCount = data.items.filter((item) => item.categoryId === id).length;
    setDeleteConfirmation({
      kind: "category",
      targetId: id,
      title: "删除分组",
      description: `删除「${category.name}」后，其中 ${itemCount} 项内容将移入「全部」。`,
    });
  }

  function deleteCategory(id: string) {
    if (data.categories.length <= 1 || !categories.some((category) => category.id === id)) return;
    const fallback = categories.find((category) => category.id !== id)?.id ?? "default";
    persist((current) => ({
      ...current,
      categories: current.categories.filter((category) => category.id !== id),
      items: current.items.map((item) =>
        item.categoryId === id ? { ...item, categoryId: "all", updatedAt: new Date().toISOString() } : item,
      ),
      settings: {
        ...current.settings,
        defaultMemoCategoryId: current.settings.defaultMemoCategoryId === id ? fallback : current.settings.defaultMemoCategoryId,
      },
    }));
    if (selectedCategory === id) selectCategory("all");
  }

  function openLaunchDraft(item?: LauncherItem) {
    if (item && isLauncher(item)) {
      setDraft({
        id: item.id,
        name: item.name,
        path: item.path,
        args: item.args,
        targetType: item.targetType,
        categoryId: item.categoryId,
        parentId: item.parentId ?? null,
        iconPath: item.iconPath,
        shortcutPath: item.shortcutPath,
      });
      return;
    }
    setDraft({ ...emptyDraft, categoryId: selectedCategoryId(), parentId: currentFolder?.id ?? null });
  }

  function openShortcutDraft() {
    setDraft({ ...emptyDraft, targetType: "shortcut", categoryId: selectedCategoryId(), parentId: currentFolder?.id ?? null });
  }

  async function pickTarget(targetType: TargetType) {
    const path = await chooseTarget(targetType);
    if (!path) return;
    setDraft((current) => ({
      ...(current ?? emptyDraft),
      name: current?.name || inferName(path),
      path,
      targetType: inferType(path),
      sourceShortcutPath: isShortcutPath(path) ? path : undefined,
      shortcutPath: undefined,
      categoryId: current?.categoryId || selectedCategoryId(),
    }));
    try {
      const imported = await importTarget(path);
      setDraft((current) => ({
        ...(current ?? emptyDraft),
        path: imported.path,
        args: current?.args || imported.args,
        name: current?.name || imported.displayName,
        targetType: imported.targetType,
        sourceShortcutPath: isShortcutPath(path) ? path : undefined,
        shortcutPath: undefined,
        categoryId: current?.categoryId || selectedCategoryId(),
      }));
    } catch {
      setStatus("目标解析失败，已保留原始路径");
    }
  }

  async function pickIcon() {
    const path = await chooseIcon();
    if (!path) return;
    try {
      const itemId = draft?.id ?? newId("icon");
      setStatus(isImageIconPath(path) ? "正在保存图标..." : "正在提取图标...");
      const iconPath = await prepareIconPath(path, itemId);
      if (!iconPath) {
        setStatus("没有读取到可用图标");
        return;
      }
      setDraft((current) => ({ ...(current ?? emptyDraft), iconPath }));
      setStatus(isImageIconPath(path) ? "图标已保存到应用目录" : "图标已更新");
    } catch (error) {
      setStatus(`图标处理失败：${String(error)}`);
    }
  }

  async function prepareIconPath(iconPath: string | undefined, itemId: string): Promise<string | undefined> {
    const path = iconPath?.trim();
    if (!path) return undefined;
    if (isExtractableIconPath(path)) {
      const source = isShortcutPath(path) ? (await resolveTarget(path)).path : path;
      const extracted = await extractIcon(source, itemId);
      if (!extracted) throw new Error("没有读取到可用图标");
      return extracted;
    }
    if (!isImageIconPath(path)) throw new Error("图标仅支持 PNG、JPG、JPEG、ICO、EXE 或快捷方式文件");
    return storeIcon(path, itemId);
  }

  async function submitDraft() {
    if (!draft?.name.trim() || !draft.path.trim()) {
      setStatus("名称和路径不能为空");
      return;
    }
    if (draft.targetType === "url" && !isUrlPath(draft.path)) {
      setStatus("网址必须以 http:// 或 https:// 开头");
      return;
    }
    const itemId = draft.id ?? newId("item");
    let iconPath: string | undefined;
    try {
      iconPath = await prepareIconPath(draft.iconPath, itemId);
    } catch (error) {
      setStatus(`保存图标失败：${String(error)}`);
      return;
    }
    const now = new Date().toISOString();
    const existing = draft.id ? data.items.find((item) => item.id === draft.id && item.kind === "launcher") : undefined;
    const parent = draft.parentId
      ? data.items.find((item) => item.id === draft.parentId && item.kind === "workspaceFolder")
      : undefined;
    const parentId = parent?.id ?? null;
    const shouldPlaceInFolder = Boolean(parent) || Boolean(existing?.parentId && existing.parentId !== parentId);
    let path = draft.path.trim();
    let args = draft.args.trim();
    let targetType = draft.targetType;
    const sourceShortcutPath = draft.sourceShortcutPath
      ?? (draft.targetType === "shortcut" && isShortcutPath(path) ? path : undefined);
    let shortcutPath = existing?.shortcutPath;
    if (shouldPlaceInFolder) {
      try {
        setStatus("正在放入文件夹...");
        const result = await createWorkspaceShortcut(sourceShortcutPath ?? path, args, parent?.path ?? null, draft.name.trim());
        path = result.path;
        args = "";
        targetType = draft.targetType === "url" ? "url" : "shortcut";
        shortcutPath = undefined;
      } catch (error) {
        setStatus(`放入文件夹失败：${String(error)}`);
        return;
      }
    } else if (sourceShortcutPath) {
      try {
        const imported = await importTarget(sourceShortcutPath);
        path = imported.path;
        args = imported.args;
        targetType = imported.targetType;
        shortcutPath = (await backupShortcut(sourceShortcutPath, draft.name.trim())).path;
      } catch (error) {
        setStatus(`快捷方式备份失败：${String(error)}`);
        return;
      }
    } else if (
      !existing
      || existing.path !== path
      || existing.args !== args
      || existing.targetType !== targetType
    ) {
      shortcutPath = undefined;
    }
    const item: LauncherItem = {
      id: itemId,
      kind: "launcher",
      name: draft.name.trim(),
      path,
      args,
      targetType,
      categoryId: parent?.categoryId ?? draft.categoryId ?? selectedCategoryId(),
      parentId,
      iconPath,
      shortcutPath,
      searchKey: buildSearchKey(draft.name, `${path} ${args}`),
      order: existing?.order ?? data.items.length,
      launchCount: existing?.launchCount ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    persist((current) => ({
      ...current,
      items: current.items.some((value) => value.id === item.id)
        ? current.items.map((value) => (value.id === item.id ? item : value))
        : [...current.items, item],
    }));
    setDraft(null);
    setStatus(parent ? "已放入文件夹，图标将在后台补齐" : "已添加，图标将在后台补齐");
    if (!item.iconPath && item.targetType !== "url") void fillExtractedIcon(item.path, item.id);
  }

  function openNewMemo() {
    const parentId = currentFolder?.id ?? null;
    setMemoDraft({
      name: "",
      content: "",
      categoryId: selectedCategoryId(),
      parentId,
      lockCategory: false,
    });
  }

  async function openMemo(item: LauncherItem) {
    try {
      setStatus("正在读取备忘录...");
      const content = await readMemo(item.path);
      setMemoDraft({
        id: item.id,
        name: item.name,
        content,
        path: item.path,
        categoryId: item.categoryId,
        parentId: item.parentId ?? null,
        lockCategory: false,
        createdAt: item.createdAt,
      });
      setStatus("备忘录已打开");
    } catch (error) {
      setStatus(`读取备忘录失败：${String(error)}`);
    }
  }

  async function submitMemoDraft() {
    if (!memoDraft) return;
    const memoName = memoDraft.name.trim() || (!memoDraft.id ? localMemoTitle() : "");
    if (!memoName) {
      setStatus("备忘录标题不能为空");
      return;
    }
    try {
      const parent = memoDraft.parentId
        ? data.items.find((item) => item.id === memoDraft.parentId && item.kind === "workspaceFolder")
        : undefined;
      const result = await saveMemo(memoDraft.path ?? null, parent?.path ?? null, memoName, memoDraft.content);
      const now = new Date().toISOString();
      const existing = memoDraft.id ? data.items.find((item) => item.id === memoDraft.id) : undefined;
      const item: LauncherItem = {
        id: memoDraft.id ?? newId("memo"),
        kind: "memo",
        name: memoName,
        path: result.path,
        categoryId: memoDraft.categoryId,
        parentId: memoDraft.parentId,
        searchKey: buildSearchKey(memoName, memoDraft.content),
        order: existing?.order ?? data.items.length,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      persist((current) => ({
        ...current,
        items: current.items.some((node) => node.id === item.id)
          ? current.items.map((node) => (node.id === item.id ? item : node))
          : [...current.items, item],
      }));
      setMemoDraft(null);
      setStatus("备忘录已保存");
    } catch (error) {
      setStatus(`保存备忘录失败：${String(error)}`);
    }
  }

  function openNewFolder() {
    const parentId = currentFolder?.id ?? null;
    setFolderDraft({
      name: "",
      categoryId: currentFolder?.categoryId ?? selectedCategoryId(),
      parentId,
      lockCategory: Boolean(parentId),
    });
  }

  function openFolderEditor(item: LauncherItem) {
    setFolderDraft({
      id: item.id,
      name: item.name,
      path: item.path,
      categoryId: item.categoryId,
      parentId: item.parentId ?? null,
      lockCategory: true,
      createdAt: item.createdAt,
    });
  }

  async function submitFolderDraft() {
    if (!folderDraft?.name.trim()) {
      setStatus("文件夹名称不能为空");
      return;
    }
    try {
      const parent = folderDraft.parentId
        ? data.items.find((item) => item.id === folderDraft.parentId && item.kind === "workspaceFolder")
        : undefined;
      const result = folderDraft.path
        ? await renameWorkspaceFolder(folderDraft.path, folderDraft.name)
        : await createWorkspaceFolder(parent?.path ?? null, folderDraft.name);
      const now = new Date().toISOString();
      const existing = folderDraft.id ? data.items.find((item) => item.id === folderDraft.id) : undefined;
      const item: LauncherItem = {
        id: folderDraft.id ?? newId("folder"),
        kind: "workspaceFolder",
        name: folderDraft.name.trim(),
        path: result.path,
        categoryId: folderDraft.categoryId,
        parentId: folderDraft.parentId,
        searchKey: buildSearchKey(folderDraft.name, ""),
        order: existing?.order ?? data.items.length,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      persist((current) => ({
        ...current,
        items: current.items.some((node) => node.id === item.id)
          ? current.items.map((node) => {
              if (node.id === item.id) return item;
              if (folderDraft.path && node.id !== item.id) {
                return {
                  ...node,
                  path: replacePathPrefix(node.path, folderDraft.path, result.path),
                  shortcutPath: node.shortcutPath
                    ? replacePathPrefix(node.shortcutPath, folderDraft.path, result.path)
                    : undefined,
                };
              }
              return node;
            })
          : [...current.items, item],
      }));
      setFolderDraft(null);
      setStatus(folderDraft.path ? "文件夹已重命名" : "文件夹已创建");
    } catch (error) {
      setStatus(`保存文件夹失败：${String(error)}`);
    }
  }

  function requestRemoveNode(item: LauncherItem) {
    const title = item.kind === "workspaceFolder" ? "删除文件夹" : item.kind === "memo" ? "删除备忘录" : "删除启动项";
    const description = item.kind === "workspaceFolder"
      ? `将删除「${item.name}」及其所有内容。受管理的文件会移入回收站。`
      : `将删除「${item.name}」。受管理的文件会移入回收站。`;
    setDeleteConfirmation({ kind: "node", targetId: item.id, title, description });
  }

  async function removeNode(item: LauncherItem) {
    try {
      const removedIds = item.kind === "workspaceFolder" ? collectDescendantIds(data.items, item.id) : new Set([item.id]);
      const managedPaths = [...new Set(
        data.items
          .filter((node) => removedIds.has(node.id))
          .flatMap((node) => [node.path, node.shortcutPath])
          .filter((path): path is string => Boolean(path)),
      )];
      for (const path of managedPaths) await recycleWorkspacePath(path);
      persist((current) => ({ ...current, items: current.items.filter((node) => !removedIds.has(node.id)) }));
      if (currentFolderId && removedIds.has(currentFolderId)) setCurrentFolderId(null);
      setDraft(null);
      setMemoDraft(null);
      setFolderDraft(null);
      if (scheduleDraft && removedIds.has(scheduleDraft.itemId)) setScheduleDraft(null);
      setStatus("已删除");
    } catch (error) {
      setStatus(`删除失败：${String(error)}`);
    }
  }

  async function confirmDelete() {
    const confirmation = deleteConfirmation;
    if (!confirmation) return;
    setDeleteConfirmation(null);
    if (confirmation.kind === "category") {
      deleteCategory(confirmation.targetId);
      return;
    }
    const item = data.items.find((node) => node.id === confirmation.targetId);
    if (item) await removeNode(item);
  }

  async function runItem(item: LauncherItem, source: "manual" | "scheduled" = "manual") {
    if (!isLauncher(item)) return;
    try {
      await launchTarget(item.path, item.args, item.targetType, item.shortcutPath);
      persist((current) => ({
        ...current,
        items: current.items.map((value) =>
          value.id === item.id
            ? { ...value, launchCount: (value.launchCount ?? 0) + 1, updatedAt: new Date().toISOString() }
            : value,
        ),
      }));
      if (source === "manual") {
        setQuery("");
        if (data.settings.autoHideAfterLaunch) await hideMainWindow("launch");
      }
      setStatus(source === "scheduled" ? `已定时启动 ${item.name}` : `已启动 ${item.name}`);
    } catch (error) {
      setStatus(`启动失败：${String(error)}`);
    }
  }

  function openCardContextMenu(item: LauncherItem, x: number, y: number) {
    const width = 218;
    const height = isLauncher(item) ? (item.targetType === "url" ? 150 : 270) : 100;
    setCardContextMenu({
      item,
      x: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
  }

  async function openProgramDirectory(item: LauncherItem, destination: "explorer" | "terminal") {
    try {
      if (destination === "explorer") await openProgramInExplorer(item.path);
      else await openProgramInTerminal(item.path);
      setStatus(destination === "explorer" ? `已在资源管理器中打开「${item.name}」所在目录` : `已在终端中打开「${item.name}」所在目录`);
    } catch (error) {
      setStatus(`${destination === "explorer" ? "打开资源管理器" : "打开终端"}失败：${String(error)}`);
    }
  }

  function openSchedule(item: LauncherItem) {
    if (!isLauncher(item) || item.targetType === "url") return;
    setScheduleDraft({ itemId: item.id, ...normalizeLaunchSchedule(item.schedule) });
  }

  function editNode(item: LauncherItem) {
    if (item.kind === "workspaceFolder") openFolderEditor(item);
    else if (item.kind === "memo") void openMemo(item);
    else openLaunchDraft(item);
  }

  function saveSchedule() {
    if (!scheduleDraft) return;
    const schedule = normalizeLaunchSchedule(scheduleDraft);
    persist((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === scheduleDraft.itemId ? { ...item, schedule, updatedAt: new Date().toISOString() } : item,
      ),
    }));
    setScheduleDraft(null);
    setStatus(schedule.enabled ? "定时启动已保存" : "定时启动已关闭");
  }

  async function saveSettings(
    hotkey: string,
    closeToTray: boolean,
    autoStart: boolean,
    autoHideAfterLaunch: boolean,
    autoHideOnBlur: boolean,
    autoSortByLaunchCount: boolean,
    showCardMeta: boolean,
    launchMode: LaunchMode,
  ) {
    try {
      const nextHotkey = hotkey.trim() || DEFAULT_HOTKEY;
      await updateHotkey(nextHotkey);
      await updateStartup(autoStart);
      persist((current) => ({
        ...current,
        settings: {
          ...current.settings,
          hotkey: nextHotkey,
          closeToTray,
          autoStart,
          autoHideAfterLaunch,
          autoHideOnBlur,
          autoSortByLaunchCount,
          showCardMeta,
          launchMode,
        },
      }));
      setSettingsOpen(false);
      setStatus("设置已更新");
    } catch (error) {
      setStatus(`设置保存失败：${String(error)}`);
    }
  }

  return (
    <main className={`shell theme-${data.settings.theme} ${dragActive ? "dragging" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => event.preventDefault()}>
      <WindowTitlebar
        theme={data.settings.theme}
        onToggleTheme={toggleTheme}
        onTitlebarInteraction={() => {
          ignoreAutoHideUntil.current = Date.now() + TITLEBAR_BLUR_SUPPRESSION_MS;
          window.clearTimeout(pendingBlurHide.current);
          pendingBlurHide.current = undefined;
        }}
      />

      <div className="main-layout">
        <aside className="sidebar">
          <SidebarCategoryList
            allCount={data.items.length}
            allSelected={selectedCategory === "all"}
            categories={categories}
            categoryCounts={categoryCounts}
            onAddCategory={addCategory}
            onDeleteCategory={requestDeleteCategory}
            onOpenSettings={() => setSettingsOpen(true)}
            onRenameCategory={renameCategory}
            onReorderCategory={reorderCategories}
            onSelectAll={() => selectCategory("all")}
            onSelectCategory={selectCategory}
            selectedCategoryId={selectedCategory}
          />
        </aside>

        <section className="content">
          <header className="topbar">
            <div className="topbar-left">
              {currentFolder ? (
                <div className="breadcrumb" aria-label="文件夹路径">
                  <button onClick={() => setCurrentFolderId(null)} title="返回根目录" type="button"><Grid2X2 size={14} /></button>
                  {breadcrumbs.map((folder) => (
                    <span key={folder.id}>
                      <ChevronRight size={14} />
                      <button onClick={() => setCurrentFolderId(folder.id)} type="button">{folder.name}</button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="actions">
              <label className="search">
                <Search size={18} />
                <input autoFocus ref={searchInputRef} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、备忘录或拼音首字母" value={query} />
              </label>
              <button aria-label="新建备忘录" className="toolbar-action" onClick={openNewMemo} title="新建备忘录" type="button"><StickyNote size={17} /></button>
              <button aria-label="新建文件夹" className="toolbar-action" onClick={openNewFolder} title="新建文件夹" type="button"><FolderPlus size={17} /></button>
              <button className="primary icon-primary" onClick={() => openLaunchDraft()} title="添加启动项" type="button"><Plus size={18} /></button>
            </div>
          </header>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleItemDragEnd}>
            <SortableContext items={visibleItems.map((item) => item.id)} strategy={rectSortingStrategy}>
              <section className={`grid ${query.trim() || data.settings.autoSortByLaunchCount ? "sorting-disabled" : ""}`} aria-label="启动项列表">
                {visibleItems.map((item) => (
                  <SortableAppCard
                  categoryName={item.categoryId === "all" ? "全部" : categories.find((category) => category.id === item.categoryId)?.name ?? "未分组"}
                    iconBasePath={dataPath}
                    item={item}
                    key={item.id}
                    launchMode={data.settings.launchMode}
                    showCardMeta={data.settings.showCardMeta}
                    onEdit={() => editNode(item)}
                    onOpenFolder={() => enterFolder(item)}
                    onOpenMemo={() => void openMemo(item)}
                    onOpenContextMenu={openCardContextMenu}
                    onRun={() => void runItem(item)}
                  />
                ))}
                {!visibleItems.length ? (
                  <div className="empty">
                    <img alt="" className="empty-icon" src="/app-icon.png" />
                    <h2>{query ? "没有找到匹配项" : "这里还没有内容"}</h2>
                    <p>{query ? "试试标题、备忘录正文、英文缩写或中文拼音首字母。" : "添加快捷方式，或新建备忘录。"}</p>
                    <div className="empty-actions">
                      <button className="ghost" onClick={openShortcutDraft} type="button"><Link2 size={18} />添加快捷方式</button>
                      <button className="primary" onClick={openNewMemo} type="button"><StickyNote size={18} />新建备忘录</button>
                    </div>
                    {!query ? <span className="empty-drop-hint"><MousePointer2 size={15} />可直接拖入快捷方式</span> : null}
                  </div>
                ) : null}
              </section>
            </SortableContext>
          </DndContext>

          <footer className="status">
            <span>{saving ? "保存中..." : status}</span>
            <button onClick={revealDataDir} type="button">{dataPath || "数据目录"}</button>
          </footer>
        </section>
      </div>

      {draft ? (
        <ItemModal
          categories={categories}
          draft={draft}
          folders={data.items.filter((item) => item.kind === "workspaceFolder")}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onDelete={draft.id ? () => {
            const item = data.items.find((node) => node.id === draft.id);
            if (item) requestRemoveNode(item);
          } : undefined}
          onPickIcon={pickIcon}
          onPickTarget={pickTarget}
          onSubmit={() => void submitDraft()}
        />
      ) : null}

      {memoDraft ? (
        <MemoModal
          categories={categories}
          draft={memoDraft}
          folders={data.items.filter((item) => item.kind === "workspaceFolder")}
          onChange={setMemoDraft}
          onClose={() => setMemoDraft(null)}
          onDelete={memoDraft.id ? () => {
            const item = data.items.find((node) => node.id === memoDraft.id);
            if (item) requestRemoveNode(item);
          } : undefined}
          onSubmit={() => void submitMemoDraft()}
        />
      ) : null}

      {folderDraft ? (
        <FolderModal
          categories={categories}
          draft={folderDraft}
          onChange={setFolderDraft}
          onClose={() => setFolderDraft(null)}
          onDelete={folderDraft.id ? () => {
            const item = data.items.find((node) => node.id === folderDraft.id);
            if (item) requestRemoveNode(item);
          } : undefined}
          onSubmit={() => void submitFolderDraft()}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsModal
          autoStart={data.settings.autoStart}
          autoHideAfterLaunch={data.settings.autoHideAfterLaunch}
          autoHideOnBlur={data.settings.autoHideOnBlur}
          autoSortByLaunchCount={data.settings.autoSortByLaunchCount}
          closeToTray={data.settings.closeToTray}
          hotkey={data.settings.hotkey}
          launchMode={data.settings.launchMode}
          showCardMeta={data.settings.showCardMeta}
          onClose={() => setSettingsOpen(false)}
          onSubmit={saveSettings}
        />
      ) : null}

      {cardContextMenu ? (
        <CardContextMenu
          item={cardContextMenu.item}
          onClose={() => setCardContextMenu(null)}
          onDelete={() => requestRemoveNode(cardContextMenu.item)}
          onEdit={() => editNode(cardContextMenu.item)}
          onOpenExplorer={() => void openProgramDirectory(cardContextMenu.item, "explorer")}
          onOpenTerminal={() => void openProgramDirectory(cardContextMenu.item, "terminal")}
          onRun={() => void runItem(cardContextMenu.item)}
          onSchedule={() => openSchedule(cardContextMenu.item)}
          x={cardContextMenu.x}
          y={cardContextMenu.y}
        />
      ) : null}

      {scheduleDraft ? (
        <ScheduleModal
          draft={scheduleDraft}
          onChange={setScheduleDraft}
          onClose={() => setScheduleDraft(null)}
          onSubmit={saveSchedule}
        />
      ) : null}

      {deleteConfirmation ? (
        <DeleteConfirmModal
          confirmation={deleteConfirmation}
          onCancel={() => setDeleteConfirmation(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}

      {dragActive ? (
        <div className="drop-overlay">
          <img alt="" className="drop-icon" src="/app-icon.png" />
          <h2>释放以添加启动项</h2>
          <p>支持 exe、lnk 快捷方式和文件夹</p>
        </div>
      ) : null}
    </main>
  );
}

interface DeleteConfirmModalProps {
  confirmation: DeleteConfirmation;
  onCancel: () => void;
  onConfirm: () => void;
}

function DeleteConfirmModal({ confirmation, onCancel, onConfirm }: DeleteConfirmModalProps) {
  return (
    <div className="modal-backdrop confirm-backdrop">
      <section aria-labelledby="delete-confirm-title" aria-modal="true" className="modal confirm-modal" role="alertdialog">
        <header><h2 id="delete-confirm-title">{confirmation.title}</h2><button aria-label="关闭确认" onClick={onCancel} title="取消" type="button"><X size={18} /></button></header>
        <div className="confirm-body">
          <span aria-hidden="true" className="confirm-icon"><Trash2 size={20} /></span>
          <p>{confirmation.description}</p>
        </div>
        <footer><button className="ghost" onClick={onCancel} type="button">取消</button><button className="danger confirm-delete" onClick={onConfirm} type="button"><Trash2 size={16} />删除</button></footer>
      </section>
    </div>
  );
}

interface SidebarCategoryListProps {
  allCount: number;
  allSelected: boolean;
  categories: Category[];
  categoryCounts: Map<string, number>;
  onAddCategory: (name: string) => void;
  onDeleteCategory: (id: string) => void;
  onOpenSettings: () => void;
  onRenameCategory: (id: string, name: string) => void;
  onReorderCategory: (activeId: string, overId: string) => void;
  onSelectAll: () => void;
  onSelectCategory: (id: string) => void;
  selectedCategoryId: string;
}

function SidebarCategoryList({ allCount, allSelected, categories, categoryCounts, onAddCategory, onDeleteCategory, onOpenSettings, onRenameCategory, onReorderCategory, onSelectAll, onSelectCategory, selectedCategoryId }: SidebarCategoryListProps) {
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function submitCategory() {
    const name = newCategoryName.trim();
    setAddingCategory(false);
    setNewCategoryName("");
    if (name) onAddCategory(name);
  }

  function cancelAddingCategory() {
    setAddingCategory(false);
    setNewCategoryName("");
  }

  function handleCategoryDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : "";
    if (overId && activeId !== overId) onReorderCategory(activeId, overId);
  }

  return (
    <>
      <div className="sidebar-all-row">
        <button className={`category ${allSelected ? "active" : ""}`} onClick={onSelectAll} type="button">
          <Grid2X2 size={18} />
          <span>全部</span>
          <b>{allCount}</b>
        </button>
        <button aria-label="新建分组" className="sidebar-add-category" disabled={addingCategory} onClick={() => setAddingCategory(true)} title="新建分组" type="button"><Plus size={18} /></button>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCategoryDragEnd}>
        <SortableContext items={categories.map((category) => category.id)} strategy={verticalListSortingStrategy}>
          <div className="category-list">
            {categories.map((category) => (
              <SortableSidebarCategory
                category={category}
                count={categoryCounts.get(category.id) ?? 0}
                disabledDelete={categories.length <= 1}
                key={category.id}
                onDelete={() => onDeleteCategory(category.id)}
                onRename={(name) => onRenameCategory(category.id, name)}
                onSelect={() => onSelectCategory(category.id)}
                selected={selectedCategoryId === category.id}
              />
            ))}
            {addingCategory ? (
              <div className="sidebar-category-create">
                <input
                  aria-label="新分组名称"
                  autoFocus
                  onBlur={submitCategory}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      cancelAddingCategory();
                    }
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  placeholder="分组名称"
                  value={newCategoryName}
                />
              </div>
            ) : null}
          </div>
        </SortableContext>
      </DndContext>
      <div className="sidebar-footer">
        <button className="settings-button" onClick={onOpenSettings} type="button">
          <Settings size={17} />
          设置
        </button>
      </div>
    </>
  );
}

interface SortableSidebarCategoryProps {
  category: Category;
  count: number;
  disabledDelete: boolean;
  onDelete: () => void;
  onRename: (name: string) => void;
  onSelect: () => void;
  selected: boolean;
}

function SortableSidebarCategory({ category, count, disabledDelete, onDelete, onRename, onSelect, selected }: SortableSidebarCategoryProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: category.id });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const style = { transform: CSS.Transform.toString(transform), transition };

  useEffect(() => {
    if (!editing) setName(category.name);
  }, [category.name, editing]);

  function startEditing() {
    setName(category.name);
    setEditing(true);
  }

  function submitRename() {
    const nextName = name.trim();
    if (nextName && nextName !== category.name) onRename(nextName);
    setEditing(false);
  }

  function cancelRename() {
    setName(category.name);
    setEditing(false);
  }

  return (
    <div className={`sidebar-category-row ${selected ? "active" : ""} ${isDragging ? "drag-sorting" : ""}`} ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {editing ? (
        <div className="sidebar-category-editor">
          <i style={{ background: category.color }} />
          <input
            aria-label="分组名称"
            autoFocus
            onBlur={submitRename}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                event.preventDefault();
                cancelRename();
              }
            }}
            onPointerDown={(event) => event.stopPropagation()}
            value={name}
          />
        </div>
      ) : (
        <>
          <button className={`category sidebar-category-main ${selected ? "active" : ""}`} onClick={onSelect} type="button">
            <i style={{ background: category.color }} />
            <span>{category.name}</span>
            <b>{count}</b>
          </button>
          <button
            aria-label={`编辑分组 ${category.name}`}
            className="sidebar-category-edit"
            onClick={(event) => {
              event.stopPropagation();
              startEditing();
            }}
            onPointerDown={(event) => event.stopPropagation()}
            title="编辑分组名称"
            type="button"
          ><Edit3 size={15} /></button>
          <button
            aria-label={`删除分组 ${category.name}`}
            className="sidebar-category-delete"
            disabled={disabledDelete}
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            onPointerDown={(event) => event.stopPropagation()}
            title={disabledDelete ? "至少保留一个分组" : "删除分组"}
            type="button"
          ><Trash2 size={15} /></button>
        </>
      )}
    </div>
  );
}

interface SortableAppCardProps {
  categoryName: string;
  iconBasePath: string;
  item: LauncherItem;
  launchMode: LaunchMode;
  showCardMeta: boolean;
  onEdit: () => void;
  onOpenFolder: () => void;
  onOpenMemo: () => void;
  onOpenContextMenu: (item: LauncherItem, x: number, y: number) => void;
  onRun: () => void;
}

function SortableAppCard({ categoryName, iconBasePath, item, launchMode, onEdit, onOpenFolder, onOpenMemo, onOpenContextMenu, onRun, showCardMeta }: SortableAppCardProps) {
  const folder = item.kind === "workspaceFolder";
  const sortable = useSortable({ id: item.id, disabled: folder });
  const droppable = useDroppable({ id: `folder-drop-${item.id}`, disabled: !folder });
  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };
  const isOverFolder = folder && droppable.isOver;
  const isDragging = sortable.isDragging;
  const hasSchedule = isLauncher(item) && Boolean(item.schedule?.enabled);
  const icon = item.kind === "memo"
    ? <StickyNote size={34} />
    : folder
      ? <FolderOpen size={34} />
      : item.iconPath
        ? <img alt="" src={assetUrl(item.iconPath, iconBasePath)} />
        : item.targetType === "folder"
          ? <FolderOpen size={34} />
          : item.targetType === "url"
            ? <Link2 size={34} />
            : <AppWindow size={34} />;

  function activate() {
    if (folder) onOpenFolder();
    else if (item.kind === "memo") onOpenMemo();
    else if (launchMode === "single") onRun();
  }

  return (
    <article
      className={`app-card ${folder ? "workspace-folder-card" : ""} ${hasSchedule ? "has-schedule" : ""} ${isDragging ? "drag-sorting" : ""} ${isOverFolder ? "folder-drop-target" : ""}`}
      onDoubleClick={isLauncher(item) && launchMode === "double" ? onRun : undefined}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenContextMenu(item, event.clientX, event.clientY);
      }}
      ref={folder ? droppable.setNodeRef : sortable.setNodeRef}
      style={style}
      {...(!folder ? sortable.attributes : {})}
      {...(!folder ? sortable.listeners : {})}
    >
      <button className="app-main" onClick={activate} type="button">
        <span className="app-icon">{icon}</span>
        <span className="app-name">{item.name}</span>
        {showCardMeta ? <span className="app-meta">{itemLabel(item)}<i />{categoryName}</span> : null}
      </button>
      <div className="card-tools">
        <button onPointerDown={(event) => event.stopPropagation()} onClick={onEdit} title={folder ? "重命名" : item.kind === "memo" ? "编辑备忘录" : "编辑"} type="button"><Edit3 size={16} /></button>
      </div>
      {hasSchedule ? <span aria-label="已设置定时启动" className="schedule-badge" title="已设置定时启动"><Clock3 size={12} />定时</span> : null}
      {isOverFolder ? <span className="folder-drop-hint">放入文件夹</span> : null}
    </article>
  );
}

interface CardContextMenuProps {
  item: LauncherItem;
  onClose: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onOpenExplorer: () => void;
  onOpenTerminal: () => void;
  onRun: () => void;
  onSchedule: () => void;
  x: number;
  y: number;
}

function CardContextMenu({ item, onClose, onDelete, onEdit, onOpenExplorer, onOpenTerminal, onRun, onSchedule, x, y }: CardContextMenuProps) {
  function invoke(action: () => void) {
    onClose();
    action();
  }

  const launcher = isLauncher(item);
  const canOpenLocation = launcher && item.targetType !== "url";
  const canSchedule = canOpenLocation;

  return (
    <div aria-label={`${item.name} 操作菜单`} className="card-context-menu" onContextMenu={(event) => event.preventDefault()} onPointerDown={(event) => event.stopPropagation()} role="menu" style={{ left: x, top: y }}>
      {launcher ? <button onClick={() => invoke(onRun)} role="menuitem" type="button"><Play size={16} />运行</button> : null}
      {canSchedule ? <button onClick={() => invoke(onSchedule)} role="menuitem" type="button"><Clock3 size={16} />定时启动</button> : null}
      {canOpenLocation ? <>
        <span className="context-menu-divider" />
        <button onClick={() => invoke(onOpenExplorer)} role="menuitem" type="button"><FolderOpen size={16} />用资源管理器打开</button>
        <button onClick={() => invoke(onOpenTerminal)} role="menuitem" type="button"><Terminal size={16} />在终端中打开</button>
      </> : null}
      <span className="context-menu-divider" />
      <button onClick={() => invoke(onEdit)} role="menuitem" type="button"><Edit3 size={16} />编辑</button>
      <button className="context-menu-danger" onClick={() => invoke(onDelete)} role="menuitem" type="button"><Trash2 size={16} />删除</button>
    </div>
  );
}

interface WindowTitlebarProps {
  theme: Theme;
  onTitlebarInteraction: () => void;
  onToggleTheme: () => void;
}

function WindowTitlebar({ theme, onTitlebarInteraction, onToggleTheme }: WindowTitlebarProps) {
  async function startDrag(event: ReactMouseEvent) {
    if (!("__TAURI_INTERNALS__" in window)) return;
    onTitlebarInteraction();
    const appWindow = getCurrentWindow();
    if (event.detail > 1) {
      await appWindow.toggleMaximize();
      return;
    }
    await appWindow.startDragging();
  }

  async function control(action: "minimize" | "maximize" | "close") {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const appWindow = getCurrentWindow();
    if (action === "minimize") await appWindow.minimize();
    else if (action === "maximize") await appWindow.toggleMaximize();
    else await appWindow.close();
  }

  return (
    <header className="window-titlebar">
      <div className="titlebar-drag" onMouseDown={(event) => void startDrag(event)}>
        <div className="titlebar-brand">
          <div className="brand-mark"><img alt="" src="/app-icon.png" /></div>
          <div className="brand-copy"><strong>Quick Launcher</strong><span>桌面快速启动器</span></div>
        </div>
      </div>
      <div className="window-controls">
        <button aria-label={theme === "light" ? "切换为深色模式" : "切换为浅色模式"} className="theme-toggle" onClick={() => { onTitlebarInteraction(); onToggleTheme(); }} title={theme === "light" ? "切换为深色模式" : "切换为浅色模式"} type="button">{theme === "light" ? <Moon size={16} /> : <Sun size={16} />}</button>
        <button onClick={() => void control("minimize")} title="最小化" type="button"><Minus size={16} /></button>
        <button onClick={() => void control("maximize")} title="最大化/还原" type="button"><Maximize2 size={15} /></button>
        <button className="close-window" onClick={() => void control("close")} title="关闭" type="button"><X size={16} /></button>
      </div>
    </header>
  );
}

interface ItemModalProps {
  categories: Category[];
  draft: ItemDraft;
  folders: LauncherItem[];
  onChange: (draft: ItemDraft) => void;
  onClose: () => void;
  onDelete?: () => void;
  onPickIcon: () => void;
  onPickTarget: (type: TargetType) => void;
  onSubmit: () => void;
}

function ItemModal({ categories, draft, folders, onChange, onClose, onDelete, onPickIcon, onPickTarget, onSubmit }: ItemModalProps) {
  const availableFolders = useMemo(
    () => folders.filter((folder) => folder.categoryId === draft.categoryId).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh-Hans-CN")),
    [draft.categoryId, folders],
  );
  return (
    <div className="modal-backdrop">
      <section className="modal">
        <header><h2>{draft.id ? "编辑启动项" : "添加启动项"}</h2><button onClick={onClose} title="关闭" type="button"><X size={18} /></button></header>
        <div className="form-grid">
          <label className="wide">名称<input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></label>
          <label>分组<select value={draft.categoryId} onChange={(event) => onChange({ ...draft, categoryId: event.target.value, parentId: null })}>{draft.categoryId === "all" ? <option value="all">全部</option> : null}{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label>文件夹<select value={draft.parentId ?? ""} onChange={(event) => {
            const parentId = event.target.value || null;
            const folder = folders.find((item) => item.id === parentId);
            onChange({ ...draft, parentId, categoryId: folder?.categoryId ?? draft.categoryId });
          }}><option value="">分组根目录</option>{availableFolders.map((folder) => <option key={folder.id} value={folder.id}>{folderPathLabel(folder, folders)}</option>)}</select></label>
          <label>类型<select value={draft.targetType} onChange={(event) => {
            const targetType = event.target.value as TargetType;
            const targetChanged = targetType !== draft.targetType;
            onChange({
              ...draft,
              targetType,
              sourceShortcutPath: targetChanged ? undefined : draft.sourceShortcutPath,
              shortcutPath: targetChanged ? undefined : draft.shortcutPath,
            });
          }}><option value="program">程序</option><option value="shortcut">快捷方式</option><option value="folder">系统文件夹</option><option value="url">网址</option></select></label>
          <label>启动参数<input value={draft.args} onChange={(event) => onChange({ ...draft, args: event.target.value })} placeholder="可选" /></label>
          <label className="wide">路径{draft.targetType === "url" ? <input value={draft.path} onChange={(event) => onChange({ ...draft, path: event.target.value, targetType: "url", sourceShortcutPath: undefined, shortcutPath: undefined })} placeholder="https://example.com" /> : <div className="inline-input"><input value={draft.path} onChange={(event) => {
            const path = event.target.value;
            onChange({ ...draft, path, targetType: inferType(path), sourceShortcutPath: isShortcutPath(path) ? path : undefined, shortcutPath: undefined });
          }} /><button onClick={() => onPickTarget(draft.targetType)} type="button"><Folder size={16} />选择</button></div>}</label>
          <label className="wide">图标<div className="inline-input"><input value={draft.iconPath ?? ""} onChange={(event) => onChange({ ...draft, iconPath: event.target.value })} placeholder="自动提取，或手动选择图片/exe/lnk" /><button onClick={onPickIcon} type="button"><AppWindow size={16} />选择</button></div></label>
        </div>
        <footer className={onDelete ? "split-footer" : ""}>{onDelete ? <button className="danger" onClick={onDelete} type="button"><Trash2 size={16} />删除</button> : null}<div className="footer-actions"><button className="ghost" onClick={onClose} type="button">取消</button><button className="primary" onClick={onSubmit} type="button">保存</button></div></footer>
      </section>
    </div>
  );
}

interface MemoModalProps {
  categories: Category[];
  draft: MemoDraft;
  folders: LauncherItem[];
  onChange: (draft: MemoDraft) => void;
  onClose: () => void;
  onDelete?: () => void;
  onSubmit: () => void;
}

function MemoModal({ categories, draft, folders, onChange, onClose, onDelete, onSubmit }: MemoModalProps) {
  const [view, setView] = useState<"edit" | "preview">("edit");
  const availableFolders = useMemo(
    () => folders.filter((folder) => folder.categoryId === draft.categoryId).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh-Hans-CN")),
    [draft.categoryId, folders],
  );
  return (
    <div className="modal-backdrop">
      <section className="modal memo-modal">
        <header><h2>{draft.id ? "编辑备忘录" : "新建备忘录"}</h2><button onClick={onClose} title="关闭" type="button"><X size={18} /></button></header>
        <div className="memo-body">
          <label className="memo-wide">标题<input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} autoFocus /></label>
          <label>分组<select value={draft.categoryId} onChange={(event) => onChange({ ...draft, categoryId: event.target.value, parentId: null, lockCategory: false })}>{draft.categoryId === "all" ? <option value="all">全部</option> : null}{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label>文件夹<select value={draft.parentId ?? ""} onChange={(event) => {
            const parentId = event.target.value || null;
            const folder = folders.find((item) => item.id === parentId);
            onChange({ ...draft, parentId, categoryId: folder?.categoryId ?? draft.categoryId, lockCategory: false });
          }}><option value="">分组根目录</option>{availableFolders.map((folder) => <option key={folder.id} value={folder.id}>{folderPathLabel(folder, folders)}</option>)}</select></label>
          <div className="segmented memo-tabs"><button className={view === "edit" ? "active" : ""} onClick={() => setView("edit")} type="button"><FilePenLine size={16} />编辑</button><button className={view === "preview" ? "active" : ""} onClick={() => setView("preview")} type="button"><Eye size={16} />预览</button></div>
          {view === "edit" ? <textarea aria-label="备忘录 Markdown 内容" value={draft.content} onChange={(event) => onChange({ ...draft, content: event.target.value })} placeholder="使用 Markdown 记录内容" /> : <div className="markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.content || "*空白备忘录*"}</ReactMarkdown></div>}
        </div>
        <footer className={onDelete ? "split-footer" : ""}>{onDelete ? <button className="danger" onClick={onDelete} type="button"><Trash2 size={16} />删除</button> : null}<div className="footer-actions"><button className="ghost" onClick={onClose} type="button">取消</button><button className="primary" onClick={onSubmit} type="button">保存</button></div></footer>
      </section>
    </div>
  );
}

interface FolderModalProps {
  categories: Category[];
  draft: FolderDraft;
  onChange: (draft: FolderDraft) => void;
  onClose: () => void;
  onDelete?: () => void;
  onSubmit: () => void;
}

function FolderModal({ categories, draft, onChange, onClose, onDelete, onSubmit }: FolderModalProps) {
  return (
    <div className="modal-backdrop">
      <section className="modal folder-modal">
        <header><h2>{draft.id ? "重命名文件夹" : "新建文件夹"}</h2><button onClick={onClose} title="关闭" type="button"><X size={18} /></button></header>
        <div className="form-grid">
          <label className="wide">名称<input autoFocus value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></label>
          <label className="wide">分组<select disabled={draft.lockCategory} value={draft.categoryId} onChange={(event) => onChange({ ...draft, categoryId: event.target.value })}>{draft.categoryId === "all" ? <option value="all">全部</option> : null}{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        </div>
        <footer className={onDelete ? "split-footer" : ""}>{onDelete ? <button className="danger" onClick={onDelete} type="button"><Trash2 size={16} />删除</button> : null}<div className="footer-actions"><button className="ghost" onClick={onClose} type="button">取消</button><button className="primary" onClick={onSubmit} type="button">保存</button></div></footer>
      </section>
    </div>
  );
}

interface ScheduleModalProps {
  draft: ScheduleDraft;
  onChange: (draft: ScheduleDraft) => void;
  onClose: () => void;
  onSubmit: () => void;
}

function ScheduleModal({ draft, onChange, onClose, onSubmit }: ScheduleModalProps) {
  const dailyTimes = [...draft.dailyTimes].sort();
  const disabled = !draft.enabled;

  function setMode(mode: LaunchScheduleMode) {
    onChange({
      ...draft,
      mode,
      dailyTimes: draft.dailyTimes.length ? draft.dailyTimes : [DEFAULT_DAILY_TIME],
    });
  }

  function changeDailyTime(current: string, value: string) {
    onChange({ ...draft, dailyTimes: draft.dailyTimes.map((time) => time === current ? value : time) });
  }

  function removeDailyTime(value: string) {
    if (draft.dailyTimes.length <= 1) return;
    onChange({ ...draft, dailyTimes: draft.dailyTimes.filter((time) => time !== value) });
  }

  function toggleWeekday(day: number) {
    const selected = draft.weekdays.includes(day);
    if (selected && draft.weekdays.length <= 1) return;
    const weekdays = selected
      ? draft.weekdays.filter((value) => value !== day)
      : [...draft.weekdays, day].sort((left, right) => left - right);
    onChange({ ...draft, weekdays });
  }

  return (
    <div className="modal-backdrop">
      <section aria-modal="true" className="modal schedule-modal" role="dialog">
        <header><h2>定时启动</h2><button onClick={onClose} title="关闭" type="button"><X size={18} /></button></header>
        <div className="schedule-body">
          <label className="check-row"><input checked={draft.enabled} onChange={(event) => onChange({ ...draft, enabled: event.target.checked })} type="checkbox" />启用定时启动</label>
          <div className={`schedule-fields ${disabled ? "disabled" : ""}`}>
            <div className="schedule-field">
              <span>启动方式</span>
              <div className="segmented">
                <button className={draft.mode === "interval" ? "active" : ""} disabled={disabled} onClick={() => setMode("interval")} type="button">按间隔启动</button>
                <button className={draft.mode === "daily" ? "active" : ""} disabled={disabled} onClick={() => setMode("daily")} type="button">每天定时启动</button>
              </div>
            </div>

            {draft.mode === "interval" ? (
              <>
                <div className="schedule-field">
                  <span>常用间隔</span>
                  <div className="interval-presets">
                    {INTERVAL_PRESETS.map((minutes) => <button aria-pressed={draft.intervalMinutes === minutes} className={draft.intervalMinutes === minutes ? "active" : ""} disabled={disabled} key={minutes} onClick={() => onChange({ ...draft, intervalMinutes: minutes })} type="button">{minutes} 分钟</button>)}
                  </div>
                </div>
                <label className="schedule-field"><span>自定义间隔</span><span className="schedule-minutes-input"><input disabled={disabled} max={10080} min={1} onChange={(event) => onChange({ ...draft, intervalMinutes: Number(event.target.value) })} type="number" value={draft.intervalMinutes} />分钟</span></label>
              </>
            ) : (
              <>
                <div className="schedule-field weekly-days-field">
                  <span>每周日期</span>
                  <div className="weekday-picker">
                    {WEEKDAYS.map((day) => {
                      const selected = draft.weekdays.includes(day.value);
                      return <button aria-pressed={selected} className={selected ? "active" : ""} disabled={disabled || (selected && draft.weekdays.length <= 1)} key={day.value} onClick={() => toggleWeekday(day.value)} type="button">{day.label}</button>;
                    })}
                  </div>
                </div>
                <div className="schedule-field daily-times-field">
                  <span>每天时间</span>
                  <div className="schedule-time-list">
                    {dailyTimes.map((time, index) => (
                      <div className="schedule-time-row" key={`${time}-${index}`}>
                        <input aria-label={`启动时间 ${time}`} disabled={disabled} onChange={(event) => changeDailyTime(time, event.target.value)} type="time" value={time} />
                        <button aria-label={`移除 ${time}`} disabled={disabled || dailyTimes.length <= 1} onClick={() => removeDailyTime(time)} title="移除时间" type="button"><X size={16} /></button>
                      </div>
                    ))}
                    <button aria-label="添加启动时间" className="schedule-add-time" disabled={disabled || dailyTimes.length >= 24} onClick={() => onChange({ ...draft, dailyTimes: [...draft.dailyTimes, nextAvailableScheduleTime(draft.dailyTimes)] })} title="添加时间" type="button"><Plus size={17} /></button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
        <footer><div className="footer-actions"><button className="ghost" onClick={onClose} type="button">取消</button><button className="primary" onClick={onSubmit} type="button">保存</button></div></footer>
      </section>
    </div>
  );
}

interface SettingsModalProps {
  autoStart: boolean;
  autoHideAfterLaunch: boolean;
  autoHideOnBlur: boolean;
  autoSortByLaunchCount: boolean;
  showCardMeta: boolean;
  closeToTray: boolean;
  hotkey: string;
  launchMode: LaunchMode;
  onClose: () => void;
  onSubmit: (hotkey: string, closeToTray: boolean, autoStart: boolean, autoHideAfterLaunch: boolean, autoHideOnBlur: boolean, autoSortByLaunchCount: boolean, showCardMeta: boolean, launchMode: LaunchMode) => void;
}

function SettingsModal({ autoStart, autoHideAfterLaunch, autoHideOnBlur, autoSortByLaunchCount, closeToTray, hotkey, launchMode, onClose, onSubmit, showCardMeta }: SettingsModalProps) {
  const [nextHotkey, setNextHotkey] = useState(hotkey);
  const [nextCloseToTray, setNextCloseToTray] = useState(closeToTray);
  const [nextAutoStart, setNextAutoStart] = useState(autoStart);
  const [nextAutoHideAfterLaunch, setNextAutoHideAfterLaunch] = useState(autoHideAfterLaunch);
  const [nextAutoHideOnBlur, setNextAutoHideOnBlur] = useState(autoHideOnBlur);
  const [nextAutoSortByLaunchCount, setNextAutoSortByLaunchCount] = useState(autoSortByLaunchCount);
  const [nextShowCardMeta, setNextShowCardMeta] = useState(showCardMeta);
  const [nextLaunchMode, setNextLaunchMode] = useState<LaunchMode>(launchMode);
  const [capturingHotkey, setCapturingHotkey] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);
  const [updateError, setUpdateError] = useState("");
  const [updateStatus, setUpdateStatus] = useState<"checking" | "current" | "available" | "downloading" | "error">("checking");

  useEffect(() => {
    void refreshUpdate();
  }, []);

  async function refreshUpdate() {
    const startedAt = Date.now();
    setUpdateStatus("checking");
    setUpdateError("");
    try {
      const update = await checkForUpdate();
      const remaining = UPDATE_CHECK_FEEDBACK_MS - (Date.now() - startedAt);
      if (remaining > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, remaining));
      setAvailableUpdate(update);
      setUpdateStatus(update ? "available" : "current");
    } catch (error) {
      const remaining = UPDATE_CHECK_FEEDBACK_MS - (Date.now() - startedAt);
      if (remaining > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, remaining));
      setAvailableUpdate(null);
      setUpdateError(String(error));
      setUpdateStatus("error");
    }
  }

  async function handleUpdate() {
    if (!availableUpdate) {
      void refreshUpdate();
      return;
    }
    setUpdateStatus("downloading");
    setUpdateError("");
    try {
      await installUpdate(availableUpdate.version);
    } catch (error) {
      setUpdateError(String(error));
      setUpdateStatus("error");
    }
  }

  const displayedUpdateVersion = availableUpdate?.version.replace(/^v/i, "").replace(/\.0$/, "") ?? "";
  const updateLabel = updateStatus === "checking"
    ? "检测中..."
    : updateStatus === "downloading"
      ? "正在下载更新..."
      : updateStatus === "available"
        ? `发现新版本 ${displayedUpdateVersion}，更新`
        : updateStatus === "current"
          ? "已是最新版"
          : "检测失败，重试";
  const updateTitle = updateError || availableUpdate?.notes || (updateStatus === "current" ? "当前已是最新版，点击再次检测" : "检查更新");

  function captureHotkey(event: React.KeyboardEvent<HTMLButtonElement>) {
    event.preventDefault();
    const key = event.key === " " ? "Space" : event.key;
    if (key === "Escape") {
      setCapturingHotkey(false);
      return;
    }
    if (["Control", "Shift", "Alt", "Meta"].includes(key)) return;
    const parts = [event.ctrlKey ? "Ctrl" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : "", event.metaKey ? "Super" : "", key.length === 1 ? key.toUpperCase() : key].filter(Boolean);
    setNextHotkey(parts.join("+") || DEFAULT_HOTKEY);
    setCapturingHotkey(false);
  }

  return (
    <div className="modal-backdrop">
      <section className="modal settings-modal">
        <header><h2>设置</h2><button onClick={onClose} title="关闭" type="button"><X size={18} /></button></header>
        <div className="settings-body">
          <label className="check-row"><input checked={nextAutoStart} onChange={(event) => setNextAutoStart(event.target.checked)} type="checkbox" />开机启动</label>
          <label className="check-row"><input checked={nextCloseToTray} onChange={(event) => setNextCloseToTray(event.target.checked)} type="checkbox" />关闭窗口时最小化到托盘</label>
          <label className="check-row"><input checked={nextAutoHideAfterLaunch} onChange={(event) => setNextAutoHideAfterLaunch(event.target.checked)} type="checkbox" />运行程序后自动关闭主窗口</label>
          <label className="check-row"><input checked={nextAutoHideOnBlur} onChange={(event) => setNextAutoHideOnBlur(event.target.checked)} type="checkbox" />失去焦点后关闭主窗口</label>
          <label className="check-row"><input checked={nextAutoSortByLaunchCount} onChange={(event) => setNextAutoSortByLaunchCount(event.target.checked)} type="checkbox" />按打开次数自动排序</label>
          <label className="check-row"><input checked={nextShowCardMeta} onChange={(event) => setNextShowCardMeta(event.target.checked)} type="checkbox" />显示卡片分组与类型</label>
          <label><span>启动方式</span><div className="segmented"><button className={nextLaunchMode === "single" ? "active" : ""} onClick={() => setNextLaunchMode("single")} type="button">单击启动</button><button className={nextLaunchMode === "double" ? "active" : ""} onClick={() => setNextLaunchMode("double")} type="button">双击启动</button></div></label>
          <label><span><Keyboard size={17} />全局热键</span><button className={`hotkey-capture ${capturingHotkey ? "capturing" : ""}`} onBlur={() => setCapturingHotkey(false)} onClick={() => setCapturingHotkey(true)} onKeyDown={captureHotkey} type="button">{capturingHotkey ? "请按下快捷键..." : nextHotkey || DEFAULT_HOTKEY}</button></label>
        </div>
        <footer className="settings-footer">
          <div className="settings-about">
            <span className="settings-version">版本 {APP_VERSION}</span>
            <button
              className="update-link"
              disabled={updateStatus === "checking" || updateStatus === "downloading"}
              onClick={() => void handleUpdate()}
              title={updateTitle}
              type="button"
            >
              {updateStatus === "downloading" || updateStatus === "checking"
                ? <RefreshCw className="spinning" size={14} />
                : updateStatus === "available"
                  ? <Download size={14} />
                  : <RefreshCw size={14} />}
              <span aria-live="polite">{updateLabel}</span>
            </button>
          </div>
          <div className="footer-actions"><button className="ghost" onClick={onClose} type="button">取消</button><button className="primary" onClick={() => onSubmit(nextHotkey.trim() || DEFAULT_HOTKEY, nextCloseToTray, nextAutoStart, nextAutoHideAfterLaunch, nextAutoHideOnBlur, nextAutoSortByLaunchCount, nextShowCardMeta, nextLaunchMode)} type="button">保存</button></div>
        </footer>
      </section>
    </div>
  );
}
