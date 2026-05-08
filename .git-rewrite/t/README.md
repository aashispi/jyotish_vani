# 🪐 Jyotish GPT — BPHS RAG Scholar

> Ask questions about **Brihat Parāśara Horā Śāstra** in English or any of 8 Indian languages.  
> Answers are grounded exclusively in the source text with śloka citations.

## Architecture

```
User Query
    │
    ▼
Sarvam AI              ← detect input language
    │
    ▼
Xenova (Local)         ← embed query locally (all-mpnet-base-v2, 768-dim)
    │
    ▼
Supabase pgvector      ← ANN cosine similarity search → top-8 chunks
    │
    ▼
Gemini 1.5 Flash       ← generate answer from retrieved context (streamed)
    │
    ▼
Sarvam AI              ← translate to Hindi/Bengali/Tamil/etc. (if needed)
    │
    ▼
Next.js UI             ← show answer + sources + translation toggle
```

## Cost Estimate (per 1000 queries)

| Service         | Usage              | Cost (approx)  |
|-----------------|--------------------|--------------------|
| Xenova Embed    | Local (zero cost)  | **Free** ✨         |
| Gemini Flash    | 1000 × ~1k tokens  | ~$0.075            |
| Sarvam Translate| 1000 translations  | ~$1.00             |
| Supabase        | pgvector queries   | **Free** tier      |
| **Total**       |                    | **~$1.10 / 1k Qs** |

## Setup

### 1. Clone & install

```bash
git clone https://github.com/your-org/jyotish-rag
cd jyotish-rag
npm install
cp .env.example .env.local
# fill in your keys
```

### 2. Supabase — create database + vector table

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and paste the contents of `supabase/schema.sql`
3. Run it — this creates the `jyotish_chunks` table, ivfflat index, and `match_jyotish_chunks()` RPC

### 3. Ingest the BPHS PDF

```bash
# Place your PDF copy in the project root
cp ~/Downloads/BPHS.pdf ./bphs.pdf

# Run ingestion (~10–20 min for 600+ pages)
npm run ingest -- --pdf ./bphs.pdf
```

The script will:
- Parse all pages with LlamaIndex's PDFReader
- Chunk into ~512-token overlapping windows
- Embed each chunk with Gemini `text-embedding-004`
- Upsert all vectors into Supabase in batches of 20

### 4. Run locally

```bash
npm run dev
# → http://localhost:3000
```

### 5. Deploy to Vercel

1. **Push to GitHub** (Vercel requires a Git repo)
   ```bash
   git add .
   git commit -m "Add Jyotish RAG"
   git push origin main
   ```

2. **Create a Vercel project:**
   - Go to [vercel.com/new](https://vercel.com/new)
   - Import your GitHub repo
   - Select Next.js framework (auto-detected)

3. **Set environment variables in Vercel:**
   - Go to **Settings → Environment Variables**
   - Add:
     ```
     SUPABASE_URL=https://your-project.supabase.co
     SUPABASE_SERVICE_KEY=your-service-role-key
     GEMINI_API_KEY=your-gemini-key
     SARVAM_API_KEY=your-sarvam-key (if using translations)
     ```

4. **Deploy:**
   - Click **Deploy** — Vercel will build and deploy automatically
   - Your app will be live at `your-project.vercel.app`

**Note:** The API route uses Node.js runtime (not Edge) because Xenova embedding models are large (~430MB). Vercel supports this on Pro plans or higher. If you're on Hobby plan, you may hit timeouts — consider upgrading or using a smaller model.

### 6. Troubleshooting Deployment

- **Timeout on first request:** First query downloads the embedding model (~430MB). This can take 30-60s. Subsequent requests are instant.
- **Large model files:** Vercel caches models in `/tmp` during the function lifetime, so they don't re-download.
- **Cold starts:** Node.js runtime has slightly longer cold starts than Edge. Consider upgrading your Vercel plan for better performance.


### 5. Deploy to Vercel

```bash
npm i -g vercel
vercel --prod
# Add env vars in Vercel Dashboard → Settings → Environment Variables
```

## File Structure

```
jyotish-rag/
├── app/
│   ├── api/
│   │   └── chat/route.ts       ← SSE streaming RAG endpoint
│   └── page.tsx                ← app entry
├── components/
│   └── JyotishChat.tsx         ← full chat UI with language selector
├── lib/
│   ├── retriever.ts            ← Gemini embed + Supabase vector search
│   └── sarvam.ts               ← Sarvam translate + language detection
├── scripts/
│   └── ingest.ts               ← one-time PDF → pgvector pipeline
├── supabase/
│   └── schema.sql              ← table + ivfflat index + RPC function
└── .env.example
```

## Tuning Tips

- **Chunk size**: 512 tokens is a good default for BPHS's śloka density. Try 256 if answers feel too broad.
- **Top-K**: Default is 8 chunks. Increase to 12 for comparative questions ("compare Rahu in 1st vs 7th").
- **Threshold**: Default 0.68 cosine similarity. Lower to 0.55 if you get "no results found" too often.
- **Model**: Switch `gemini-1.5-flash` → `gemini-1.5-pro` for deeper, more nuanced answers at ~10× cost.
- **Hybrid search**: For better recall, add a `ts_rank` full-text search pass and merge with vector results.

## Supported Languages (Sarvam AI)

| Code    | Language  |
|---------|-----------|
| `hi-IN` | Hindi     |
| `bn-IN` | Bengali   |
| `ta-IN` | Tamil     |
| `te-IN` | Telugu    |
| `mr-IN` | Marathi   |
| `kn-IN` | Kannada   |
| `ml-IN` | Malayalam |
| `gu-IN` | Gujarati  |
| `pa-IN` | Punjabi   |
