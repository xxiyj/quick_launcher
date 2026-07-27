import type { LauncherItem, LaunchSchedule, TargetType } from "./types";

export const DEFAULT_DAILY_TIME = "08:00";
export const WEEKDAYS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 7, label: "周日" },
] as const;

export function isValidScheduleTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  return Number(match[1]) < 24 && Number(match[2]) < 60;
}

export function normalizeLaunchSchedule(schedule?: LaunchSchedule): LaunchSchedule {
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

export function localScheduleDay(now: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function localScheduleTime(now: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function localScheduleWeekday(now: Date) {
  return now.getDay() || 7;
}

export function isLauncher(item: LauncherItem): item is LauncherItem & { kind: "launcher"; targetType: TargetType; args: string } {
  return item.kind === "launcher" && Boolean(item.targetType);
}
