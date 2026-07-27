import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hideMainWindow } from "../tauri";
import type { LauncherData } from "../types";

const BLUR_HIDE_DELAY_MS = 150;
const WINDOW_MOVE_BLUR_SUPPRESSION_MS = 500;

interface UseWindowBehaviorOptions {
  autoHideOnBlur: boolean;
  modalOpen: boolean;
  lastSavedWindowSize: MutableRefObject<{ width: number; height: number } | undefined>;
  setData: Dispatch<SetStateAction<LauncherData>>;
  setStatus: (status: string) => void;
}

const TITLEBAR_BLUR_SUPPRESSION_MS = 1500;

export function useWindowBehavior({
  autoHideOnBlur,
  modalOpen,
  lastSavedWindowSize,
  setData,
  setStatus,
}: UseWindowBehaviorOptions) {
  const resizeSaveTimer = useRef<number | undefined>(undefined);
  const pendingBlurHide = useRef<number | undefined>(undefined);
  const ignoreAutoHideUntil = useRef(0);
  const autoHideOnBlurRef = useRef(autoHideOnBlur);
  const modalOpenRef = useRef(modalOpen);

  /** Call this when the user interacts with the titlebar to suppress a spurious blur-hide. */
  const suppressAutoHide = useCallback(() => {
    ignoreAutoHideUntil.current = Date.now() + TITLEBAR_BLUR_SUPPRESSION_MS;
    window.clearTimeout(pendingBlurHide.current);
    pendingBlurHide.current = undefined;
  }, []);

  // Sync autoHideOnBlur to ref
  useEffect(() => {
    autoHideOnBlurRef.current = autoHideOnBlur;
    if (!autoHideOnBlur) {
      window.clearTimeout(pendingBlurHide.current);
      pendingBlurHide.current = undefined;
    }
  }, [autoHideOnBlur]);

  // Sync modalOpen to ref
  useEffect(() => {
    modalOpenRef.current = modalOpen;
    if (modalOpen) {
      window.clearTimeout(pendingBlurHide.current);
      pendingBlurHide.current = undefined;
    }
  }, [modalOpen]);

  // Window resize handler
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
  }, [lastSavedWindowSize, setData, setStatus]);

  // Window move handler (suppress blur-hide during move)
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
  }, [setStatus]);

  // Window focus/blur handler
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const appWindow = getCurrentWindow();
    let cleanup: (() => void) | undefined;
    let disposed = false;

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
        if (!autoHideOnBlurRef.current || modalOpenRef.current) return;
        if (Date.now() < ignoreAutoHideUntil.current) return;
        cancelPendingBlurHide();
        pendingBlurHide.current = window.setTimeout(() => {
          pendingBlurHide.current = undefined;
          void appWindow
            .isFocused()
            .then((focused) => {
              if (
                focused
                || !autoHideOnBlurRef.current
                || modalOpenRef.current
                || Date.now() < ignoreAutoHideUntil.current
              ) return;
              return hideMainWindow("blur");
            })
            .catch((error) => setStatus(`窗口焦点检查失败：${String(error)}`));
        }, BLUR_HIDE_DELAY_MS);
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        cleanup = unlisten;
      })
      .catch((error) => setStatus(`窗口焦点监听失败：${String(error)}`));

    return () => {
      disposed = true;
      cancelPendingBlurHide();
      cleanup?.();
    };
  }, [setStatus]);

  return { suppressAutoHide };
}
