declare module "@clawdbot/lobster/core" {
  export function runToolRequest(params: {
    pipeline?: string;
    filePath?: string;
    args?: Record<string, unknown>;
    ctx?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      llmAdapters?: Record<string, any>;
      registry?: any;
      [key: string]: any;
    };
  }): Promise<{
    ok: boolean;
    output?: any[];
    error?: { type: string; message: string };
  }>;

  export function createDefaultRegistry(): {
    get(name: string): any;
    list(): string[];
  };
}

declare module "@basaba/lobster/core" {
  export function runToolRequest(params: {
    pipeline?: string;
    filePath?: string;
    args?: Record<string, unknown>;
    ctx?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      llmAdapters?: Record<string, any>;
      registry?: any;
      [key: string]: any;
    };
  }): Promise<{
    ok: boolean;
    output?: any[];
    error?: { type: string; message: string };
  }>;

  export function createDefaultRegistry(): {
    get(name: string): any;
    list(): string[];
  };
}
