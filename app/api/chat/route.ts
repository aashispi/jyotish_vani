/**
 * app/api/chat/route.ts
 *
 * POST /api/chat
 * Body: { message: string, language?: SarvamLanguageCode, sessionId?: string }
 *
 * Flow:
 *  1. Detect language (Sarvam)
 *  2. Retrieve top-k chunks (local Xenova embed → Supabase pgvector)
 *  3. Generate answer (Gemini 1.5 Flash)
 *  4. Translate response if Indian language requested (Sarvam)
 *  5. Stream back as SSE
 */

// Configure Xenova cache for serverless (read-only filesystem)
process.env.HF_HOME = "/tmp/.huggingface";

import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { retrieve, buildContext } from "@/lib/retriever";
import { detectLanguage, translateToIndian, SarvamLanguageCode } from "@/lib/sarvam";

export const runtime = "nodejs";  // Node.js runtime required for Xenova embeddings

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const llm = genai.getGenerativeModel({
  model: "gemini-1.5-flash",     // cost-efficient; upgrade to Pro for complex queries
  generationConfig: {
    temperature: 0.3,             // lower = more faithful to source
    maxOutputTokens: 1024,
  },
});

// ── System prompt ──────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a learned Jyotish (Vedic astrology) scholar specializing in 
Brihat Parasara Hora Sastra (BPHS), the foundational text of Parashari astrology.

Guidelines:
- Answer ONLY from the provided context passages. If the context does not contain the answer, 
  say so clearly — do not hallucinate.
- Always cite the chapter and śloka number when available (e.g., "Chapter 7, Śloka 12").
- Use Sanskrit terms with brief English explanations (e.g., "Lagna (Ascendant)").
- Be respectful of the sacred nature of this knowledge.
- If the user asks about planetary positions for their personal chart, clarify you can only 
  explain concepts from BPHS, not compute live charts.
- Keep responses focused and structured.`;

// ── Route handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { message, language } = await req.json();

  if (!message?.trim()) {
    return new Response(JSON.stringify({ error: "Empty message" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 1. Detect language if not provided
  const targetLang: SarvamLanguageCode | null =
    language ?? (await detectLanguage(message));

  // 2. Retrieve relevant BPHS passages
  const chunks = await retrieve(message, 8);
  const context = buildContext(chunks);

  // 3. Build prompt with retrieved context
  const userPrompt = `${SYSTEM_PROMPT}

CONTEXT FROM BPHS:
${context}

USER QUESTION: ${message}

Answer based only on the context above. Cite chapter/śloka when available.`;

  // 4. Stream response from Gemini
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let fullAnswer = "";

      try {
        const result = await llm.generateContentStream(userPrompt);

        // Stream English tokens
        for await (const chunk of result.stream) {
          const token = chunk.text();
          fullAnswer += token;
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ token, type: "token" })}\n\n`)
          );
        }

        // 5. Translate if Indian language detected
        if (targetLang) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "translating" })}\n\n`)
          );
          const translated = await translateToIndian(fullAnswer, targetLang);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "translation", text: translated, lang: targetLang })}\n\n`
            )
          );
        }

        // Send source citations
        const sources = chunks.slice(0, 5).map((c) => ({
          chapter: c.metadata.chapter,
          sloka: c.metadata.sloka,
          preview: c.metadata.preview,
          similarity: Math.round(c.similarity * 100),
        }));
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "sources", sources })}\n\n`)
        );

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (e) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: String(e) })}\n\n`
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
