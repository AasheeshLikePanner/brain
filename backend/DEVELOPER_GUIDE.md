# Developer Guide: Second Brain Backend

This document provides a deep, code-level explanation of the Second Brain backend. It details the purpose, logic, and interactions of every major component, as requested.

---

## Part 1: Core Application & Entrypoints

### `src/app.ts`

*   **What it is:** The main entry point for the web server. It sets up an Express.js application, configures middleware, registers API routes, and schedules all background jobs.
*   **How it works:**
    1.  **Initialization:** It initializes an `express` app and sets the port from environment variables.
    2.  **Middleware:** It uses `express.json()` to parse JSON request bodies and `cors()` to enable Cross-Origin Resource Sharing.
    3.  **API Routes:** It imports route handlers from `src/api/routes` and registers them under specific base paths (e.g., `/api/chat`, `/api/memories`).
    4.  **Job Scheduling:** It uses `node-cron` to schedule all the periodic background jobs found in `src/jobs`. Each job is scheduled with a specific cron pattern and timezone.
    5.  **Server Start:** It starts the Express server, listening for incoming HTTP requests on the configured port.
*   **Why it exists:** To provide the primary HTTP interface for the application and to act as the central scheduler for all automated, recurring tasks.

### `src/worker.ts`

*   **What it is:** The entry point for the dedicated background worker process.
*   **How it works:**
    1.  It imports the `memoryWorker` instance from `src/queues/memory.queue.ts`.
    2.  The act of importing this instance starts the worker, which begins listening for jobs on the `memory-extraction` queue in Redis.
    3.  It includes signal handlers (`SIGINT`, `SIGTERM`) to gracefully shut down the worker connection when the process is terminated.
*   **Why it exists:** To run computationally expensive, long-running tasks (like LLM-based memory extraction) in a separate process. This prevents the main web server from becoming unresponsive while processing these tasks.

---

## Part 2: Database & Data Model

### `prisma/schema.prisma`

*   **What it is:** The definitive schema for the entire database. Prisma uses this file to generate the Prisma Client (the ORM) and to create and manage database migrations.
*   **How it works:** It defines models, fields, and relations using Prisma's schema language.
    *   `generator client`: Specifies that the Prisma Client for JavaScript should be generated.
    *   `datasource db`: Configures the database connection (PostgreSQL) and enables the `vector` extension.
    *   **Models (`User`, `Chat`, `Memory`, etc.):** Each model maps to a database table. Fields map to columns. Relations (e.g., `@relation`) define foreign key constraints and enable relational queries through the ORM.
    *   **`Unsupported("vector(768)")`**: This is how Prisma represents the `vector` data type from the `pg_vector` extension. It tells Prisma how to handle the embedding vectors, which have a dimension of 768.
*   **Why it exists:** To provide a single source of truth for the database structure, ensuring type safety and consistency between the application code and the database.

### `src/db/index.ts`

*   **What it is:** A singleton module that initializes and exports the Prisma Client instance.
*   **How it works:**
    1.  It creates a `new PrismaClient()`.
    2.  It enables query logging, which is useful for debugging by printing every database query, its parameters, and duration to the console.
    3.  It includes a `connectPrisma` function to handle the initial connection with a timeout and graceful error handling.
    4.  It exports the single `prisma` instance for use throughout the application.
*   **Why it exists:** To ensure that only one instance of `PrismaClient` is used across the application, which is a best practice for managing database connections efficiently.

---

## Part 3: API Layer (Routes & Controllers)

This layer is responsible for handling incoming HTTP requests and routing them to the appropriate business logic.

### `src/api/routes/*.routes.ts`

*   **What they are:** These files define the API endpoints for different resources (`chat`, `memories`, `graph`).
*   **How they work:** Each file creates an `express.Router` instance. It then defines HTTP method handlers (e.g., `router.post`, `router.get`) for specific URL paths and maps them to controller functions.
*   **Why they exist:** To cleanly separate the API route definitions from the core application logic, organizing the API by resource.

### `src/controllers/*.controller.ts`

*   **What they are:** Controllers act as the bridge between the API routes and the service layer.
*   **How they work:** Each controller function receives the `Request` and `Response` objects from Express. It extracts data from the request (body, params, query), calls the appropriate service method with that data, and then formats the service's response into an HTTP response (e.g., sending a JSON object with a status code).
*   **Why they exist:** To enforce separation of concerns. They handle the HTTP-specific aspects of a request, allowing the service layer to remain pure business logic, independent of the web framework.

