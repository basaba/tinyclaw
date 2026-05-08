import * as readline from 'node:readline';

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

export function evaluateExpression(
  input: string,
  snapshot: DebugSnapshot,
): { output: string } | { error: string } | { exit: true } {
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

  if (trimmed === '.args') {
    return { output: formatValue(snapshot.args) };
  }

  if (trimmed === '.env') {
    return { output: formatValue(snapshot.env) };
  }

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
      ].join('\n'),
    };
  }

  // ${env:VAR} — env variable
  const envMatch = trimmed.match(/^\$\{env:([A-Za-z0-9_-]+)\}$/);
  if (envMatch) {
    const key = envMatch[1];
    if (key in snapshot.env) {
      return { output: snapshot.env[key] };
    }
    return { error: `Environment variable not found: ${key}` };
  }

  // ${argName} — arg value
  const argMatch = trimmed.match(/^\$\{([A-Za-z0-9_-]+)\}$/);
  if (argMatch) {
    const key = argMatch[1];
    if (key in snapshot.args) {
      return { output: formatValue(snapshot.args[key]) };
    }
    return { error: `Argument not found: ${key}` };
  }

  // $stepId.field — step ref
  const refMatch = trimmed.match(/^\$([A-Za-z0-9_-]+)\.(.+)$/);
  if (refMatch) {
    const [, stepId, fieldPath] = refMatch;
    if (!(stepId in snapshot.steps)) {
      return { error: `Unknown step: ${stepId}` };
    }
    const result = snapshot.steps[stepId];
    const parts = fieldPath.split('.');
    let current: unknown = result;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') {
        return { error: `Cannot access '${part}' on ${typeof current}` };
      }
      current = (current as Record<string, unknown>)[part];
    }
    return { output: formatValue(current) };
  }

  // $stepId (bare) — full step result
  const bareMatch = trimmed.match(/^\$([A-Za-z0-9_-]+)$/);
  if (bareMatch) {
    const id = bareMatch[1];
    if (id in snapshot.steps) {
      return { output: formatValue(snapshot.steps[id]) };
    }
    return { error: `Unknown step: ${id}` };
  }

  return { error: `Unrecognized expression: ${trimmed}. Type .help for usage.` };
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

function buildCompleter(snapshot: DebugSnapshot): readline.Completer {
  const dotCommands = ['.steps', '.args', '.env', '.help', '.exit', '.quit'];
  const stepIds = Object.keys(snapshot.steps);
  const argNames = Object.keys(snapshot.args);
  const envKeys = Object.keys(snapshot.env);

  return (line: string): [string[], string] => {
    const trimmed = line.trimStart();

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
      // Navigate to the parent object
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
  const rl = readline.createInterface({
    input: input as any,
    output: output as any,
    prompt: 'debug> ',
    terminal: true,
    completer: buildCompleter(snapshot),
  });

  // Ensure terminal cursor is visible (may be hidden by TUI frameworks)
  output.write('\x1B[?25h');
  output.write(`\nDebug session for workflow: ${snapshot.workflowName ?? snapshot.workflowFile}\n`);
  output.write(`Run ID: ${snapshot.runId} | Status: ${snapshot.status} | ${Object.keys(snapshot.steps).length} step(s)\n`);
  output.write('Type .help for available commands, .exit to quit.\n\n');

  rl.prompt();

  return new Promise<void>((resolve) => {
    rl.on('line', (line) => {
      const result = evaluateExpression(line, snapshot);
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
