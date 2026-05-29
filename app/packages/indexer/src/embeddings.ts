/**
 * Embeddings wrapper for the Robin indexer.
 *
 * Uses Transformers.js with the all-MiniLM-L6-v2 model (384-dim, MIT, no API key).
 *
 * ROBIN_EMBED_MODE=stub  → returns deterministic hash-based vectors for tests.
 *                           No model download needed.
 * (default)               → loads the real model on first call and caches it.
 */

/** Embedding dimension for all-MiniLM-L6-v2 */
export const EMBEDDING_DIM = 384;

type EmbeddingPipeline = {
  (text: string, opts: Record<string, unknown>): Promise<{ data: Float32Array }>;
};

let pipelineCache: EmbeddingPipeline | null = null;
let pipelineLoading: Promise<EmbeddingPipeline> | null = null;

async function getEmbeddingPipeline(): Promise<EmbeddingPipeline> {
  if (pipelineCache) return pipelineCache;
  if (pipelineLoading) return pipelineLoading;

  pipelineLoading = (async () => {
    // Dynamic import to allow tree-shaking and avoid loading in stub mode
    const { pipeline } = await import('@huggingface/transformers');
    const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    pipelineCache = pipe as unknown as EmbeddingPipeline;
    return pipelineCache;
  })();

  return pipelineLoading;
}

/**
 * Produce a deterministic stub embedding from a string.
 * Uses a simple polynomial hash spread across 384 dimensions.
 * Guaranteed to be consistent for the same input within a process.
 */
function stubEmbed(text: string): Float32Array {
  const vec = new Float32Array(EMBEDDING_DIM);
  // Seed with hash
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    // Mix hash with index for distinct per-dimension values
    let val = h ^ (i * 2654435761);
    val ^= val >>> 17;
    val = Math.imul(val, 0xbf58476d1ce4e5b9 & 0xffffffff);
    val ^= val >>> 31;
    vec[i] = ((val & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  }
  // L2-normalize
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) norm += vec[i]! * vec[i]!;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < EMBEDDING_DIM; i++) vec[i]! /= norm;
  return vec;
}

/**
 * Embed a single text string into a 384-dim float32 vector.
 *
 * In stub mode (ROBIN_EMBED_MODE=stub), returns a deterministic hash-based vector.
 * In production mode, loads all-MiniLM-L6-v2 on first call.
 */
export async function embed(text: string): Promise<Float32Array> {
  const stubMode = process.env['ROBIN_EMBED_MODE'] === 'stub';
  if (stubMode) {
    return stubEmbed(text);
  }

  const pipe = await getEmbeddingPipeline();
  const result = await pipe(text, { pooling: 'mean', normalize: true });
  return result.data;
}

/**
 * Synchronous embed (only works in stub mode).
 * Throws in production mode — use async embed() there.
 */
export function embedSync(text: string): Float32Array {
  const stubMode = process.env['ROBIN_EMBED_MODE'] === 'stub';
  if (!stubMode) {
    throw new Error('embedSync() is only available in stub mode (ROBIN_EMBED_MODE=stub)');
  }
  return stubEmbed(text);
}

/**
 * Serialize a Float32Array to a Buffer for storage in sqlite-vec.
 * sqlite-vec expects raw IEEE-754 little-endian float32 bytes.
 */
export function serializeEmbedding(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

/**
 * Deserialize a Buffer from sqlite-vec back to a Float32Array.
 */
export function deserializeEmbedding(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
