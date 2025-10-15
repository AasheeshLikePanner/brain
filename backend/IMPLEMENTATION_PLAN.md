# Phased Implementation Plan for New Architecture

This plan outlines the steps to transition to the new asynchronous, queue-based, and optimized memory architecture. Each phase builds upon the previous one, ensuring stability and allowing for verification at each stage.

---

## Phase 1: Establish Asynchronous Processing Foundation

**Goal:** Set up the core queuing infrastructure and enable basic background processing for chat messages. This phase focuses on getting the core async pipeline working without fully implementing complex memory extraction or search.

*   **Dependencies:** Redis server running and accessible.
*   **Steps:**
    1.  **Install BullMQ & ioredis:**
        *   Add `bullmq` and `ioredis` to `package.json`.
        *   Run `npm install bullmq ioredis` and `npm install @types/ioredis --save-dev`.
    2.  **Create Redis Connection Module:**
        *   Create `src/queues/redis.ts` with the `Redis` client configuration.
    3.  **Setup Memory Extraction Queue (Placeholder Worker):**
        *   Create `src/queues/memory.queue.ts`.
        *   Define the `MemoryExtractionJob` interface.
        *   Initialize `memoryQueue` with `redis` connection.
        *   Implement the `Worker` for `memory-extraction`. Initially, the worker's processing function will be a simple placeholder that logs the job data and simulates a delay (e.g., `await new Promise(resolve => setTimeout(resolve, 2000))`).
        *   Include basic `worker.on('completed')` and `worker.on('failed')` listeners.
    4.  **Integrate Queue into Chat Service (Placeholder):**
        *   Modify `src/services/chat.service.ts` within the `streamChatResponse` method.
        *   After the assistant's `fullResponse` is saved, add a job to `memoryQueue` using `await memoryQueue.add('extract', { userId, chatId, userMessage: message, assistantMessage: fullResponse });`.
    5.  **Start BullMQ Worker:**
        *   In `src/app.ts`, ensure the BullMQ worker from `memory.queue.ts` is initialized and started when the application boots up.
*   **Verification:**
    *   Send chat messages and confirm that the chat response is fast (should not be blocked by the simulated delay in the worker).
    *   Check Redis (e.g., using `redis-cli` or a GUI tool) to confirm jobs are being added to the `memory-extraction` queue.
    *   Verify application logs show the BullMQ worker picking up and "processing" jobs (logging the placeholder message).

### Phase 2: Implement Fast Memory Indexing and Hybrid Search

**Goal:** Enable rapid memory retrieval using PostgreSQL Full-Text Search (FTS) and `pgvector` for context generation.

*   **Dependencies:** `pgvector` extension must be enabled in your PostgreSQL database.
*   **Steps:**
    1.  **Database Migrations for Indexes:**
        *   Create a new Prisma migration (e.g., `npx prisma migrate dev --name add_memory_indexes`).
        *   Add the necessary `CREATE INDEX` statements to the migration file for `idx_memories_search` (GIN index on `to_tsvector`), `idx_memories_type` (btree on `metadata->>'type'`), and `idx_memories_importance` (btree on `(metadata->>'importance')::float`).
        *   Ensure your `embeddings` table schema supports `vector` type and has an index for `pgvector` similarity search (e.g., `USING ivfflat`).
        *   Apply the migration.
    2.  **Implement `MemoryIndexService`:**
        *   Create `src/services/memory-index.service.ts`.
        *   Implement the `buildIndex`, `searchMemories`, and `vectorSearch` methods exactly as described in your architecture.
    3.  **Update Chat Service for Context Retrieval:**
        *   Modify `src/services/chat.service.ts`.
        *   Replace the existing memory retrieval logic with a call to `memoryIndexService.searchMemories(userId, message, 5)` to fetch relevant memories for the LLM prompt.
    4.  **Build Index on Application Startup:**
        *   In `src/app.ts`, add `await memoryIndexService.buildIndex('system');` to ensure indexes are built/verified on startup.
*   **Verification:**
    *   Ensure database migrations run successfully and indexes are created.
    *   Manually insert some test memories with embeddings into your database.
    *   Send chat messages and observe the `context` being generated in the LLM prompt. You might need to temporarily log the `prompt` variable in `chat.service.ts` to verify the retrieved memories.
    *   Test with various queries to ensure relevant memories are retrieved quickly and the hybrid search logic is working as expected.
    *   Monitor PostgreSQL query performance to confirm index usage.

