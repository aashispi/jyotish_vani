-- Enable pgvector extension
create extension if not exists vector;

-- Main documents table for BPHS chunks
create table if not exists jyotish_chunks (
  id          bigserial primary key,
  content     text not null,
  metadata    jsonb default '{}',
  embedding   vector(768),          -- Gemini text-embedding-004 dimension
  created_at  timestamptz default now()
);

-- Index for fast ANN search (cosine distance)
create index on jyotish_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Full-text search index for hybrid retrieval
create index on jyotish_chunks
  using gin (to_tsvector('english', content));

-- RPC function used by chat API
drop function if exists match_jyotish_chunks(vector, float, int, text[]);
drop function if exists match_jyotish_chunks(vector, float, int);

create or replace function match_jyotish_chunks(
  query_embedding vector(768),
  match_threshold float default 0.70,
  match_count     int  default 8
)
returns table (
  id       bigint,
  content  text,
  metadata jsonb,
  similarity float
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

-- Optional: conversation history for multi-turn chat
create table if not exists chat_sessions (
  id         uuid primary key default gen_random_uuid(),
  messages   jsonb default '[]',
  language   text default 'en',   -- 'en' | 'hi' | 'bn' | 'ta' etc.
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
