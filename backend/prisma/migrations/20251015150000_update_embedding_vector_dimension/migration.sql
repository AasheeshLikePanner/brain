-- AlterTable
ALTER TABLE "embeddings" ALTER COLUMN "embedding" SET DATA TYPE vector(768);

-- Create GIN index for full-text search on memory content
CREATE INDEX idx_memories_search ON "memories" USING GIN (to_tsvector('english', content));

-- Create B-tree index on userId and type for efficient filtering
CREATE INDEX idx_memories_type ON "memories" ("userId", "type");

-- Create B-tree index on userId and importance for efficient filtering and ordering
-- Note: metadata->>'importance' extracts as text, casting to float for numeric index
CREATE INDEX idx_memories_importance ON "memories" ("userId", (CAST(metadata->>'importance' AS FLOAT)));

-- Create HNSW index for pgvector similarity search on embeddings
-- This assumes the pgvector extension is already enabled and 'vector' type is available
-- Adjust M and ef_construction parameters based on your dataset size and performance needs
CREATE INDEX idx_embeddings_vector ON "embeddings" USING HNSW (embedding vector_l2_ops) WITH (M = 16, ef_construction = 64);