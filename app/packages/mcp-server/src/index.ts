/**
 * Public exports for @robin/mcp-server.
 *
 * Consumers can import the server factory, tool context type,
 * and individual tool handlers for testing.
 */

export { createServer, startServer, getToolList } from './server.js';
export type { ToolContext, IndexerHandle } from './types.js';

// Tool schemas (for testing / external registration)
export { PageReadInputSchema } from './tools/page-read.js';
export { PageWriteInputSchema } from './tools/page-write.js';
export { PageWriteManyInputSchema } from './tools/page-write-many.js';
export { PageCreateInputSchema } from './tools/page-create.js';
export { PageMoveInputSchema } from './tools/page-move.js';
export { PageDeleteInputSchema } from './tools/page-delete.js';
export { PageSearchInputSchema } from './tools/page-search.js';
export { PageListInputSchema } from './tools/page-list.js';
export { LinkAddInputSchema } from './tools/link-add.js';
export { LinkListInputSchema } from './tools/link-list.js';
export { LogAppendInputSchema } from './tools/log-append.js';
export { TaskCreateInputSchema } from './tools/task-create.js';
export { VaultLintInputSchema } from './tools/vault-lint.js';
export { VaultStatsInputSchema } from './tools/vault-stats.js';
export { MemorySaveInputSchema } from './tools/memory-save.js';
export { MemorySearchInputSchema } from './tools/memory-search.js';
export { MemoryListInputSchema } from './tools/memory-list.js';
export { MemoryResolveInputSchema } from './tools/memory-resolve.js';
export { KnowledgeSearchInputSchema } from './tools/knowledge-search.js';

// Utilities
export { resolveRef } from './resolve.js';
export { appendLog, slugify } from './html-utils.js';