---

## Part 4: Service Layer (Core Logic)

This is the heart of the application, containing all the business logic and complex algorithms.

### `src/services/llm.service.ts`

*   **What it is:** A dedicated service for all interactions with the Ollama Large Language Model API.
*   **How it works:**
    *   `createEmbedding`: Takes text, sends it to the `/api/embeddings` endpoint of Ollama using the `nomic-embed-text` model, and returns the resulting 768-dimension vector.
    *   `generateCompletion`: Sends a prompt to the `/api/generate` endpoint using the `qwen2.5:1.5b` model with `stream: false` to get a complete response at once.
    *   `generateCompletionStream`: Sends a prompt to the same endpoint but with `stream: true` to receive the response as a `ReadableStream`, allowing for real-time streaming to the client.
*   **Why it exists:** To centralize all LLM interactions, making it easy to manage, update, or swap out the LLM provider or models in the future.

### `src/services/memory-index.service.ts`

*   **What it is:** The engine for "smart search." It implements a sophisticated hybrid search and ranking algorithm.
*   **How it works:** The main method is `searchMemories`.
    1.  **Vector Search:** It first calls `vectorSearch`, which takes the user's query embedding and performs a vector similarity search (`<=>` operator from `pg_vector`) against all memories in the database.
    2.  **Full-Text Search (FTS):** It also calls `fullTextSearch`, which uses PostgreSQL's built-in FTS capabilities (`to_tsvector`, `websearch_to_tsquery`) to find memories that match keywords in the query.
    3.  **Scoring & Reranking:** This is the most critical part. The initial vector search results are not simply returned. Instead, each result is passed through `calculateMemoryScore`. This function computes a composite score based on a weighted average of multiple factors:
        *   **Vector Similarity (35% weight):** The raw cosine similarity score from the database.
        *   **Recency (20% weight):** An exponential decay function (`Math.exp(-0.05 * daysOld)`) that heavily favors newer memories.
        *   **Access Frequency (15% weight):** A logarithmic score based on how often the memory has been accessed, also decayed by how recently it was last accessed.
        *   **Importance (15% weight):** A score manually or automatically assigned to the memory, stored in its metadata.
        *   **Confidence (10% weight):** The memory's current `confidenceScore`, which is reduced over time by the `confidence-decay.job`.
        *   **Contextual Boost (5% weight):** A bonus if the memory contains entities that were also mentioned in the recent chat context.
    4.  **Combining Results:** The scores from the vector search and FTS are combined. If a memory appears in both result sets, its score is boosted.
    5.  **Final Ranking:** The combined results are sorted by their final composite score, and the top N are returned.
    6.  **Access Tracking:** Crucially, after returning the results, it calls `trackMemoryAccess` to increment the `accessCount` and update the `lastAccessedAt` timestamp for the retrieved memories, which feeds back into future ranking.
*   **Why it exists:** To go beyond simple keyword or vector search and provide a more human-like retrieval mechanism that considers what is recent, important, and frequently used, in addition to being relevant.

### `src/services/chat.service.ts`

*   **What it is:** The primary orchestrator for handling a user's conversational turn.
*   **How it works:** The `streamChatResponse` method is the core workflow:
    1.  **Save User Message:** The user's incoming message is immediately saved to the `ChatMessage` table.
    2.  **Gather Context:** It calls `memoryIndexService.searchMemories` to get the most relevant memories related to the user's query.
    3.  **Perform Reasoning:** It passes these memories to the `reasoningService` to detect deeper implications, connections, or knowledge gaps.
    4.  **Construct Prompt:** It builds a highly detailed system prompt for the LLM. This prompt includes the chat history, the retrieved memories (formatted as context), and the explicit insights generated by the `reasoningService`.
    5.  **Generate Response:** It calls `llmService.generateCompletionStream` to get a streaming response from the LLM.
    6.  **Stream & Save:** It uses a `TransformStream` to simultaneously stream the response back to the client while also capturing the full response text.
    7.  **Queue Background Job:** Once the stream is complete, it saves the full assistant response to the `ChatMessage` table and, most importantly, adds a job to the `memoryQueue`. This job contains the user message and the assistant response, instructing the worker to extract any new, permanent memories from this turn.
*   **Why it exists:** To manage the complex, multi-step process of generating an intelligent, context-aware conversational response.

