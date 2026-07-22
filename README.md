# Quick Launcher

Quick Launcher 是一个面向 Windows 桌面的快速启动器，用来集中管理常用程序、快捷方式和文件夹。它提供分类、搜索、图标提取、托盘常驻和全局热键，适合替代桌面上堆满的快捷方式。

## 截图

主窗口：

![Quick Launcher 主窗口](docs/main-window.png)

设置页面：

![Quick Launcher 设置页面](docs/settings-window.png)

## 功能介绍

- 添加和管理程序、快捷方式、系统文件夹启动项
- 新建 Markdown 备忘录，支持应用内编辑和 GFM 预览
- 新建、重命名和浏览应用管理的真实文件夹，支持嵌套层级与面包屑导航
- 可将启动项或备忘录拖入应用文件夹；程序会生成 `.lnk`，原目标不会被移动
- 添加外部 `.lnk` 时会复制快捷方式到应用管理目录，保留原始快捷方式不变
- 支持从应用内编辑、替换和删除已管理的启动项，并将受管理文件移入回收站
- 分类侧栏与应用网格视图，支持拖拽排序和备忘录默认分类
- 支持名称搜索、英文缩写搜索和中文拼音首字母搜索
- 自动提取程序或快捷方式图标，也支持手动选择图片、exe、lnk 作为图标来源
- 支持单击或双击启动模式
- 支持为启动项配置按间隔或按星期/时间的定时启动
- 可从启动项菜单直接打开所在目录的资源管理器或终端
- 支持将外部 PNG、JPG、JPEG、ICO 图标复制到应用目录并随数据保存
- 全局热键唤起窗口，默认 `Alt+R`
- 托盘常驻，关闭窗口时可隐藏到托盘
- 支持运行启动项后自动关闭主窗口
- 支持主窗口失去焦点后自动关闭
- 启动项和设置保存到 exe 同目录的 `launcher-data.json`
- 支持开机自启动配置
- 记忆主窗口尺寸
- 支持按打开次数自动排序启动项
- 支持从 Gitee Release 检查并安装新版本
- 原生启动失败时提供明确的目标路径和错误信息

## 技术栈

- Tauri v2：桌面应用容器、系统托盘、窗口管理和原生命令
- Rust：本地文件读写、快捷方式解析、图标提取、启动项执行、注册表自启动
- React 18：前端界面
- TypeScript：类型约束
- Vite：前端构建
- dnd-kit：拖拽排序
- lucide-react：界面图标
- Windows API：快捷方式解析、文件图标读取和开机启动注册

## 本地开发

安装依赖：

```powershell
npm.cmd install
```

启动 Tauri 开发模式：

```powershell
npm.cmd run tauri:dev
```

只调试前端：

```powershell
npm.cmd run dev
```

构建前端：

```powershell
npm.cmd run build
```

## 打包

Tauri 打包需要安装 Rust 工具链：

```powershell
winget install Rustlang.Rustup
```

重新打开终端后确认：

```powershell
rustc --version
cargo --version
```

生成 Windows 安装包：

```powershell
npm.cmd run tauri:build
```

当前版本：`1.23.0`

构建产物位于：

```text
src-tauri/target/release/quick-launcher.exe
src-tauri/target/release/bundle/
```

## 项目结构

```text
src/                  React 前端代码
src-tauri/            Tauri 与 Rust 原生能力
src-tauri/icons/      应用图标资源
public/app-icon.png   前端使用的应用图标
```

## 数据说明

运行时数据默认保存在 exe 同目录：

```text
launcher-data.json
icons/
launcher-workspace/
```

这些路径已加入 `.gitignore`，不会提交到仓库。`launcher-workspace/` 存放由应用创建的 Markdown 文件和快捷方式；删除受管理内容时会移入 Windows 回收站。
