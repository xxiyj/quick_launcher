import React, { type ReactNode } from "react";
import type { Language } from "./types";

const en: Record<string, string> = {
  "新启动项": "New item", "网址": "Website", "文件夹": "Folder", "快捷方式": "Shortcut", "程序": "Program",
  "备忘录": "Memo", "应用文件夹": "App folder", "正在读取启动器数据...": "Loading launcher data...",
  "已准备好": "Ready", "数据目录不可写": "Data folder is not writable", "已保存": "Saved", "拖动监听失败：": "Drag and drop failed: ",
  "已切换为深色模式": "Switched to dark mode", "已切换为浅色模式": "Switched to light mode", "正在解析目标...": "Resolving target...",
  "目标已解析，请确认后保存": "Target resolved. Review it and save.", "目标解析失败，已保留原始路径：": "Could not resolve target. The original path was kept: ",
  "正在解析拖入目标...": "Resolving dropped target...", "已读取实际目标，请确认后保存": "Target resolved. Review it and save.",
  "已读取拖入目标，请确认后保存": "Dropped target resolved. Review it and save.", "拖入的目标已存在": "This item is already in the list",
  "已新建分组": "Group created", "分组名称不能为空": "Group name cannot be empty", "分组名称已更新": "Group name updated",
  "至少保留一个分组": "Keep at least one group", "删除分组": "Delete group", "全部": "All", "未分组": "Ungrouped",
  "目标解析失败，已保留原始路径": "Could not resolve target. The original path was kept", "正在保存图标...": "Saving icon...",
  "正在提取图标...": "Extracting icon...", "没有读取到可用图标": "No usable icon found", "图标已保存到应用目录": "Icon saved to the app folder",
  "图标已更新": "Icon updated", "图标处理失败：": "Could not process icon: ", "名称和路径不能为空": "Name and path are required",
  "网址必须以 http:// 或 https:// 开头": "Website address must start with http:// or https://", "保存图标失败：": "Could not save icon: ",
  "正在放入文件夹...": "Moving into folder...", "快捷方式备份失败：": "Could not back up shortcut: ", "已放入文件夹，图标将在后台补齐": "Moved into folder. The icon will be added in the background",
  "已添加，图标将在后台补齐": "Added. The icon will be added in the background", "正在读取备忘录...": "Loading memo...",
  "备忘录已打开": "Memo opened", "备忘录标题不能为空": "Memo title cannot be empty", "备忘录已保存": "Memo saved",
  "文件夹名称不能为空": "Folder name cannot be empty", "文件夹已重命名": "Folder renamed", "文件夹已创建": "Folder created",
  "删除文件夹": "Delete folder", "删除备忘录": "Delete memo", "删除启动项": "Delete item", "已删除": "Deleted",
  "定时启动已保存": "Schedule saved", "定时启动已关闭": "Schedule disabled", "设置已更新": "Settings updated",
  "文件夹路径": "Folder path", "返回根目录": "Back to root", "搜索名称、备忘录或拼音首字母": "Search names, memos, or initials",
  "新建内容": "Create", "启动项列表": "Items", "没有找到匹配项": "No matches found", "这里还没有内容": "Nothing here yet",
  "试试标题、备忘录正文、英文缩写或中文拼音首字母。": "Try a title, memo text, acronym, or initials.",
  "添加快捷方式，或新建备忘录。": "Add a shortcut or create a memo.", "添加快捷方式": "Add shortcut",
  "新建备忘录": "New memo", "可直接拖入快捷方式": "Drop shortcuts here", "保存中...": "Saving...",
  "数据目录": "Data folder", "释放以添加启动项": "Drop to add items", "支持 exe、lnk 快捷方式和文件夹": "Supports EXE files, shortcuts, and folders",
  "关闭确认": "Close confirmation", "取消": "Cancel", "删除": "Delete", "新建分组": "New group", "新分组名称": "New group name",
  "分组名称": "Group name", "设置": "Settings", "编辑分组名称": "Edit group name", "编辑分组": "Edit group",
  "重命名": "Rename", "编辑备忘录": "Edit memo", "编辑": "Edit", "已设置定时启动": "Scheduled",
  "定时": "Scheduled", "放入文件夹": "Move into folder", "操作菜单": "Actions", "运行": "Run", "定时启动": "Schedule",
  "用资源管理器打开": "Open in File Explorer", "在终端中打开": "Open in Terminal", "新建菜单": "Create menu",
  "添加启动项": "Add item", "新建文件夹": "New folder", "桌面快速启动器": "Desktop Quick Launcher",
  "切换为深色模式": "Switch to dark mode", "切换为浅色模式": "Switch to light mode", "最小化": "Minimize",
  "最大化/还原": "Maximize/Restore", "关闭": "Close", "名称": "Name", "分组": "Group",
  "分组根目录": "Group root", "类型": "Type", "系统文件夹": "System folder", "启动参数": "Launch arguments",
  "可选": "Optional", "路径": "Path", "选择": "Browse", "图标": "Icon", "自动提取，或手动选择图片/exe/lnk": "Auto-detect or choose an image, EXE, or shortcut",
  "标题": "Title", "预览": "Preview", "备忘录 Markdown 内容": "Memo Markdown content", "使用 Markdown 记录内容": "Write your memo in Markdown",
  "重命名文件夹": "Rename folder", "启用定时启动": "Enable schedule", "开机自动启动": "Launch at startup",
  "启动方式": "Launch behavior", "按间隔启动": "At intervals", "每天定时启动": "At set times each day",
  "常用间隔": "Common intervals", "分钟": "min", "自定义间隔": "Custom interval", "每周日期": "Days of week",
  "每天时间": "Daily times", "移除时间": "Remove time", "添加启动时间": "Add start time", "检测中...": "Checking...",
  "正在下载更新...": "Downloading update...", "已是最新版": "You're up to date", "检测失败，重试": "Check failed. Retry",
  "当前已是最新版，点击再次检测": "You're up to date. Click to check again", "检查更新": "Check for updates",
  "开机启动": "Launch at startup", "关闭窗口时最小化到托盘": "Minimize to tray when closing",
  "运行程序后自动关闭主窗口": "Close the main window after launching", "失去焦点后关闭主窗口": "Close the main window when focus is lost",
  "按打开次数自动排序": "Sort by launch count", "显示卡片分组与类型": "Show group and type on cards",
  "单击启动": "Single-click to launch", "双击启动": "Double-click to launch", "全局热键": "Global hotkey",
  "请按下快捷键...": "Press a shortcut...", "版本": "Version", "保存": "Save", "周一": "Mon", "周二": "Tue",
  "周三": "Wed", "周四": "Thu", "周五": "Fri", "周六": "Sat", "周日": "Sun",
};

