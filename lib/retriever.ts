/**
 * lib/retriever.ts
 *
 * Wraps Supabase pgvector similarity search + local Xenova embeddings
 * into a clean retrieve() function used by the chat API route.
 */

import { createClient } from "@supabase/supabase-js";
import { pipeline } from "@xenova/transformers";

// Set Xenova to use memory cache only (Vercel serverless is read-only)
process.env.HF_HOME = "/tmp/.huggingface";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Initialize embedding pipeline (lazy-loaded on first use)
let embeddingPipeline: any = null;

async function getEmbeddingPipeline() {
  if (!embeddingPipeline) {
    embeddingPipeline = await pipeline("feature-extraction", "Xenova/all-mpnet-base-v2", {
      cache_dir: "/tmp/.huggingface/transformers",
    });
  }
  return embeddingPipeline;
}

export interface RetrievedChunk {
  id: number;
  content: string;
  metadata: {
    chapter?: string;
    sloka?: string;
    preview?: string;
    [key: string]: unknown;
  };
  similarity: number;
}

/**
 * Embed a query and fetch top-k similar chunks from Supabase.
 */
export async function retrieve(
  query: string,
  topK = 8,
  threshold = 0.68
): Promise<RetrievedChunk[]> {
  // 1. Embed the user query
  const embedder = await getEmbeddingPipeline();
  const output = await embedder(query, {
    pooling: "mean",
    normalize: true,
  });
  const queryEmbedding = output.tolist()[0] as number[];

  // 2. Supabase RPC → pgvector cosine similarity search
  // Note: explicitly call with null for optional filter_sources parameter
  const { data, error } = await supabase.rpc("match_jyotish_chunks", {
    query_embedding: queryEmbedding,
    match_threshold: threshold,
    match_count: topK,
  } as any);

  if (error) throw new Error(`Supabase retrieval error: ${error.message}`);

  return (data ?? []) as RetrievedChunk[];
}

/**
 * Format retrieved chunks into a context string for the LLM prompt.
 */
export function buildContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "No relevant passages found.";

  return chunks
    .map((c, i) => {
      const loc = [
        c.metadata.chapter ? `Chapter ${c.metadata.chapter}` : null,
        c.metadata.sloka ? `Śloka ${c.metadata.sloka}` : null,
      ]
        .filter(Boolean)
        .join(", ");

      return `[${i + 1}]${loc ? ` (${loc})` : ""}\n${c.content}`;
    })
    .join("\n\n---\n\n");
}
