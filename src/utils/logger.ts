import pino from "pino";

export function createLogger(name: string, level?: string): pino.Logger {
  return pino({
    name,
    level: level ?? process.env.LOG_LEVEL ?? "info",
  });
}
