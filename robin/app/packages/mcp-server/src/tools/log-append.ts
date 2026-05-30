/**
 * log.append — Atomic prepend to a markdown log file under logs/.
 *
 * Writes newest-at-top. Uses tmp+rename for atomicity.
 * Injects a date-stamped ## header if entry doesn't start with one.
 */

import { z } from 'zod/v4';
import { appendLog } from '../html-utils.js';
import type { ToolContext, LogAppendOutput } from '../types.js';

export const LogAppendInputSchema = z.object({
  file: z.enum(['changelog', 'ingest']).describe("Target log file: 'changelog' or 'ingest'"),
  entry_md: z.string().min(1).describe('Markdown content to prepend'),
});

export type LogAppendInput = z.infer<typeof LogAppendInputSchema>;

export async function logAppend(
  input: LogAppendInput,
  ctx: ToolContext
): Promise<LogAppendOutput> {
  const bytesWritten = await appendLog(ctx.vaultPath, input.file, input.entry_md);
  const fileName =
    input.file === 'changelog' ? 'changelog.md' : 'ingest-log.md';

  return {
    file: `logs/${fileName}`,
    bytes_written: bytesWritten,
  };
}
