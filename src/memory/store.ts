import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { MemoryError } from "../utils/errors.js";
import { runMigrations } from "./migrations.js";

export interface Conversation {
  id: string;
  workflow_id: string;
  namespace: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown> | null;
}

export interface Message {
  id: number;
  conversation_id: string;
  role: "system" | "user" | "assistant";
  content: string;
  token_count: number | null;
  created_at: string;
}

export interface MemoryEntry {
  id: number;
  namespace: string;
  key: string;
  value: string;
  expires_at: string | null;
  created_at: string;
}

interface ConversationRow {
  id: string;
  workflow_id: string;
  namespace: string;
  created_at: string;
  updated_at: string;
  metadata: string | null;
}

export class MemoryStore {
  private db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    try {
      this.db = new Database(dbPath);
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("foreign_keys = ON");
      runMigrations(this.db);
    } catch (err) {
      throw new MemoryError(
        `Failed to initialize database at ${dbPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  createConversation(
    id: string,
    workflowId: string,
    namespace = "default",
    metadata?: Record<string, unknown>,
  ): void {
    try {
      this.db
        .prepare(
          `INSERT INTO conversations (id, workflow_id, namespace, metadata)
           VALUES (?, ?, ?, ?)`,
        )
        .run(id, workflowId, namespace, metadata ? JSON.stringify(metadata) : null);
    } catch (err) {
      throw new MemoryError(
        `Failed to create conversation ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  getConversation(id: string): Conversation | undefined {
    const row = this.db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(id) as ConversationRow | undefined;

    if (!row) return undefined;

    return {
      ...row,
      metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
    };
  }

  addMessage(
    conversationId: string,
    role: "system" | "user" | "assistant",
    content: string,
    tokenCount?: number,
  ): number {
    try {
      const result = this.db
        .prepare(
          `INSERT INTO messages (conversation_id, role, content, token_count)
           VALUES (?, ?, ?, ?)`,
        )
        .run(conversationId, role, content, tokenCount ?? null);

      this.db
        .prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?")
        .run(conversationId);

      return Number(result.lastInsertRowid);
    } catch (err) {
      throw new MemoryError(
        `Failed to add message to conversation ${conversationId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  getMessages(conversationId: string, limit?: number): Message[] {
    if (limit !== undefined) {
      return this.db
        .prepare(
          `SELECT * FROM messages WHERE conversation_id = ?
           ORDER BY id DESC LIMIT ?`,
        )
        .all(conversationId, limit) as Message[];
    }

    return this.db
      .prepare(
        `SELECT * FROM messages WHERE conversation_id = ?
         ORDER BY id ASC`,
      )
      .all(conversationId) as Message[];
  }

  setMemory(namespace: string, key: string, value: string, ttlHours?: number): void {
    const expiresAt =
      ttlHours !== undefined
        ? new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString()
        : null;

    try {
      this.db
        .prepare(
          `INSERT INTO memory_entries (namespace, key, value, expires_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(namespace, key) DO UPDATE SET
             value = excluded.value,
             expires_at = excluded.expires_at`,
        )
        .run(namespace, key, value, expiresAt);
    } catch (err) {
      throw new MemoryError(
        `Failed to set memory ${namespace}:${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  getMemory(namespace: string, key: string): string | undefined {
    const row = this.db
      .prepare(
        `SELECT value FROM memory_entries
         WHERE namespace = ? AND key = ?
           AND (expires_at IS NULL OR expires_at > datetime('now'))`,
      )
      .get(namespace, key) as { value: string } | undefined;

    return row?.value;
  }

  deleteExpiredMemory(): number {
    const result = this.db
      .prepare(
        "DELETE FROM memory_entries WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')",
      )
      .run();

    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}