### Phase 3: Optimize Memory Extraction and Storage

**Goal:** Fully implement the efficient, LLM-optimized memory extraction process, including the quick duplicate check and batch insertion.

*   **Steps:**
    1.  **Implement `MemoryExtractorService`:**
        *   Create `src/services/memory-extractor.service.ts`.
        *   Implement the `extractAndStore`, `quickDuplicateCheck`, and `parseMemories` methods exactly as described in your architecture. This will involve using `llmService.generateCompletion` for extraction and `llmService.createEmbedding` for embedding generation.
    2.  **Update Memory Queue Worker:**
        *   In `src/queues/memory.queue.ts`, replace the placeholder `extractAndStore` function within the BullMQ worker with the actual call to `memoryExtractorService.extractAndStore(userId, userMessage, assistantMessage, chatId)`.
    3.  **Define `MemoryType` Enum:**
        *   Ensure the `MemoryType` enum is defined and accessible (e.g., in `src/models/memory.ts` or a shared `types.ts` file) for use by the `MemoryExtractorService`.
*   **Verification:**
    *   Send chat messages.
    *   Verify that memories are being extracted, embedded, and stored in the database asynchronously after the chat response.
    *   Check application logs for successful memory extraction and embedding creation.
    *   Test sending similar messages to confirm the `quickDuplicateCheck` is preventing redundant memory storage.
    *   Verify that the `metadata` field of stored memories contains the correct `type`, `importance`, `source`, `chatId`, `temporal`, and `entities`.

### Phase 4: Implement Smart Deduplication and Scheduled Tasks

**Goal:** Introduce cost-effective memory deduplication and schedule background tasks for maintenance.

*   **Steps:**
    1.  **Implement `MemoryDeduplicationService`:**
        *   Create `src/services/memory-deduplication.service.ts`.
        *   Implement the `findAndMergeDuplicates` and `mergeMemoriesSimple` methods exactly as described in your architecture.
    2.  **Install `node-cron`:**
        *   Add `node-cron` to `package.json`.
        *   Run `npm install node-cron` and `npm install @types/node-cron --save-dev`.
    3.  **Schedule Deduplication Cron Job:**
        *   In `src/app.ts`, add the cron job to run `memoryDeduplicationService.findAndMergeDuplicates` daily (e.g., at 2 AM as suggested). You'll need to fetch all users and iterate through them.
    4.  **Schedule Triplet Extraction Cron Job:**
        *   In `src/app.ts`, ensure the existing `runTripletExtraction()` function is scheduled hourly using `node-cron`.
*   **Verification:**
    *   Manually trigger the `findAndMergeDuplicates` service (e.g., via a temporary API endpoint or script) to ensure it runs without errors and correctly merges/soft-deletes memories.
    *   Verify that the cron jobs are scheduled and execute at the specified times (check application logs for their execution).
    *   Monitor memory storage for reduced duplicates over time.

### Phase 5: Monitoring, Logging, and Refinement

**Goal:** Ensure the system is stable, observable, and performant in a production environment.

*   **Steps:**
    1.  **Comprehensive Logging:** Implement detailed logging across all services and queues, capturing job status, errors, LLM call details, and database operations. Use a structured logging library if not already in place.
    2.  **Monitoring & Alerting:** Set up monitoring for:
        *   **Redis:** Queue length, job failures, worker health.
        *   **PostgreSQL:** Query performance, index usage, connection pool.
        *   **LLM API:** Latency, error rates, token usage.
        *   **Application:** CPU, memory, network usage.
        *   Configure alerts for critical issues.
    3.  **Enhanced Error Handling:** Review and enhance error handling in all services to gracefully manage failures, retry transient errors, and provide informative messages.
    4.  **Performance Tuning:** Profile the application to identify any remaining bottlenecks. Optimize database queries, LLM calls, or code logic as needed.
    5.  **Documentation:** Update internal documentation for the new architecture, services, and operational procedures.
*   **Verification:**
    *   Observe system logs and monitoring dashboards for stability and performance under various load conditions.
    *   Conduct load testing to ensure the system performs well under expected traffic.
    *   Review code for robust error handling and edge case management.