### `src/services/reasoning.service.ts`

*   **What it is:** A service dedicated to higher-order cognitive tasks that go beyond simple retrieval.
*   **How it works:**
    *   `detectImplications`: Uses an LLM to analyze a set of memories and a user query to find logical connections or suggest actions (e.g., if memories mention two related but unconnected topics, it suggests a link).
    *   `identifyKnowledgeGaps`: This is a non-LLM, heuristic-based method. It counts the mentions of all entities across all memories. If an entity is mentioned frequently (e.g., >= 3 times) but is never the subject of a definitional memory (e.g., a memory containing "X is..."), it flags it as a knowledge gap.
    *   `buildTimeline`: Retrieves all memories related to a specific entity, sorts them by date (`recordedAt`), and uses an LLM to weave them into a coherent narrative summary.
    *   `graphReasoning`: If a query seems to ask about relationships ("Who knows about X?"), it uses the `graphService` to find paths in the knowledge graph and then uses an LLM to synthesize those paths into a human-readable answer.
*   **Why it exists:** To add a layer of proactive intelligence and deeper understanding, allowing the system to function more like a reasoning partner than a simple database.

### `src/services/proactive.service.ts`

*   **What it is:** The engine that generates unsolicited, helpful insights for the user.
*   **How it works:** The main `generateProactiveAlerts` method calls several sub-methods:
    *   `checkReminders`: Queries the `Memory` table for items where `recordedAt` is in the near future.
    *   `checkConnectionOpportunities`: Looks for people mentioned in recent chats, then searches for old, unresolved memories containing that person's name and action-oriented keywords (e.g., "follow up with").
    *   `checkPatterns`: Scans recent memories for recurring keywords related to moods or states (e.g., "stressed," "productive"). If a pattern is found, it searches for older memories that might contain a solution.
    *   `checkKnowledgeGaps`: Calls `reasoningService.identifyKnowledgeGaps` to find undefined but frequently mentioned topics.
*   **Why it exists:** To make the Second Brain feel alive and intelligent, actively helping the user connect ideas and stay on top of things without being asked.

---

## Part 5: Background Jobs & Queues

### `src/queues/memory.queue.ts` & `redis.ts`

*   **What they are:** These files set up the BullMQ message queue on top of a Redis connection.
*   **How they work:** `redis.ts` creates the Redis client. `memory.queue.ts` defines the `memoryQueue` and the `memoryWorker`. The worker contains the logic that is executed when a job is processed. In this case, it calls `memoryExtractorService.extractAndStore`.
*   **Why they exist:** To provide a robust system for deferring and processing long-running tasks asynchronously.

### `src/jobs/*.job.ts`

*   **What they are:** These are the implementations of the scheduled, recurring tasks.
*   **`triplet_extraction.job.ts`**: This is one of the most important jobs for knowledge building.
    1.  It finds all `Memory` and `ChatMessage` records that have not yet been processed (`isTripletExtracted = false`).
    2.  For each piece of content, it sends a prompt to the LLM asking it to extract knowledge triplets in a specific JSON format.
    3.  It parses the JSON response.
    4.  For each triplet (e.g., `{ subject: "Sarah", predicate: "is lead of", object: "AI Team" }`), it performs an `upsert` operation for the subject and object entities in the `Entity` table.
    5.  It then creates a new record in the `EntityLink` table to represent the relationship, linking the subject and object entities and storing the predicate in the `role` field.
    6.  Finally, it marks the source content as `isTripletExtracted = true` to prevent reprocessing.
*   **`confidence-decay.job.ts`**: This job implements the "forgetting" mechanism.
    1.  It fetches all memories for a user.
    2.  For each memory, it calculates the number of days since it was last accessed (`lastAccessedAt`).
    3.  It applies an exponential decay formula (`newConfidence = oldConfidence * Math.exp(-0.01 * daysSinceAccess)`) to reduce the `confidenceScore`.
    4.  Important memories have their decay slowed or floored.
    5.  If a memory's confidence falls below a certain threshold (e.g., 0.15), it is automatically archived by setting its `deleted` flag to `true`.
*   **`summarization.job.ts`**: Finds all new memories from the last 24 hours, combines their content, and uses an LLM to generate a coherent daily summary.
*   **`archiving.job.ts`**: A simpler job that soft-deletes any memories that are very old (e.g., > 6 months) and have a low importance score.
