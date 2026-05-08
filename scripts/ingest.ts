/**
 * scripts/ingest.ts
 *
 * One-time ingestion script for Brihat Parasara Hora Sastra PDF.
 * Run: npx ts-node scripts/ingest.ts --pdf ./bphs.pdf
 *
 * Uses:
 *  - LlamaIndex (llamaindex) for document loading + chunking
 *  - Transformers.js for local ONNX-based embeddings
 *  - Supabase JS client to upsert vectors into pgvector
 */

import fs from "fs";
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import {
  SimpleDirectoryReader,
  PDFReader,
  SentenceSplitter,
  Document,
} from "llamaindex";
import { pipeline } from "@xenova/transformers";

// ── env ───────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const PDF_PATH = process.argv[process.argv.indexOf("--pdf") + 1] ?? "./bphs.pdf";
const BATCH_SIZE = 10; // embed N chunks at once to manage memory
const EMBEDDING_MODEL = "Xenova/all-mpnet-base-v2"; // 768-dim embedding model

// ── clients ───────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Initialize embedding pipeline (lazy-loaded on first use)
let embeddingPipeline: any = null;

// ── helpers ───────────────────────────────────────────────────────────────────

/** Initialize embedding pipeline on first use */
async function getEmbeddingPipeline() {
  if (!embeddingPipeline) {
    console.log(`⏳  Loading embedding model: ${EMBEDDING_MODEL}`);
    embeddingPipeline = await pipeline("feature-extraction", EMBEDDING_MODEL);
  }
  return embeddingPipeline;
}

/** Embed a batch of strings using local transformers.js model and return float arrays */
async function embedBatch(texts: string[]): Promise<number[][]> {
  const embedder = await getEmbeddingPipeline();
  
  const outputs = await embedder(texts, {
    pooling: "mean",
    normalize: true,
  });

  // Convert tensor to array
  return outputs.tolist() as number[][];
}

/** Basic metadata extracted from BPHS chapter headings */
function extractMetadata(text: string, chunkIndex: number) {
  const chapterMatch = text.match(/chapter\s+(\d+|[IVXLC]+)/i);
  const slokaMatch = text.match(/sloka\s+(\d+)/i);
  return {
    source: "BPHS",
    chunk_index: chunkIndex,
    chapter: chapterMatch?.[1] ?? null,
    sloka: slokaMatch?.[1] ?? null,
    preview: text.slice(0, 120).replace(/\n/g, " "),
  };
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`📖  Loading PDF: ${PDF_PATH}`);
  if (!fs.existsSync(PDF_PATH)) throw new Error(`PDF not found at ${PDF_PATH}`);

  // 1. Load PDF with LlamaIndex's PDFReader
  const reader = new PDFReader();
  const rawDocs = await reader.loadData(PDF_PATH);
  console.log(`    Loaded ${rawDocs.length} raw pages.`);

  // 2. Chunk using SentenceSplitter
  //    chunkSize=512 tokens keeps context tight; overlap=64 avoids boundary loss
  const splitter = new SentenceSplitter({ chunkSize: 512, chunkOverlap: 64 });
  const chunks: { text: string; metadata: object }[] = [];

  for (const doc of rawDocs) {
    const sentences = await splitter.splitText(doc.text);
    for (const sentence of sentences) {
      if (sentence.trim().length < 40) continue; // skip noise
      chunks.push({
        text: sentence,
        metadata: extractMetadata(sentence, chunks.length),
      });
    }
  }
  console.log(`✂️   Created ${chunks.length} chunks.`);

  // 3. Embed + upsert in batches
  let inserted = 0;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) => c.text);

    let embeddings: number[][];
    try {
      embeddings = await embedBatch(texts);
    } catch (e) {
      console.error(`  Embedding error at batch ${i}:`, e);
      await sleep(5000);
      embeddings = await embedBatch(texts); // one retry
    }

    const rows = batch.map((chunk, j) => ({
      content: chunk.text,
      metadata: chunk.metadata,
      embedding: embeddings[j],
    }));

    const { error } = await supabase.from("jyotish_chunks").insert(rows);
    if (error) throw error;

    inserted += batch.length;
    process.stdout.write(`\r    Inserted ${inserted}/${chunks.length} chunks...`);
    await sleep(200); // gentle rate-limit pause
  }

  console.log(`\n✅  Done. ${inserted} chunks stored in Supabase.`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
main().catch(console.error);
