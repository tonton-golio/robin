/**
 * MCP stdio server for the Robin brain vault.
 *
 * Registers all tools via the @modelcontextprotocol/sdk and binds to stdio.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z, ZodError } from 'zod/v4';

import type { ToolContext } from './types.js';

// Tool handlers
import { PageReadInputSchema, pageRead } from './tools/page-read.js';
import { PageWriteInputSchema, pageWrite } from './tools/page-write.js';
import { PageWriteManyInputSchema, pageWriteMany } from './tools/page-write-many.js';
import { PageCreateInputSchema, pageCreate } from './tools/page-create.js';
import { PageMoveInputSchema, pageMove } from './tools/page-move.js';
import { PageDeleteInputSchema, pageDelete } from './tools/page-delete.js';
import { PageSearchInputSchema, pageSearch } from './tools/page-search.js';
import { PageListInputSchema, pageList } from './tools/page-list.js';
import { LinkAddInputSchema, linkAdd } from './tools/link-add.js';
import { LinkListInputSchema, linkList } from './tools/link-list.js';
import { LogAppendInputSchema, logAppend } from './tools/log-append.js';
import { TaskCreateInputSchema, taskCreate } from './tools/task-create.js';
import { TaskUpdateInputSchema, taskUpdate } from './tools/task-update.js';
import { IndexRefreshInputSchema, indexRefresh } from './tools/index-refresh.js';
import { VaultLintInputSchema, vaultLint } from './tools/vault-lint.js';
import { VaultStatsInputSchema, vaultStats } from './tools/vault-stats.js';
import { MemorySaveInputSchema, memorySave } from './tools/memory-save.js';
import { MemorySearchInputSchema, memorySearch } from './tools/memory-search.js';
import { MemoryListInputSchema, memoryList } from './tools/memory-list.js';
import { MemoryResolveInputSchema, memoryResolve } from './tools/memory-resolve.js';
import { KnowledgeSearchInputSchema, knowledgeSearch } from './tools/knowledge-search.js';

// ── Tool registry ──────────────────────────────────────────────────────────

interface ToolDef {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: z.ZodType<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (input: any, ctx: ToolContext) => Promise<unknown>;
}

const TOOLS: ToolDef[] = [
  {
    name: 'page.read',
    description: 'Read a Robin page by slug or vault-relative path. Returns meta, frontmatter, blocks, body HTML, and link graph.',
    schema: PageReadInputSchema,
    handler: pageRead,
  },
  {
    name: 'page.write',
    description: 'Update an existing page. Pass body_md to replace the body; frontmatter is merged (pass null on a field to clear it). Body input is markdown only (v0.2).',
    schema: PageWriteInputSchema,
    handler: pageWrite,
  },
  {
    name: 'page.write_many',
    description: 'Batch write multiple pages. Errors are per-item; does not short-circuit. Critical for ingest-meeting.',
    schema: PageWriteManyInputSchema,
    handler: pageWriteMany,
  },
  {
    name: 'page.create',
    description: 'Create a new page. Errors on slug collision (409). folder is vault-relative, e.g. brain/tasks.',
    schema: PageCreateInputSchema,
    handler: pageCreate,
  },
  {
    name: 'page.move',
    description: 'Move/rename a page on disk. Does NOT rewrite incoming wikilinks (they resolve by slug via index).',
    schema: PageMoveInputSchema,
    handler: pageMove,
  },
  {
    name: 'page.delete',
    description: 'Delete or archive a page. archive=true (default) moves to nearest sibling archive/ folder.',
    schema: PageDeleteInputSchema,
    handler: pageDelete,
  },
  {
    name: 'page.search',
    description: 'Full-text + vector search. Returns mode=fallback with empty hits if indexer is unavailable.',
    schema: PageSearchInputSchema,
    handler: pageSearch,
  },
  {
    name: 'page.list',
    description: 'List pages with metadata filtering. Uses indexer if available, falls back to filesystem scan.',
    schema: PageListInputSchema,
    handler: pageList,
  },
  {
    name: 'link.add',
    description: "Add a named link from one page to another. kind defaults to 'ref'.",
    schema: LinkAddInputSchema,
    handler: linkAdd,
  },
  {
    name: 'link.list',
    description: "List links for a page. direction: 'in' (backlinks, default), 'out', or 'both'.",
    schema: LinkListInputSchema,
    handler: linkList,
  },
  {
    name: 'log.append',
    description: 'Atomic prepend to logs/changelog.md or logs/ingest-log.md. Injects date header if missing.',
    schema: LogAppendInputSchema,
    handler: logAppend,
  },
  {
    name: 'task.create',
    description: 'Create a task page (in brain/tasks/) and log it to the changelog. Slug derived from title. New tasks open with canonical robin:status="open".',
    schema: TaskCreateInputSchema,
    handler: taskCreate,
  },
  {
    name: 'task.update',
    description: "Update a task's lifecycle status (and optionally priority/owner/due) on an existing page. Writes canonical robin:status, preserves the body, and appends a changelog line. The first-class way to move a task to in-progress/done/blocked.",
    schema: TaskUpdateInputSchema,
    handler: taskUpdate,
  },
  {
    name: 'index.refresh',
    description: 'Force a full vault rescan into the SQLite index (search/backlinks/resolution). Writes do not incrementally update the index; run this after a batch of writes. Same scan as the web /api/resync. Returns mode=no-index if the server has no indexer.',
    schema: IndexRefreshInputSchema,
    handler: indexRefresh,
  },
  {
    name: 'vault.lint',
    description: 'Run structural lint checks: frontmatter completeness, broken wikilinks, orphans, staleness.',
    schema: VaultLintInputSchema,
    handler: vaultLint,
  },
  {
    name: 'vault.stats',
    description: 'Aggregate vault statistics: page counts by type/tier, links, broken links, ambiguous slugs.',
    schema: VaultStatsInputSchema,
    handler: vaultStats,
  },
  {
    name: 'memory.save',
    description: 'Save a durable Robin memory with provenance. Exact duplicates increment seen_count instead of creating noise.',
    schema: MemorySaveInputSchema,
    handler: memorySave,
  },
  {
    name: 'memory.search',
    description: 'Search promoted Robin memories from brain/memory/events.jsonl.',
    schema: MemorySearchInputSchema,
    handler: memorySearch,
  },
  {
    name: 'memory.list',
    description: 'List promoted Robin memories with status/type/scope/tag filters.',
    schema: MemoryListInputSchema,
    handler: memoryList,
  },
  {
    name: 'memory.resolve',
    description: 'Mark a Robin memory active, tentative, superseded, rejected, or archived with a resolution note.',
    schema: MemoryResolveInputSchema,
    handler: memoryResolve,
  },
  {
    name: 'knowledge.search',
    description: 'Unified repo knowledge search: promoted memories plus indexed brain/out pages.',
    schema: KnowledgeSearchInputSchema,
    handler: knowledgeSearch,
  },
];

export function getToolList() {
  return TOOLS.map((t) => ({ name: t.name, description: t.description }));
}

// ── Server bootstrap ───────────────────────────────────────────────────────

export async function createServer(ctx: ToolContext): Promise<Server> {
  const server = new Server(
    { name: 'robin', version: '0.0.1' },
    { capabilities: { tools: {} } }
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: z.toJSONSchema(t.schema, { io: 'input' }),
    })),
  }));

  // Call tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }

    let parsed: unknown;
    try {
      parsed = tool.schema.parse(args ?? {});
    } catch (err) {
      if (err instanceof ZodError) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid arguments for ${name}: ${err.issues.map((i) => i.message).join('; ')}`
        );
      }
      throw err;
    }

    try {
      const result = await tool.handler(parsed, ctx);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      // MCP errors from tools (slug ambiguity, not found, etc.)
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        typeof (err as { code: unknown }).code === 'number'
      ) {
        const e = err as { code: number; message: string; data?: unknown };
        throw new McpError(e.code, e.message, e.data);
      }
      // Generic errors
      throw new McpError(
        ErrorCode.InternalError,
        err instanceof Error ? err.message : String(err)
      );
    }
  });

  return server;
}

export async function startServer(ctx: ToolContext): Promise<void> {
  const server = await createServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until process exit
}
