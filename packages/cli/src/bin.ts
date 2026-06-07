#!/usr/bin/env node
/**
 * `authai-cloud` — entrypoint published as the `npx authai-cloud` bin.
 *
 * Subcommands:
 *   init      open the browser, run the AuthAI Cloud webapp flow,
 *             write AUTH_AI_SECRET to .env
 *   help      print usage
 */

import { runInit, type InitOptions } from "./init.js";

const args = process.argv.slice(2);
const subcommand = args[0];

if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
  printHelp();
  process.exit(0);
}

if (subcommand === "init") {
  const options = parseInitFlags(args.slice(1));
  runInit(options).catch((err) => {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
} else {
  console.error(`unknown subcommand: ${subcommand}\n`);
  printHelp();
  process.exit(1);
}

/**
 * Accepts both `--flag value` and `--flag=value` shapes. Unknown flags
 * throw. We deliberately avoid `--env-file` as a flag name because
 * Node 22's built-in `--env-file=<path>` claims the same string in
 * argv before the script even runs — pass `--out <path>` instead.
 */
function parseInitFlags(rest: string[]): InitOptions {
  const opts: InitOptions = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    const [name, inlineValue] = arg.startsWith("--")
      ? splitInlineFlag(arg)
      : [arg, undefined];
    const takeValue = (): string => {
      if (inlineValue !== undefined) return inlineValue;
      const next = rest[++i];
      if (next === undefined) throw new Error(`${name} requires a value`);
      return next;
    };
    if (name === "--force") opts.force = true;
    else if (name === "--webapp") opts.webappUrl = takeValue();
    else if (name === "--relay") opts.relayUrl = takeValue();
    else if (name === "--out") opts.envFile = takeValue();
    else throw new Error(`unknown flag: ${name}`);
  }
  return opts;
}

function splitInlineFlag(arg: string): [string, string | undefined] {
  const eq = arg.indexOf("=");
  if (eq === -1) return [arg, undefined];
  return [arg.slice(0, eq), arg.slice(eq + 1)];
}

function printHelp(): void {
  console.log(`\nauthai-cloud — set up Sign-in-with-ChatGPT for your app in 30 seconds\n`);
  console.log(`Usage:\n  npx authai-cloud init [flags]\n`);
  console.log(`What it does:`);
  console.log(`  Opens your browser to AuthAI Cloud, signs you in with GitHub,`);
  console.log(`  lets you create an app, and writes the resulting AUTH_AI_SECRET`);
  console.log(`  to your project's .env file.\n`);
  console.log(`Flags:`);
  console.log(`  --webapp <url>      AuthAI Cloud webapp URL (default: https://cloud.authai.dev)`);
  console.log(`  --relay <url>       AuthAI Cloud relay URL (default: https://relay.authai.dev)`);
  console.log(`  --out <path>        write AUTH_AI_SECRET to this file (default: ./.env)`);
  console.log(`  --force             overwrite an existing AUTH_AI_SECRET in the file\n`);
  console.log(`Docs: https://cloud.authai.dev/docs\n`);
}
