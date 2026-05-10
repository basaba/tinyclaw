import * as readline from 'node:readline';
import { PassThrough } from 'node:stream';

// lobster/core exports these at runtime but lacks .d.ts declarations
const lobsterCore: Promise<{
  parsePipeline: (input: string) => any[];
  runPipeline: (opts: any) => Promise<{ items: any[]; rendered: boolean; halted: boolean }>;
  createDefaultRegistry: () => { get: (name: string) => any; list: () => string[] };
}> = import('@basaba/lobster/core') as any;

export interface DebugSnapshot {
  runId: string;
  timestamp: string;
  workflowFile: string;
  workflowName?: string;
  args: Record<string, unknown>;
  env: Record<string, string>;
  steps: Record<string, WorkflowStepResult>;
  status: string;
}

export interface WorkflowStepResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  json?: unknown;
  error?: boolean;
  errorMessage?: string;
  skipped?: boolean;
  approved?: boolean;
  [key: string]: unknown;
}

function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function stepSummary(id: string, result: WorkflowStepResult): string {
  if (result.error) return `${id} — error: ${result.errorMessage ?? 'unknown'}`;
  if (result.skipped) return `${id} — skipped`;
  if (result.approved === true) return `${id} — approved`;
  if (result.approved === false) return `${id} — rejected`;
  return `${id} — ok`;
}

function getByPath(obj: any, path: string): any {
  const parts = path.split('.').filter(Boolean);
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

// ── Source expression resolution ─────────────────────────────────────

function resolveSource(expr: string, snapshot: DebugSnapshot): { value: unknown } | { error: string } {
  const trimmed = expr.trim();

  // ${env:VAR}
  const envMatch = trimmed.match(/^\$\{env:([A-Za-z0-9_-]+)\}$/);
  if (envMatch) {
    const key = envMatch[1];
    return key in snapshot.env ? { value: snapshot.env[key] } : { error: `Environment variable not found: ${key}` };
  }

  // ${argName}
  const argMatch = trimmed.match(/^\$\{([A-Za-z0-9_-]+)\}$/);
  if (argMatch) {
    const key = argMatch[1];
    return key in snapshot.args ? { value: snapshot.args[key] } : { error: `Argument not found: ${key}` };
  }

  // $stepId.field.path
  const refMatch = trimmed.match(/^\$([A-Za-z0-9_-]+)\.(.+)$/);
  if (refMatch) {
    const [, stepId, fieldPath] = refMatch;
    if (!(stepId in snapshot.steps)) return { error: `Unknown step: ${stepId}` };
    const result = snapshot.steps[stepId];
    const value = getByPath(result, fieldPath);
    return { value };
  }

  // $stepId (bare)
  const bareMatch = trimmed.match(/^\$([A-Za-z0-9_-]+)$/);
  if (bareMatch) {
    const id = bareMatch[1];
    if (id in snapshot.steps) return { value: snapshot.steps[id] };
    return { error: `Unknown step: ${id}` };
  }

  return { error: `Cannot resolve source: ${trimmed}` };
}

// ── Pipeline execution via lobster SDK ───────────────────────────────

function splitFirstPipe(input: string): { source: string; pipelineText: string } | null {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === '|' && !inSingle && !inDouble) {
      return {
        source: input.slice(0, i).trim(),
        pipelineText: input.slice(i + 1).trim(),
      };
    }
  }
  return null;
}

async function runPipelineExpression(
  source: unknown,
  pipelineText: string,
): Promise<{ output: string } | { error: string }> {
  try {
    const { parsePipeline, runPipeline, createDefaultRegistry } = await lobsterCore;
    const pipeline = parsePipeline(pipelineText);
    const registry = createDefaultRegistry();

    const stdout = new PassThrough();
    const stderr = new PassThrough();

    // Convert source to async iterable input
    const inputData = Array.isArray(source) ? source : [source];
    async function* toInput() {
      for (const item of inputData) yield item;
    }

    const result = await runPipeline({
      pipeline,
      registry,
      stdin: process.stdin,
      stdout,
      stderr,
      env: process.env,
      mode: 'tool',
      input: toInput(),
    });

    stdout.end();
    stderr.end();

    const items = result.items;
    if (items.length === 0) return { output: '(empty)' };
    if (items.length === 1) return { output: formatValue(items[0]) };
    return { output: formatValue(items) };
  } catch (e: any) {
    return { error: `Pipeline error: ${e.message}` };
  }
}

