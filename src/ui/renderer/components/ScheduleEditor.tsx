import React, { useEffect, useMemo, useState } from "react";

type Mode = "interval" | "daily" | "weekly" | "raw";
type Unit = "min" | "hour" | "day";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const INTERVAL_RE = /^every\s+(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hr|hours?|d|day|days?)$/i;
const DAILY_CRON_RE = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/;
const NDAY_CRON_RE = /^(\d{1,2})\s+(\d{1,2})\s+\*\/(\d+)\s+\*\s+\*$/;
const WEEKLY_CRON_RE = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+([0-6])$/;

interface Parsed {
  mode: Mode;
  num: string;
  unit: Unit;
  dow: number;
  time: string; // HH:MM
}

function parseSchedule(s: string): Parsed {
  const t = (s || "").trim();
  const m = INTERVAL_RE.exec(t);
  if (m) {
    const u = m[2].toLowerCase();
    const unit: Unit = u.startsWith("d") ? "day" : u.startsWith("h") ? "hour" : "min";
    return { mode: "interval", num: m[1], unit, dow: 1, time: "09:00" };
  }
  const nd = NDAY_CRON_RE.exec(t);
  if (nd) {
    const minute = nd[1].padStart(2, "0");
    const hour = nd[2].padStart(2, "0");
    return { mode: "interval", num: nd[3], unit: "day", dow: 1, time: `${hour}:${minute}` };
  }
  const wk = WEEKLY_CRON_RE.exec(t);
  if (wk) {
    const minute = wk[1].padStart(2, "0");
    const hour = wk[2].padStart(2, "0");
    return { mode: "weekly", num: "1", unit: "day", dow: parseInt(wk[3], 10), time: `${hour}:${minute}` };
  }
  const cm = DAILY_CRON_RE.exec(t);
  if (cm) {
    const minute = cm[1].padStart(2, "0");
    const hour = cm[2].padStart(2, "0");
    return { mode: "daily", num: "1", unit: "day", dow: 1, time: `${hour}:${minute}` };
  }
  return { mode: "raw", num: "5", unit: "min", dow: 1, time: "09:00" };
}

function serialize(p: Parsed, raw: string): string {
  if (p.mode === "raw") return raw.trim();
  const [h, m] = p.time.split(":");
  const hh = parseInt(h || "0", 10);
  const mm = parseInt(m || "0", 10);
  if (p.mode === "weekly") return `${mm} ${hh} * * ${p.dow}`;
  if (p.mode === "daily") return `${mm} ${hh} * * *`;
  if (p.unit === "day") {
    const num = parseInt(p.num.trim() || "1", 10);
    const dayExpr = num === 1 ? "*" : `*/${num}`;
    return `${mm} ${hh} ${dayExpr} * *`;
  }
  return `every ${p.num.trim() || "1"} ${p.unit}`;
}

interface Props {
  value: string;
  onChange: (next: string) => void;
}

export function ScheduleEditor({ value, onChange }: Props) {
  const initial = useMemo(() => parseSchedule(value), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [num, setNum] = useState(initial.num);
  const [unit, setUnit] = useState<Unit>(initial.unit);
  const [dow, setDow] = useState<number>(initial.dow);
  const [time, setTime] = useState(initial.time);
  const [raw, setRaw] = useState(value);

  useEffect(() => {
    const next = serialize({ mode, num, unit, dow, time }, raw);
    if (next !== value) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, num, unit, dow, time, raw]);

  return (
    <div className="schedule-editor">
      <div className="schedule-row">
        <select className="form-input" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          <option value="interval">Every …</option>
          <option value="daily">Daily at …</option>
          <option value="weekly">Weekly on …</option>
          <option value="raw">Custom cron</option>
        </select>

        {mode === "interval" && (
          <>
            <input
              className="form-input mono"
              type="number"
              min={1}
              value={num}
              onChange={(e) => setNum(e.target.value)}
              style={{ width: 80 }}
            />
            <select className="form-input" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
              <option value="min">minutes</option>
              <option value="hour">hours</option>
              <option value="day">days</option>
            </select>
            {unit === "day" && (
              <input
                className="form-input mono"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            )}
          </>
        )}

        {mode === "daily" && (
          <input
            className="form-input mono"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        )}

        {mode === "weekly" && (
          <>
            <select
              className="form-input"
              value={dow}
              onChange={(e) => setDow(parseInt(e.target.value, 10))}
            >
              {DAYS.map((d, i) => (
                <option key={i} value={i}>{d}</option>
              ))}
            </select>
            <input
              className="form-input mono"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </>
        )}

        {mode === "raw" && (
          <input
            className="form-input mono"
            value={raw}
            placeholder="*/5 * * * *"
            onChange={(e) => setRaw(e.target.value)}
            style={{ flex: 1 }}
          />
        )}
      </div>

      <div className="schedule-preview">
        <span className="schedule-preview-label">Cron:</span>
        <code>{serialize({ mode, num, unit, dow, time }, raw) || "—"}</code>
      </div>
    </div>
  );
}
