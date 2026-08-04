/** Minimal flag parser. No dependency is worth taking for this. */

export interface Args {
  _: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const body = a.slice(2);
    // Support --key=value as well as --key value.
    const eq = body.indexOf("=");
    if (eq !== -1) {
      out.flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out.flags[body] = true;
    } else {
      out.flags[body] = next;
      i++;
    }
  }
  return out;
}

export function str(args: Args, key: string): string | undefined {
  const v = args.flags[key];
  return typeof v === "string" ? v : undefined;
}

export function bool(args: Args, key: string): boolean {
  return args.flags[key] === true || args.flags[key] === "true";
}

/** Comma-separated list flag: `--agent-files AGENTS.md,CLAUDE.md`. */
export function list(args: Args, key: string): string[] | undefined {
  const v = str(args, key);
  if (v === undefined) return undefined;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}