// ── Main evaluator ───────────────────────────────────────────────────

export async function evaluateExpression(
  input: string,
  snapshot: DebugSnapshot,
): Promise<{ output: string } | { error: string } | { exit: true }> {
  const trimmed = input.trim();
  if (!trimmed) return { output: '' };

  if (trimmed === '.exit' || trimmed === '.quit') {
    return { exit: true };
  }

  if (trimmed === '.steps') {
    const lines = Object.entries(snapshot.steps).map(
      ([id, result]) => stepSummary(id, result),
    );
    return { output: lines.length ? lines.join('\n') : '(no steps)' };
  }

  if (trimmed === '.args') return { output: formatValue(snapshot.args) };
  if (trimmed === '.env') return { output: formatValue(snapshot.env) };

  if (trimmed === '.help') {
    return {
      output: [
        'Debug REPL commands:',
        '  $step.field        — inspect step result (e.g. $fetch.stdout, $parse.json.items)',
        '  $step              — full step result object',
        '  ${argName}         — workflow argument value',
        '  ${env:VAR}         — workflow environment variable',
        '  .steps             — list all steps and their statuses',
        '  .args              — dump all resolved args',
        '  .env               — dump workflow env',
        '  .help              — show this help',
        '  .exit / .quit      — exit the REPL',
        '',
        'Pipeline support (uses lobster SDK — all lobster commands available):',
        '  $step.json | where field=value    — filter items',
        '  $step.json | sort --key name      — sort items',
        '  $step.json | pick id,name         — project fields',
        '  $step.json | head --n 5           — first N items',
        '  $step.json | tail --n 5           — last N items',
        '  $step.json | count                — count items',
        '  $step.json | groupBy --key status — group by field',
        '  $step.json | dedupe --key id      — deduplicate',
        '  $step.json | compute field=expr   — add computed fields',
        '',
        '  Chains:  $prs.json | where status=active | sort --key date | head --n 3',
      ].join('\n'),
    };
  }

  // Check for pipeline (source | commands...)
  const pipelineSplit = splitFirstPipe(trimmed);

  if (pipelineSplit) {
    const sourceResult = resolveSource(pipelineSplit.source, snapshot);
    if ('error' in sourceResult) return sourceResult;
    return runPipelineExpression(sourceResult.value, pipelineSplit.pipelineText);
  }

  // Single expression (no pipeline)
  const result = resolveSource(trimmed, snapshot);
  if ('error' in result) {
    return { error: `${result.error}. Type .help for usage.` };
  }
  return { output: formatValue(result.value) };
}

export async function readDebugSnapshot(filePath: string): Promise<DebugSnapshot> {
  const fs = await import('node:fs/promises');
  const raw = await fs.readFile(filePath, 'utf-8');
  const data = JSON.parse(raw);
  if (!data.runId || !data.steps) {
    throw new Error(`Invalid debug snapshot: missing required fields`);
  }
  return data as DebugSnapshot;
}

// ── Autocomplete ─────────────────────────────────────────────────────

let cachedCommandNames: string[] | null = null;

async function getLobsterCommandNames(): Promise<string[]> {
  if (cachedCommandNames) return cachedCommandNames;
  try {
    const { createDefaultRegistry } = await lobsterCore;
    const registry = createDefaultRegistry();
    cachedCommandNames = registry.list();
    return cachedCommandNames;
  } catch {
    cachedCommandNames = [
      'where', 'count', 'head', 'tail', 'sort', 'pick', 'groupBy',
      'dedupe', 'compute', 'map', 'emit', 'table', 'json',
    ];
    return cachedCommandNames;
  }
}

