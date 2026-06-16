import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
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
  Edit3,
  Folder,
  FolderOpen,
  Grid2X2,
  Keyboard,
  Maximize2,
  Minus,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { buildSearchKey, matchesSearch } from "./search";
import {
  assetUrl,
  chooseIcon,
  chooseTarget,
  extractIcon,
  hideMainWindow,
  launchTarget,
  loadData,
  revealDataDir,
  resolveTarget,
  saveData,
  saveWindowSize,
  updateStartup,
  updateHotkey,
} from "./tauri";
import type { Category, ItemDraft, LauncherData, LauncherItem, LaunchMode, TargetType } from "./types";

const COLORS = ["#2f80ed", "#27ae60", "#f2994a", "#eb5757", "#9b51e0", "#00a3a3"];

const emptyDraft: ItemDraft = {
  name: "",
  path: "",
  args: "",
  targetType: "program",
  categoryId: "default",
};

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function defaultData(): LauncherData {
  return {
    version: 1,
    categories: [{ id: "default", name: "常用", color: "#2f80ed", order: 0 }],
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

function isImageIconPath(path: string) {
  return /\.(png|jpe?g|ico)$/i.test(path);
}

function isExtractableIconPath(path: string) {
  return /\.(exe|lnk|link)$/i.test(path);
}

function inferType(path: string): TargetType {
  if (isShortcutPath(path)) return "shortcut";
  if (/\.exe$/i.test(path)) return "program";
  return "folder";
}

function targetLabel(targetType: TargetType) {
  if (targetType === "folder") return "文件夹";
  if (targetType === "shortcut") return "快捷方式";
  return "程序";
}

export default function App() {
  const [data, setData] = useState<LauncherData>(defaultData);
  const [dataPath, setDataPath] = useState("");
  const [status, setStatus] = useState("正在读取启动器数据...");
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resizeSaveTimer = useRef<number | undefined>(undefined);
  const ignoreAutoHideUntil = useRef(0);
  const lastSavedWindowSize = useRef<{ width: number; height: number } | undefined>(undefined);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const categories = useMemo(
    () => [...data.categories].sort((a, b) => a.order - b.order),
    [data.categories],
  );

  useEffect(() => {
    loadData()
      .then((envelope) => {
        setData({
          ...envelope.data,
          settings: { ...defaultData().settings, ...envelope.data.settings },
        });
        lastSavedWindowSize.current = envelope.data.settings.windowSize;
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
        if (event.payload.paths.length > 0) {
          void addDroppedPaths(event.payload.paths);
        }
      })
      .then((cleanup) => {
        unlisten = cleanup;
      })
      .catch((error) => setStatus(`拖动监听失败：${String(error)}`));

    return () => unlisten?.();
  }, [categories, data.items, selectedCategory]);

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
      .onFocusChanged((event) => {
        if (event.payload || !data.settings.autoHideOnBlur || draft || settingsOpen) return;
        if (Date.now() < ignoreAutoHideUntil.current) return;
        void hideMainWindow();
      })
      .then((unlisten) => {
        cleanup = unlisten;
      })
      .catch((error) => setStatus(`窗口焦点监听失败：${String(error)}`));

    return () => cleanup?.();
  }, [data.settings.autoHideOnBlur, draft, settingsOpen]);

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false;
      return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (draft || settingsOpen || event.ctrlKey || event.metaKey || event.altKey) return;
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
  }, [draft, query, settingsOpen]);

  const visibleItems = useMemo(() => {
    const searchAllCategories = Boolean(query.trim());
    return [...data.items]
      .filter((item) => searchAllCategories || selectedCategory === "all" || item.categoryId === selectedCategory)
      .filter((item) => matchesSearch(item.name, item.searchKey, query))
      .sort((a, b) => {
        if (data.settings.autoSortByLaunchCount) {
          return (b.launchCount ?? 0) - (a.launchCount ?? 0) || a.order - b.order || a.name.localeCompare(b.name, "zh-Hans-CN");
        }
        return a.order - b.order || a.name.localeCompare(b.name, "zh-Hans-CN");
      });
  }, [data.items, data.settings.autoSortByLaunchCount, query, selectedCategory]);

  const activeCategory = categories.find((category) => category.id === selectedCategory);
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of data.items) {
      counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1);
    }
    return counts;
  }, [data.items]);

  function selectedCategoryId() {
    return selectedCategory === "all" ? categories[0]?.id ?? "default" : selectedCategory;
  }

  function selectCategory(id: string) {
    setQuery("");
    setSelectedCategory(id);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function persist(updater: (value: LauncherData) => LauncherData) {
    setData((current) => updater(current));
  }

  function withReorderedItems(items: LauncherItem[], orderedIds: string[], orderValues: number[]) {
    const orderMap = new Map(orderedIds.map((id, index) => [id, orderValues[index] ?? index]));
    return items.map((item) =>
      orderMap.has(item.id) ? { ...item, order: orderMap.get(item.id) ?? item.order } : item,
    );
  }

  function handleItemDragEnd(event: DragEndEvent) {
    if (query.trim() || data.settings.autoSortByLaunchCount) return;
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : "";
    if (!overId || activeId === overId) return;

    const scopedItems = visibleItems;
    const oldIndex = scopedItems.findIndex((item) => item.id === activeId);
    const newIndex = scopedItems.findIndex((item) => item.id === overId);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(scopedItems, oldIndex, newIndex).map((item) => item.id);
    const orderValues =
      selectedCategory === "all" ? reordered.map((_, order) => order) : scopedItems.map((item) => item.order);
    persist((current) => ({ ...current, items: withReorderedItems(current.items, reordered, orderValues) }));
  }

  function reorderCategories(activeId: string, overId: string) {
    const oldIndex = categories.findIndex((category) => category.id === activeId);
    const newIndex = categories.findIndex((category) => category.id === overId);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(categories, oldIndex, newIndex).map((category, order) => ({
      ...category,
      order,
    }));
    persist((current) => ({
      ...current,
      categories: current.categories.map(
        (category) => reordered.find((value) => value.id === category.id) ?? category,
      ),
    }));
  }

  async function importTarget(path: string) {
    const resolved = await resolveTarget(path);
    const displayName = inferName(isShortcutPath(path) ? path : resolved.path);
    return {
      displayName,
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
      categoryId: selectedCategoryId(),
    };
  }

  async function hydrateDraftFromPath(originalPath: string) {
    try {
      setStatus("姝ｅ湪瑙ｆ瀽鐩爣...");
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
          item.id === itemId && !item.iconPath
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
      let shouldExtractIcon = false;
      setData((current) => {
        const duplicate = current.items.some(
          (item) => item.id !== itemId && item.path.toLowerCase() === imported.path.toLowerCase(),
        );
        if (duplicate) {
          return { ...current, items: current.items.filter((item) => item.id !== itemId) };
        }
        shouldExtractIcon = true;
        return {
          ...current,
          items: current.items.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  name: item.name === inferName(originalPath) ? imported.displayName : item.name,
                  path: imported.path,
                  args: item.args || imported.args,
                  targetType: imported.targetType,
                  searchKey: buildSearchKey(imported.displayName, `${imported.path} ${imported.args}`),
                  updatedAt: new Date().toISOString(),
                }
              : item,
          ),
        };
      });
      if (shouldExtractIcon) {
        void fillExtractedIcon(imported.path, itemId);
      }
    } catch {
      void fillExtractedIcon(originalPath, itemId);
    }
  }

  async function addDroppedPaths(paths: string[]) {
    const uniquePaths = [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
    if (uniquePaths.length === 0) return;

    if (uniquePaths.length === 1) {
      const path = uniquePaths[0];
      setDraft(instantDraftFromPath(path));
      setStatus("已读取拖入目标，请确认后保存");
      void hydrateDraftFromPath(path);
      return;
    }

    const existing = new Set(data.items.map((item) => item.path.toLowerCase()));
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
        name,
        path,
        args: "",
        targetType: inferType(path),
        categoryId,
        iconPath: undefined,
        searchKey: buildSearchKey(name, path),
        order: data.items.length + additions.length,
        launchCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (additions.length === 0) {
      setStatus("鎷栧叆鐨勭洰鏍囧凡瀛樺湪");
      return;
    }

    persist((current) => ({ ...current, items: [...current.items, ...additions] }));
    setStatus(`已添加 ${additions.length} 个拖入目标，正在后台解析`);
    additions.forEach((item) => void hydrateItemFromPath(item.path, item.id));
  }

  function addCategory(name: string) {
    name = name.trim();
    if (!name) return;
    const color = COLORS[data.categories.length % COLORS.length];
    const category: Category = {
      id: newId("cat"),
      name,
      color,
      order: data.categories.length,
    };
    persist((current) => ({ ...current, categories: [...current.categories, category] }));
    selectCategory(category.id);
  }

  function deleteCategory(id: string) {
    if (data.categories.length <= 1) {
      setStatus("至少保留一个分类");
      return;
    }
    const fallback = data.categories.find((category) => category.id !== id)?.id ?? "default";
    persist((current) => ({
      ...current,
      categories: current.categories.filter((category) => category.id !== id),
      items: current.items.map((item) =>
        item.categoryId === id ? { ...item, categoryId: fallback, updatedAt: new Date().toISOString() } : item,
      ),
    }));
    selectCategory("all");
  }

  async function pickTarget(targetType: TargetType) {
    const path = await chooseTarget(targetType);
    if (!path) return;
    setDraft((current) => ({
      ...(current ?? emptyDraft),
      name: current?.name || inferName(path),
      path,
      targetType: inferType(path),
      categoryId: current?.categoryId || categories[0]?.id || "default",
    }));
    try {
      const imported = await importTarget(path);
      setDraft((current) => ({
        ...(current ?? emptyDraft),
        path: imported.path,
        args: current?.args || imported.args,
        name: current?.name || imported.displayName,
        targetType: imported.targetType,
        categoryId: current?.categoryId || categories[0]?.id || "default",
      }));
    } catch {
      setStatus("目标解析失败，已保留原始路径");
    }
  }

  async function pickIcon() {
    const path = await chooseIcon();
    if (!path) return;
    if (isImageIconPath(path)) {
      setDraft((current) => ({ ...(current ?? emptyDraft), iconPath: path }));
      return;
    }

    if (!isExtractableIconPath(path)) return;

    try {
      setStatus("正在提取图标...");
      const source = isShortcutPath(path) ? (await resolveTarget(path)).path : path;
      const itemId = draft?.id ?? newId("icon");
      const iconPath = await extractIcon(source, itemId);
      if (!iconPath) {
        setStatus("没有读取到可用图标");
        return;
      }
      setDraft((current) => ({ ...(current ?? emptyDraft), iconPath }));
      setStatus("图标已更新");
    } catch (error) {
      setStatus(`图标提取失败：${String(error)}`);
    }
  }

  async function submitDraft() {
    if (!draft?.name.trim() || !draft.path.trim()) {
      setStatus("名称和路径不能为空");
      return;
    }
    const now = new Date().toISOString();
    const id = draft.id ?? newId("item");
    const shouldExtractIcon = !draft.iconPath;
    const item: LauncherItem = {
      id,
      name: draft.name.trim(),
      path: draft.path.trim(),
      args: draft.args.trim(),
      targetType: draft.targetType,
      categoryId: draft.categoryId || categories[0]?.id || "default",
      iconPath: draft.iconPath,
      searchKey: buildSearchKey(draft.name, `${draft.path} ${draft.args}`),
      order: draft.id ? data.items.find((value) => value.id === draft.id)?.order ?? 0 : data.items.length,
      launchCount: data.items.find((value) => value.id === draft.id)?.launchCount ?? 0,
      createdAt: data.items.find((value) => value.id === draft.id)?.createdAt ?? now,
      updatedAt: now,
    };
    persist((current) => ({
      ...current,
      items: current.items.some((value) => value.id === item.id)
        ? current.items.map((value) => (value.id === item.id ? item : value))
        : [...current.items, item],
    }));
    setDraft(null);
    setStatus("已添加，图标将在后台补齐");
    if (shouldExtractIcon) {
      void fillExtractedIcon(item.path, item.id);
    }
  }

  function removeItem(id: string) {
    persist((current) => ({ ...current, items: current.items.filter((item) => item.id !== id) }));
  }

  async function runItem(item: LauncherItem) {
    try {
      await launchTarget(item.path, item.args, item.targetType);
      persist((current) => ({
        ...current,
        items: current.items.map((value) =>
          value.id === item.id
            ? { ...value, launchCount: (value.launchCount ?? 0) + 1, updatedAt: new Date().toISOString() }
            : value,
        ),
      }));
      if (data.settings.autoHideAfterLaunch) {
        await hideMainWindow();
      }
      setStatus(`已启动 ${item.name}`);
    } catch (error) {
      setStatus(`启动失败：${String(error)}`);
    }
  }

  async function saveSettings(
    hotkey: string,
    closeToTray: boolean,
    autoStart: boolean,
    autoHideAfterLaunch: boolean,
    autoHideOnBlur: boolean,
    autoSortByLaunchCount: boolean,
    launchMode: LaunchMode,
  ) {
    try {
      const nextHotkey = hotkey.trim() || "Ctrl+Space";
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
    <main
      className={`shell ${dragActive ? "dragging" : ""}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
    >
      <WindowTitlebar
        onTitlebarInteraction={() => {
          ignoreAutoHideUntil.current = Date.now() + 1500;
        }}
      />

      <div className="main-layout">
        <aside className="sidebar">
          <button
            className={`category ${selectedCategory === "all" ? "active" : ""}`}
            onClick={() => selectCategory("all")}
            type="button"
          >
            <Grid2X2 size={18} />
            <span>全部应用</span>
            <b>{data.items.length}</b>
          </button>

          <div className="category-list">
            {categories.map((category) => (
              <button
                className={`category ${selectedCategory === category.id ? "active" : ""}`}
                key={category.id}
                onClick={() => selectCategory(category.id)}
                type="button"
              >
                <i style={{ background: category.color }} />
                <span>{category.name}</span>
                <b>{categoryCounts.get(category.id) ?? 0}</b>
              </button>
            ))}
          </div>

          <button className="settings-button" onClick={() => setSettingsOpen(true)} type="button">
            <Settings size={17} />
            设置
          </button>
        </aside>

        <section className="content">
          <header className="topbar">
            <div className="topbar-left">
              <div className="view-title">
                <p>{query ? "全部应用" : activeCategory?.name ?? "全部应用"}</p>
                <h1>{query ? `搜索：${query}` : "快速启动"}</h1>
              </div>
            </div>
            <div className="actions">
              <label className="search">
                <Search size={18} />
                <input
                  autoFocus
                  ref={searchInputRef}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索名称、英文或拼音首字母"
                  value={query}
                />
              </label>
              <button className="primary" onClick={() => setDraft({ ...emptyDraft, categoryId: categories[0]?.id ?? "default" })} type="button">
                <Plus size={18} />
                添加
              </button>
            </div>
          </header>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleItemDragEnd}>
            <SortableContext items={visibleItems.map((item) => item.id)} strategy={rectSortingStrategy}>
              <section className={`grid ${query.trim() ? "sorting-disabled" : ""}`} aria-label="启动项列表">
                {visibleItems.map((item) => (
                  <SortableAppCard
                    categoryName={categories.find((category) => category.id === item.categoryId)?.name ?? "未分类"}
                    disabled={Boolean(query.trim()) || data.settings.autoSortByLaunchCount}
                    item={item}
                    key={item.id}
                    launchMode={data.settings.launchMode}
                    onEdit={() => setDraft(item)}
                    onRun={() => runItem(item)}
                  />
                ))}

                {!visibleItems.length ? (
                  <div className="empty">
                    <img alt="" className="empty-icon" src="/app-icon.png" />
                    <h2>{query ? "没有找到匹配项" : "还没有启动项"}</h2>
                    <p>{query ? "试试应用名、英文缩写或中文拼音首字母。" : "添加常用程序或文件夹，把桌面留给真正需要看的东西。"}</p>
                    <button className="primary" onClick={() => setDraft({ ...emptyDraft, categoryId: categories[0]?.id ?? "default" })} type="button">
                      <Plus size={18} />
                      添加启动项
                    </button>
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
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onDelete={
            draft.id
              ? () => {
                  const name = draft.name.trim() || "\u8fd9\u4e2a\u542f\u52a8\u9879";
                  if (!window.confirm(`\u786e\u5b9a\u5220\u9664\u300c${name}\u300d\u5417\uff1f`)) return;
                  removeItem(draft.id!);
                  setDraft(null);
                }
              : undefined
          }
          onPickIcon={pickIcon}
          onPickTarget={pickTarget}
          onSubmit={submitDraft}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsModal
          categories={categories}
          closeToTray={data.settings.closeToTray}
          hotkey={data.settings.hotkey}
          autoStart={data.settings.autoStart}
          autoHideAfterLaunch={data.settings.autoHideAfterLaunch}
          autoHideOnBlur={data.settings.autoHideOnBlur}
          autoSortByLaunchCount={data.settings.autoSortByLaunchCount}
          launchMode={data.settings.launchMode}
          onAddCategory={addCategory}
          onClose={() => setSettingsOpen(false)}
          onDeleteCategory={deleteCategory}
          onReorderCategory={reorderCategories}
          onSubmit={saveSettings}
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

interface ItemModalProps {
  categories: Category[];
  draft: ItemDraft;
  onChange: (draft: ItemDraft) => void;
  onClose: () => void;
  onDelete?: () => void;
  onPickIcon: () => void;
  onPickTarget: (type: TargetType) => void;
  onSubmit: () => void;
}

interface WindowTitlebarProps {
  onTitlebarInteraction: () => void;
}

interface SortableAppCardProps {
  categoryName: string;
  disabled: boolean;
  item: LauncherItem;
  launchMode: LaunchMode;
  onEdit: () => void;
  onRun: () => void;
}

function SortableAppCard({ categoryName, disabled, item, launchMode, onEdit, onRun }: SortableAppCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article
      className={`app-card ${isDragging ? "drag-sorting" : ""}`}
      key={item.id}
      onDoubleClick={launchMode === "double" ? onRun : undefined}
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
    >
      <button className="app-main" onClick={launchMode === "single" ? onRun : undefined} type="button">
        <span className="app-icon">
          {item.iconPath ? <img alt="" src={assetUrl(item.iconPath)} /> : item.targetType === "folder" ? <FolderOpen size={34} /> : <AppWindow size={34} />}
        </span>
        <span className="app-name">{item.name}</span>
        <span className="app-meta">
          {targetLabel(item.targetType)}
          <i />
          {categoryName}
        </span>
      </button>
      <div className="card-tools">
        <button onPointerDown={(event) => event.stopPropagation()} onClick={onEdit} title="缂栬緫" type="button"><Edit3 size={16} /></button>
      </div>
    </article>
  );
}

function WindowTitlebar({ onTitlebarInteraction }: WindowTitlebarProps) {
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
    if (action === "minimize") {
      await appWindow.minimize();
    } else if (action === "maximize") {
      await appWindow.toggleMaximize();
    } else {
      await appWindow.close();
    }
  }

  return (
    <header className="window-titlebar">
      <div className="titlebar-drag" onMouseDown={(event) => void startDrag(event)}>
        <div className="titlebar-brand">
          <div className="brand-mark"><img alt="" src="/app-icon.png" /></div>
          <div className="brand-copy">
            <strong>Quick Launcher</strong>
            <span>桌面快速启动器</span>
          </div>
        </div>
      </div>
      <div className="window-controls">
        <button onClick={() => void control("minimize")} title="最小化" type="button">
          <Minus size={16} />
        </button>
        <button onClick={() => void control("maximize")} title="最大化/还原" type="button">
          <Maximize2 size={15} />
        </button>
        <button className="close-window" onClick={() => void control("close")} title="关闭" type="button">
          <X size={16} />
        </button>
      </div>
    </header>
  );
}

function ItemModal({ categories, draft, onChange, onClose, onDelete, onPickIcon, onPickTarget, onSubmit }: ItemModalProps) {
  return (
    <div className="modal-backdrop">
      <section className="modal">
        <header>
          <h2>{draft.id ? "编辑启动项" : "添加启动项"}</h2>
          <button onClick={onClose} title="关闭" type="button"><X size={18} /></button>
        </header>
        <div className="form-grid">
          <label>
            名称
            <input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
          </label>
          <label>
            分类
            <select value={draft.categoryId} onChange={(event) => onChange({ ...draft, categoryId: event.target.value })}>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label>
            类型
            <select value={draft.targetType} onChange={(event) => onChange({ ...draft, targetType: event.target.value as TargetType })}>
              <option value="program">程序</option>
              <option value="shortcut">快捷方式</option>
              <option value="folder">文件夹</option>
            </select>
          </label>
          <label>
            启动参数
            <input value={draft.args} onChange={(event) => onChange({ ...draft, args: event.target.value })} placeholder="可选" />
          </label>
          <label className="wide">
            路径
            <div className="inline-input">
              <input value={draft.path} onChange={(event) => onChange({ ...draft, path: event.target.value, targetType: inferType(event.target.value) })} />
              <button onClick={() => onPickTarget(draft.targetType)} type="button"><Folder size={16} />选择</button>
            </div>
          </label>
          <label className="wide">
            图标
            <div className="inline-input">
              <input value={draft.iconPath ?? ""} onChange={(event) => onChange({ ...draft, iconPath: event.target.value })} placeholder="自动提取，或手动选择图片/exe/lnk" />
              <button onClick={onPickIcon} type="button"><AppWindow size={16} />选择</button>
            </div>
          </label>
        </div>
        <footer className={onDelete ? "split-footer" : ""}>
          {onDelete ? <button className="danger" onClick={onDelete} type="button"><Trash2 size={16} />删除</button> : null}
          <div className="footer-actions">
            <button className="ghost" onClick={onClose} type="button">取消</button>
            <button className="primary" onClick={onSubmit} type="button">保存</button>
          </div>
        </footer>
      </section>
    </div>
  );
}

interface SettingsModalProps {
  autoStart: boolean;
  autoHideAfterLaunch: boolean;
  autoHideOnBlur: boolean;
  autoSortByLaunchCount: boolean;
  categories: Category[];
  closeToTray: boolean;
  hotkey: string;
  launchMode: LaunchMode;
  onAddCategory: (name: string) => void;
  onClose: () => void;
  onDeleteCategory: (id: string) => void;
  onReorderCategory: (activeId: string, overId: string) => void;
  onSubmit: (
    hotkey: string,
    closeToTray: boolean,
    autoStart: boolean,
    autoHideAfterLaunch: boolean,
    autoHideOnBlur: boolean,
    autoSortByLaunchCount: boolean,
    launchMode: LaunchMode,
  ) => void;
}

function SettingsModal({
  autoStart,
  autoHideAfterLaunch,
  autoHideOnBlur,
  autoSortByLaunchCount,
  categories,
  closeToTray,
  hotkey,
  launchMode,
  onAddCategory,
  onClose,
  onDeleteCategory,
  onReorderCategory,
  onSubmit,
}: SettingsModalProps) {
  const [nextHotkey, setNextHotkey] = useState(hotkey);
  const [nextCloseToTray, setNextCloseToTray] = useState(closeToTray);
  const [nextAutoStart, setNextAutoStart] = useState(autoStart);
  const [nextAutoHideAfterLaunch, setNextAutoHideAfterLaunch] = useState(autoHideAfterLaunch);
  const [nextAutoHideOnBlur, setNextAutoHideOnBlur] = useState(autoHideOnBlur);
  const [nextAutoSortByLaunchCount, setNextAutoSortByLaunchCount] = useState(autoSortByLaunchCount);
  const [nextLaunchMode, setNextLaunchMode] = useState<LaunchMode>(launchMode);
  const [nextCategory, setNextCategory] = useState("");
  const [capturingHotkey, setCapturingHotkey] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function submitCategory() {
    const name = nextCategory.trim();
    if (!name) return;
    onAddCategory(name);
    setNextCategory("");
  }

  function captureHotkey(event: React.KeyboardEvent<HTMLButtonElement>) {
    event.preventDefault();
    const key = event.key === " " ? "Space" : event.key;
    if (key === "Escape") {
      setCapturingHotkey(false);
      return;
    }
    if (["Control", "Shift", "Alt", "Meta"].includes(key)) return;
    const parts = [
      event.ctrlKey ? "Ctrl" : "",
      event.altKey ? "Alt" : "",
      event.shiftKey ? "Shift" : "",
      event.metaKey ? "Super" : "",
      key.length === 1 ? key.toUpperCase() : key,
    ].filter(Boolean);
    setNextHotkey(parts.join("+") || "Ctrl+Space");
    setCapturingHotkey(false);
  }

  function handleCategoryDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : "";
    if (overId && activeId !== overId) {
      onReorderCategory(activeId, overId);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="modal settings-modal">
        <header>
          <h2>设置</h2>
          <button onClick={onClose} title="关闭" type="button"><X size={18} /></button>
        </header>
        <div className="settings-body">
          <label className="check-row">
            <input checked={nextAutoStart} onChange={(event) => setNextAutoStart(event.target.checked)} type="checkbox" />
            开机启动
          </label>
          <label className="check-row">
            <input checked={nextCloseToTray} onChange={(event) => setNextCloseToTray(event.target.checked)} type="checkbox" />
            关闭窗口时最小化到托盘
          </label>
          <label className="check-row">
            <input checked={nextAutoHideAfterLaunch} onChange={(event) => setNextAutoHideAfterLaunch(event.target.checked)} type="checkbox" />
            运行程序后自动关闭主窗口
          </label>
          <label className="check-row">
            <input checked={nextAutoHideOnBlur} onChange={(event) => setNextAutoHideOnBlur(event.target.checked)} type="checkbox" />
            失去焦点后关闭主窗口
          </label>
          <label className="check-row">
            <input checked={nextAutoSortByLaunchCount} onChange={(event) => setNextAutoSortByLaunchCount(event.target.checked)} type="checkbox" />
            按打开次数自动排序
          </label>
          <label>
            <span>启动方式</span>
            <div className="segmented">
              <button className={nextLaunchMode === "single" ? "active" : ""} onClick={() => setNextLaunchMode("single")} type="button">单击启动</button>
              <button className={nextLaunchMode === "double" ? "active" : ""} onClick={() => setNextLaunchMode("double")} type="button">双击启动</button>
            </div>
          </label>
          <label>
            <span><Keyboard size={17} /> 全局热键</span>
            <button
              className={`hotkey-capture ${capturingHotkey ? "capturing" : ""}`}
              onBlur={() => setCapturingHotkey(false)}
              onClick={() => setCapturingHotkey(true)}
              onKeyDown={captureHotkey}
              type="button"
            >
              {capturingHotkey ? "请按下快捷键..." : nextHotkey || "Ctrl+Space"}
            </button>
          </label>
        <section className="settings-section">
          <div className="settings-section-title">
            <strong>分类管理</strong>
            <span>{categories.length} 个分类</span>
          </div>
          <div className="settings-category-create">
            <input
              aria-label="新分类名称"
              onChange={(event) => setNextCategory(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && submitCategory()}
              placeholder="新分类名称"
              value={nextCategory}
            />
            <button onClick={submitCategory} type="button"><Plus size={16} />添加</button>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCategoryDragEnd}>
            <SortableContext items={categories.map((category) => category.id)} strategy={verticalListSortingStrategy}>
              <div className="settings-category-list">
                {categories.map((category) => (
                  <SortableCategoryRow
                    category={category}
                    disabledDelete={categories.length <= 1}
                    key={category.id}
                    onDelete={() => onDeleteCategory(category.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </section>
        </div>
        <footer>
          <button className="ghost" onClick={onClose} type="button">取消</button>
          <button
            className="primary"
            onClick={() =>
              onSubmit(
                nextHotkey.trim() || "Ctrl+Space",
                nextCloseToTray,
                nextAutoStart,
                nextAutoHideAfterLaunch,
                nextAutoHideOnBlur,
                nextAutoSortByLaunchCount,
                nextLaunchMode,
              )
            }
            type="button"
          >
            保存
          </button>
        </footer>
      </section>
    </div>
  );
}

interface SortableCategoryRowProps {
  category: Category;
  disabledDelete: boolean;
  onDelete: () => void;
}

function SortableCategoryRow({ category, disabledDelete, onDelete }: SortableCategoryRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: category.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      className={`settings-category-row ${isDragging ? "drag-sorting" : ""}`}
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
    >
      <i style={{ background: category.color }} />
      <span>{category.name}</span>
      <button
        disabled={disabledDelete}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onDelete}
        title={disabledDelete ? "至少保留一个分类" : "删除分类"}
        type="button"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}
