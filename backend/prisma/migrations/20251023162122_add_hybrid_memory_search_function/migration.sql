
CREATE OR REPLACE FUNCTION hybrid_memory_search(
  p_user_id TEXT,
  p_query_text TEXT,
  p_query_embedding VECTOR(768), -- Adjusted to 768
  p_limit INTEGER DEFAULT 5,
  p_context_entities TEXT[] DEFAULT '{}'
)
RETURNS TABLE (
  id TEXT,
  content TEXT,
  score NUMERIC,
  vector_similarity NUMERIC,
  fts_rank NUMERIC,
  recency_score NUMERIC,
  access_score NUMERIC,
  importance NUMERIC,
  confidence NUMERIC,
  contextual_boost NUMERIC
) AS $$
DECLARE
  max_access_count INTEGER;
  recency_decay_rate NUMERIC := 0.05;
BEGIN
  -- Get max access count for normalization
  SELECT COALESCE(MAX("accessCount"), 1) INTO max_access_count
  FROM memories
  WHERE "userId" = p_user_id AND deleted = false;

  RETURN QUERY
  WITH vector_scores AS (
    SELECT 
      m.id,
      m.content,
      m."createdAt",
      m."accessCount",
      m."lastAccessedAt",
      m.metadata,
      m."confidenceScore",
      (1 - (e.embedding <=> p_query_embedding)) as vector_sim
    FROM memories m
    JOIN embeddings e ON m.id = e."memoryId"
    WHERE 
      m."userId" = p_user_id
      AND m.deleted = false
      AND m."confidenceScore" > 0.2
  ),
  fts_scores AS (
    SELECT
      m.id,
      ts_rank_cd(
        to_tsvector('english', m.content), 
        websearch_to_tsquery('english', p_query_text)
      ) as fts_rank
    FROM memories m
    WHERE
      m."userId" = p_user_id
      AND m.deleted = false
      AND to_tsvector('english', m.content) @@ websearch_to_tsquery('english', p_query_text)
  ),
  combined AS (
    SELECT 
      v.id,
      v.content,
      v."createdAt",
      v."accessCount",
      v."lastAccessedAt",
      v.metadata,
      v."confidenceScore",
      v.vector_sim,
      COALESCE(f.fts_rank, 0) as fts_rank,
      
      -- Recency score
      EXP(-recency_decay_rate * EXTRACT(EPOCH FROM (NOW() - v."createdAt")) / 86400.0) as recency,
      
      -- Access frequency score
      (LN(1 + v."accessCount") / LN(1 + max_access_count)) * 
      EXP(-recency_decay_rate * EXTRACT(EPOCH FROM (NOW() - v."lastAccessedAt")) / 86400.0) as access_freq,
      
      -- Importance from metadata
      COALESCE((v.metadata->>'importance')::NUMERIC, 0.5) as importance,
      
      -- Contextual boost (if entities match)
      CASE 
        WHEN array_length(p_context_entities, 1) > 0 THEN
          (SELECT COUNT(*) 
           FROM unnest(p_context_entities) ue
           WHERE EXISTS (
             SELECT 1 FROM jsonb_array_elements_text(v.metadata->'detected_entities') de
             WHERE de ILIKE '%' || ue || '%'
           )
          )::NUMERIC / array_length(p_context_entities, 1)
        ELSE 0
      END as contextual_boost
      
    FROM vector_scores v
    LEFT JOIN fts_scores f ON v.id = f.id
  )
  SELECT 
    c.id,
    c.content,
    -- Composite score with configurable weights
    (
      c.vector_sim * 0.35 +
      LEAST(c.fts_rank, 1.0) * 0.15 + -- Normalize FTS rank
      c.recency * 0.20 +
      c.access_freq * 0.15 +
      c.importance * 0.10 +
      c.contextual_boost * 0.05
    ) as final_score,
    c.vector_sim,
    c.fts_rank,
    c.recency,
    c.access_freq,
    c.importance,
    c."confidenceScore",
    c.contextual_boost
  FROM combined c
  WHERE (
    c.vector_sim * 0.35 +
    LEAST(c.fts_rank, 1.0) * 0.15 +
    c.recency * 0.20 +
    c.access_freq * 0.15 +
    c.importance * 0.10 +
    c.contextual_boost * 0.05
  ) > 0.3 -- Relevance threshold
  ORDER BY final_score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;