function buildCompleter(snapshot: DebugSnapshot, pipeCommands: string[]): readline.Completer {
  const dotCommands = ['.steps', '.args', '.env', '.help', '.exit', '.quit'];
  const stepIds = Object.keys(snapshot.steps);
  const argNames = Object.keys(snapshot.args);
  const envKeys = Object.keys(snapshot.env);

  return (line: string): [string[], string] => {
    const trimmed = line.trimStart();

    // After a pipe: complete pipeline command names
    const pipeIdx = trimmed.lastIndexOf('|');
    if (pipeIdx >= 0) {
      const afterPipe = trimmed.slice(pipeIdx + 1).trimStart();
      if (!afterPipe.includes(' ')) {
        const hits = pipeCommands
          .filter((c) => c.startsWith(afterPipe))
          .map((c) => trimmed.slice(0, pipeIdx + 1) + ' ' + c);
        return [hits, trimmed];
      }
      return [[], trimmed];
    }

    // Dot commands
    if (trimmed.startsWith('.')) {
      const hits = dotCommands.filter((c) => c.startsWith(trimmed));
      return [hits, trimmed];
    }

    // ${env:...} completion
    const envPrefix = trimmed.match(/^\$\{env:([A-Za-z0-9_-]*)$/);
    if (envPrefix) {
      const partial = envPrefix[1];
      const hits = envKeys
        .filter((k) => k.startsWith(partial))
        .map((k) => `\${env:${k}}`);
      return [hits, trimmed];
    }

    // ${arg} completion
    const argPrefix = trimmed.match(/^\$\{([A-Za-z0-9_-]*)$/);
    if (argPrefix) {
      const partial = argPrefix[1];
      const hits = argNames
        .filter((k) => k.startsWith(partial))
        .map((k) => `\${${k}}`);
      return [hits, trimmed];
    }

    // $step.field completion
    const fieldPrefix = trimmed.match(/^\$([A-Za-z0-9_-]+)\.(.*)$/);
    if (fieldPrefix) {
      const [, stepId, partialField] = fieldPrefix;
      if (!(stepId in snapshot.steps)) return [[], trimmed];
      const result = snapshot.steps[stepId];
      const parts = partialField.split('.');
      let current: unknown = result;
      const resolvedParts = parts.slice(0, -1);
      for (const p of resolvedParts) {
        if (current == null || typeof current !== 'object') return [[], trimmed];
        current = (current as Record<string, unknown>)[p];
      }
      if (current == null || typeof current !== 'object') return [[], trimmed];
      const lastPart = parts[parts.length - 1];
      const keys = Object.keys(current as object);
      const prefix = `$${stepId}.${resolvedParts.length ? resolvedParts.join('.') + '.' : ''}`;
      const hits = keys
        .filter((k) => k.startsWith(lastPart))
        .map((k) => `${prefix}${k}`);
      return [hits, trimmed];
    }

    // $step completion (bare)
    const stepPrefix = trimmed.match(/^\$([A-Za-z0-9_-]*)$/);
    if (stepPrefix) {
      const partial = stepPrefix[1];
      const hits = stepIds
        .filter((id) => id.startsWith(partial))
        .map((id) => `$${id}`);
      return [hits, trimmed];
    }

    return [[], trimmed];
  };
}

export async function startDebugRepl(
  snapshot: DebugSnapshot,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<void> {
  const pipeCommands = await getLobsterCommandNames();

  const rl = readline.createInterface({
    input: input as any,
    output: output as any,
    prompt: 'debug> ',
    terminal: true,
    completer: buildCompleter(snapshot, pipeCommands),
  });

  // Ensure terminal cursor is visible (may be hidden by TUI frameworks)
  output.write('\x1B[?25h');
  output.write(`\nDebug session for workflow: ${snapshot.workflowName ?? snapshot.workflowFile}\n`);
  output.write(`Run ID: ${snapshot.runId} | Status: ${snapshot.status} | ${Object.keys(snapshot.steps).length} step(s)\n`);
  output.write('Type .help for available commands, .exit to quit.\n\n');

  rl.prompt();

  return new Promise<void>((resolve) => {
    rl.on('line', async (line) => {
      const result = await evaluateExpression(line, snapshot);
      if ('exit' in result) {
        rl.close();
        return;
      }
      if ('error' in result) {
        output.write(`Error: ${result.error}\n`);
      } else if (result.output) {
        output.write(`${result.output}\n`);
      }
      rl.prompt();
    });

    rl.on('close', () => {
      resolve();
    });
  });
}

