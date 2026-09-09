"use server";

import path from "path";
import { revalidatePath } from "next/cache";
import { moveWithHistory } from "@robin/vault-io";
import { locateVault } from "@/lib/vault";
import { refreshIndexPaths } from "@/lib/indexer-client";
import { getMaintenanceSnapshot } from "@/lib/maintenance";
import { writeBaseline } from "./snapshot-store";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Rescan all scanners: recompute the snapshot and persist it as the new delta
 * baseline, so subsequent loads show change since this rescan. Does NOT touch
 * the shared MaintenanceSnapshot contract — the baseline is a health-page-local
 * sidecar (see snapshot-store.ts).
 */
export async function rescanAll(): Promise<ActionResult> {
  try {
    const snapshot = await getMaintenanceSnapshot({ limit: 50 });
    await writeBaseline(snapshot);
    revalidatePath("/health");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Archive a flagged output: move `out/<sub>/<file>` → `out/archive/<file>`.
 * Path is validated to stay within the vault's out/ tree before any move.
 */
export async function archiveOutput(relPath: string): Promise<ActionResult> {
  try {
    const vault = locateVault();
    const outDir = path.resolve(vault, "out");
    const abs = path.resolve(vault, relPath);
    if (abs !== outDir && !abs.startsWith(outDir + path.sep)) {
      return { ok: false, error: "path is not inside out/" };
    }
    const archiveDir = path.join(outDir, "archive");
    if (abs.startsWith(archiveDir + path.sep)) {
      return { ok: false, error: "already archived" };
    }
    const dest = path.join(archiveDir, path.basename(abs));
    const moved = await moveWithHistory({
      vaultRoot: vault,
      fromAbsolutePath: abs,
      toAbsolutePath: dest,
      origin: "web",
      tool: "health.archiveOutput",
      summary: "Archived output from maintenance health action",
    });
    if (moved.moved) {
      await refreshIndexPaths([moved.oldPath, moved.newPath]).catch((error) => {
        console.warn("[health] output archived but index refresh failed:", error);
      });
    }
    revalidatePath("/health");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
