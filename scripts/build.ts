#!/usr/bin/env bun
/**
 * Bundle the CLI and the programmatic API to plain Node-compatible ESM.
 *
 * The output must run under `npx` on stock Node — shipping TypeScript, or anything Bun-specific,
 * would make the provisioning half of this package unusable for most consumers.
 */

import { chmodSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist");

rmSync(OUT, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [join(ROOT, "src", "cli.ts"), join(ROOT, "src", "index.ts")],
  outdir: OUT,
  target: "node",
  format: "esm",
  // Not minified on purpose: this is a tool people debug in their own CI logs.
  minify: false,
  sourcemap: "none",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// `bin` entries need the shebang and the exec bit; Bun.build emits neither.
const cli = join(OUT, "cli.js");
if (!existsSync(cli)) {
  console.error("build produced no dist/cli.js");
  process.exit(1);
}
const source = await Bun.file(cli).text();
await Bun.write(cli, `#!/usr/bin/env node\n${source}`);
chmodSync(cli, 0o755);

for (const output of result.outputs) {
  console.log(`built ${output.path.replace(ROOT + "/", "")}`);
}
