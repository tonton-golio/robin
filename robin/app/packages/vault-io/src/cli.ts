#!/usr/bin/env node

/**
 * Inspect or safely finalize pending vault mutation receipts.
 *
 * Default mode is read-only. --repair only appends a missing audit event when
 * the canonical page state already matches the receipt, then removes the
 * receipt. It never writes page bytes, completes deletes, or guesses.
 */

import fs from "node:fs";
import path from "node:path";
import { recoverPendingMutations } from "./transactions.js";

interface Options {
  vault?: string;
  repair: boolean;
  json: boolean;
}

function usage(): void {
  console.error("Usage: robin-vault-recover --vault <path> [--repair] [--json]");
  console.error(
    "       default: inspect only; --repair finalizes only provably committed mutations",
  );
}

function parseArgs(args: string[]): Options | null {
  const options: Options = { repair: false, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--vault") options.vault = args[++index];
    else if (arg === "--repair") options.repair = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") return null;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.vault) throw new Error("--vault is required");
  return options;
}

async function main(): Promise<number> {
  let options: Options | null;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    usage();
    return 2;
  }
  if (!options) {
    usage();
    return 0;
  }

  const vault = path.resolve(options.vault!);
  if (!fs.existsSync(vault) || !fs.statSync(vault).isDirectory()) {
    console.error(`vault directory does not exist: ${vault}`);
    return 2;
  }

  const results = await recoverPendingMutations(vault, { repair: options.repair });
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ repair: options.repair, results }, null, 2)}\n`);
  } else if (results.length === 0) {
    console.log("No pending vault mutations.");
  } else {
    console.log(`${results.length} pending vault mutation(s):`);
    for (const result of results) {
      console.log(
        `  ${result.transactionId} ${result.operation ?? "unknown"} ${result.status}: ${result.detail}`,
      );
    }
  }

  // Inspection mode is deliberately fail-closed: every receipt is pending
  // work, including one whose event is already present but whose receipt still
  // needs an explicit repair pass to be removed. In repair mode, successfully
  // finalized/already-recorded receipts are no longer unresolved.
  const unresolved = options.repair
    ? results.some((result) => result.status === "incomplete" || result.status === "invalid")
    : results.length > 0;
  return unresolved ? 1 : 0;
}

process.exitCode = await main();
