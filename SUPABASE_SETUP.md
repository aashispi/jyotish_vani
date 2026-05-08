# Supabase Setup & Schema Migration

## Initial Setup (One-time)

1. **Create Supabase project** at https://supabase.com
2. **Get your credentials:**
   - SUPABASE_URL: Project URL from settings
   - SUPABASE_SERVICE_KEY: Service role key from API settings

## Apply Database Schema

**Option A: SQL Editor (Easiest)**
1. Go to your Supabase project → SQL Editor
2. Click "New Query"
3. Copy contents of `supabase/schema.sql`
4. Paste and run

**Option B: CLI**
```bash
supabase db push
```

## Fix Duplicate Function Error

If you see: `Could not choose the best candidate function between...`

**Run this SQL in Supabase SQL Editor:**
```sql
-- Drop conflicting functions
drop function if exists public.match_jyotish_chunks(vector, double precision, integer, text[]) cascade;
drop function if exists public.match_jyotish_chunks(vector, double precision, integer) cascade;

-- Recreate single version
create or replace function public.match_jyotish_chunks(
  query_embedding vector(768),
  match_threshold float8 default 0.70,
  match_count     integer default 8
)
returns table (
  id       bigint,
  content  text,
  metadata jsonb,
  similarity float8
)
language sql stable
as $$
  select
    id,
    content,
    metadata,
    1 - (embedding <=> query_embedding) as similarity
  from jyotish_chunks
  where 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;
```

## Environment Variables

Add to `.env.local`:
```
SUPABASE_URL=your_project_url
SUPABASE_SERVICE_KEY=your_service_key
SARVAM_API_KEY=your_sarvam_key
GEMINI_API_KEY=your_gemini_key
```