const zh = Object.fromEntries(Object.entries(en).map(([key, value]) => [value, key]));

function translateString(value: string, language: Language) {
  const dynamic: Array<[RegExp, string | ((...parts: string[]) => string)]> = language === "en"
    ? [
      [/^保存失败：(.*)$/u, "Save failed: $1"], [/^拖动监听失败：(.*)$/u, "Drag and drop failed: $1"],
      [/^已移入「(.+)」$/u, "Moved to “$1”"], [/^移动失败：(.*)$/u, "Move failed: $1"],
      [/^删除「(.+)」后，其中 (\d+) 项内容将移入「全部」。$/u, "Deleting “$1” will move $2 items to “All”."],
      [/^将删除「(.+)」及其所有内容。受管理的文件会移入回收站。$/u, "Delete “$1” and all its contents? Managed files will be moved to the Recycle Bin."],
      [/^将删除「(.+)」。受管理的文件会移入回收站。$/u, "Delete “$1”? Managed files will be moved to the Recycle Bin."],
      [/^已添加 (\d+) 个拖入目标，正在后台解析$/u, "Added $1 dropped items. Resolving them in the background"],
      [/^保存文件夹失败：(.*)$/u, "Could not save folder: $1"], [/^保存备忘录失败：(.*)$/u, "Could not save memo: $1"],
      [/^启动失败：(.*)$/u, "Launch failed: $1"], [/^启动项保存失败：(.*)$/u, "Could not save item: $1"],
      [/^开机自动启动设置失败：(.*)$/u, "Could not update launch at startup: $1"], [/^设置保存失败：(.*)$/u, "Could not save settings: $1"],
    ]
    : [
      [/^Save failed: (.*)$/u, "保存失败：$1"], [/^Drag and drop failed: (.*)$/u, "拖动监听失败：$1"],
      [/^Moved to “(.+)”$/u, "已移入「$1」"], [/^Move failed: (.*)$/u, "移动失败：$1"],
      [/^Deleting “(.+)” will move (\d+) items to “All”\.$/u, "删除「$1」后，其中 $2 项内容将移入「全部」。"],
      [/^Delete “(.+)” and all its contents\? Managed files will be moved to the Recycle Bin\.$/u, "将删除「$1」及其所有内容。受管理的文件会移入回收站。"],
      [/^Delete “(.+)”\? Managed files will be moved to the Recycle Bin\.$/u, "将删除「$1」。受管理的文件会移入回收站。"],
      [/^Added (\d+) dropped items\. Resolving them in the background$/u, "已添加 $1 个拖入目标，正在后台解析"],
      [/^Could not save folder: (.*)$/u, "保存文件夹失败：$1"], [/^Could not save memo: (.*)$/u, "保存备忘录失败：$1"],
      [/^Launch failed: (.*)$/u, "启动失败：$1"], [/^Could not save item: (.*)$/u, "启动项保存失败：$1"],
      [/^Could not update launch at startup: (.*)$/u, "开机自动启动设置失败：$1"], [/^Could not save settings: (.*)$/u, "设置保存失败：$1"],
    ];
  for (const [pattern, replacement] of dynamic) {
    if (pattern.test(value)) return value.replace(pattern, replacement as string);
  }
  if (language === "zh") return zh[value] ?? value;
  return en[value] ?? value;
}

function localizeNode(node: ReactNode, language: Language): ReactNode {
  if (typeof node === "string") return translateString(node, language);
  if (typeof node === "number" || node == null || typeof node === "boolean") return node;
  return React.Children.map(node, (child) => {
    if (!React.isValidElement<Record<string, unknown>>(child)) return localizeNode(child, language);
    const props = { ...child.props };
    for (const key of ["title", "placeholder", "aria-label"]) {
      if (typeof props[key] === "string") props[key] = translateString(props[key] as string, language);
    }
    if (props.children !== undefined) props.children = localizeNode(props.children as ReactNode, language);
    return React.cloneElement(child, props);
  });
}

export function Localized({ language, children }: { language: Language; children: ReactNode }) {
  return <>{localizeNode(children, language)}</>;
}
