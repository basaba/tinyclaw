/**
 * Human-friendly schedule labels — mirrors the TUI's
 * `formatScheduleDisplay` in src/tui/components/workflow-list.tsx.
 *
 * Examples:
 *   "every 5 min"          -> "every 5 min"
 *   "30 9 * * *"           -> "daily 9:30 AM"
 *   "0 8 *_/2 * *"         -> "every 2d 8:00 AM"  (slash-after-asterisk)
 *   "15 10 * * 1"          -> "Mon 10:15 AM"
 *   "@reboot"              -> "@reboot"           (passthrough)
 */
const DAILY_CRON_RE = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/;
const NDAY_CRON_RE = /^(\d{1,2})\s+(\d{1,2})\s+\*\/(\d+)\s+\*\s+\*$/;
const WEEKLY_CRON_RE = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+([0-6])$/;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function cronTimeStr(minute: string, hourStr: string): string {
  const h = parseInt(hourStr, 10);
  const m = minute.padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

export function formatScheduleDisplay(schedule: string): string {
  if (!schedule) return "—";
  const s = schedule.trim();

  const cm = DAILY_CRON_RE.exec(s);
  if (cm) return `daily ${cronTimeStr(cm[1], cm[2])}`;

  const nd = NDAY_CRON_RE.exec(s);
  if (nd) return `every ${nd[3]}d ${cronTimeStr(nd[1], nd[2])}`;

  const wk = WEEKLY_CRON_RE.exec(s);
  if (wk) return `${DAY_NAMES[parseInt(wk[3], 10)]} ${cronTimeStr(wk[1], wk[2])}`;

  return s;
}
