declare module "@basaba/lobster/core" {
  import { Writable, Readable } from "node:stream";

  export function runToolRequest(params: {
    pipeline?: string;
    filePath?: string;
    args?: Record<string, unknown>;
    ctx?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      stdin?: Readable;
      stdout?: Writable;
      stderr?: Writable;
      llmAdapters?: Record<string, any>;
      registry?: any;
      [key: string]: any;
    };
  }): Promise<{
    ok: boolean;
    output?: any[];
    error?: { type: string; message: string };
    status?: string;
    requiresApproval?: any;
  }>;

  export function resumeToolRequest(params: {
    token: string;
    approved: boolean;
    cancel?: boolean;
    ctx?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      stdin?: Readable;
      stdout?: Writable;
      stderr?: Writable;
      llmAdapters?: Record<string, any>;
      registry?: any;
      [key: string]: any;
    };
  }): Promise<{
    ok: boolean;
    output?: any[];
    error?: { type: string; message: string };
    status?: string;
    requiresApproval?: any;
  }>;

  export function createDefaultRegistry(): {
    get(name: string): any;
    list(): string[];
  };
}
