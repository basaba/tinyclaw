import dotenv from "dotenv";
import { z } from "zod";
import { ConfigError } from "./utils/errors.js";

const configSchema = z.object({
  COPILOT_API_KEY: z.string().optional(),
  COPILOT_CLI_URL: z.string().optional(),
  SQLITE_PATH: z.string().default("./lobster-copilot.db"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  MCP_TRANSPORT: z.enum(["stdio", "sse"]).default("stdio"),
  MEMORY_TTL_HOURS: z.coerce.number().default(168),
  CONTEXT_TOKEN_BUDGET: z.coerce.number().default(8000),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(): AppConfig {
  dotenv.config();

  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new ConfigError(`Invalid configuration: ${details}`);
  }

  return result.data;
}
