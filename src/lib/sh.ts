/**
 * Runtime-agnostic subprocess layer.
 *
 * The CLI ships as plain JS and must run under `npx` (Node) as well as `bunx`, so nothing here may
 * touch Bun-only APIs. Everything the tool does is a shell-out to `gh`; this is the whole surface.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pExecFile = promisify(execFile);

/** Issue lists on a large repo blow past the default 1MB stdout buffer. */
const MAX_BUFFER = 64 * 1024 * 1024;

let verbose = false;

/** Enable command echoing (`--verbose`). Off by default; stderr is always surfaced on failure. */
export function setVerbose(on: boolean): void {
  verbose = on;
}

export class CommandError extends Error {
  constructor(
    readonly cmd: string,
    readonly code: number,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super(`\`${cmd}\` exited ${code}\n${stderr.trim() || stdout.trim()}`);
    this.name = "CommandError";
  }
}

export interface RunResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a command, never throwing. Use when a non-zero exit is a meaningful answer. */
export async function tryRun(cmd: string, args: string[], cwd?: string): Promise<RunResult> {
  if (verbose) console.error(`$ ${cmd} ${args.join(" ")}`);
  try {
    const { stdout, stderr } = await pExecFile(cmd, args, { cwd, maxBuffer: MAX_BUFFER });
    return { ok: true, code: 0, stdout, stderr };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { code?: number | string; stdout?: string; stderr?: string };
    // ENOENT surfaces as a string code; a real non-zero exit surfaces as a number.
    const code = typeof e.code === "number" ? e.code : 127;
    return { ok: false, code, stdout: e.stdout ?? "", stderr: e.stderr ?? String(e.message ?? err) };
  }
}

/** Run a command, throwing CommandError on non-zero exit. stderr is preserved in the message. */
export async function run(cmd: string, args: string[], cwd?: string): Promise<string> {
  const res = await tryRun(cmd, args, cwd);
  if (!res.ok) throw new CommandError(`${cmd} ${args.join(" ")}`, res.code, res.stdout, res.stderr);
  return res.stdout;
}
