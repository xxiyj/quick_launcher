import { useEffect, useRef } from "react";
import type { LauncherData, LauncherItem } from "../types";
import { isLauncher, localScheduleDay, localScheduleTime, localScheduleWeekday, normalizeLaunchSchedule } from "../utils";

interface UseSchedulerOptions {
  items: LauncherData["items"];
  loaded: boolean;
  onRunItem: (item: LauncherItem, source: "scheduled") => void;
}

export function useScheduler({ items, loaded, onRunItem }: UseSchedulerOptions) {
  const dailyScheduleRuns = useRef(new Set<string>());
  const lastScheduleDayRef = useRef<string | null>(null);
  const intervalScheduleState = useRef(new Map<string, { signature: string; lastRunAt: number }>());

  useEffect(() => {
    if (!loaded) return;

    const checkSchedules = () => {
      const now = new Date();
      const nowMs = now.getTime();
      const time = localScheduleTime(now);
      const day = localScheduleDay(now);
      const weekday = localScheduleWeekday(now);

      // Clear the daily-run set when the calendar day rolls over so scheduled
      // tasks that already ran yesterday are allowed to run again today.
      if (lastScheduleDayRef.current !== null && lastScheduleDayRef.current !== day) {
        dailyScheduleRuns.current = new Set();
      }
      lastScheduleDayRef.current = day;
      const activeIntervalIds = new Set<string>();

      for (const item of items) {
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
            onRunItem(item, "scheduled");
          }
          continue;
        }

        if (!schedule.weekdays.includes(weekday) || !schedule.dailyTimes.includes(time)) continue;
        const runKey = `${item.id}:${day}:${time}`;
        if (dailyScheduleRuns.current.has(runKey)) continue;
        dailyScheduleRuns.current.add(runKey);
        onRunItem(item, "scheduled");
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
  }, [items, loaded, onRunItem]);
}
