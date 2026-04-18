import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MemoryStore } from "../../memory/store.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("mcp:resources:memory");

export function registerMemoryResources(server: McpServer, store: MemoryStore): void {
  // Resource template for individual memory entries
  server.resource(
    "memory-entry",
    new ResourceTemplate("memory://{namespace}/{key}", { list: undefined }),
    async (uri, variables) => {
      const namespace = String(variables.namespace);
      const key = String(variables.key);

      logger.debug({ namespace, key }, "Reading memory entry");

      const value = store.getMemory(namespace, key);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: value ?? "",
          },
        ],
      };
    },
  );

  // Static resource listing all conversations
  server.resource(
    "conversations",
    "memory://conversations",
    async (uri) => {
      logger.debug("Listing conversations");

      const db = (store as unknown as { db: { prepare: (sql: string) => { all: () => unknown[] } } }).db;
      const rows = db.prepare("SELECT id, workflow_id, namespace, created_at, updated_at FROM conversations ORDER BY updated_at DESC").all();

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(rows, null, 2),
          },
        ],
      };
    },
  );
}
