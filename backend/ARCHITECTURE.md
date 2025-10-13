# Second Brain Backend Architecture

## 1. Overview

This document outlines the architecture for the Second Brain backend. The system is designed to be a persistent, context-aware memory extension for a user, capable of capturing, storing, and intelligently retrieving information from daily interactions. It is built upon the principle of **Retrieval-Augmented Generation (RAG)**, ensuring that the AI can recall even minute details from the past to provide rich, contextual answers.

## 2. Core Principles

The memory system adheres to the following principles:

*   **Atomic**: Memories are stored in the smallest semantically meaningful units (phrases, numbers, dates) but are linked to the larger context from which they came.
*   **Linked**: Atomic memories are connected to parent contexts and named entities, forming a knowledge graph.
*   **Dual-Index**: The system uses a hybrid search approach, combining fast, exact-match metadata filtering with semantic vector search.
*   **Lifecycle**: Information evolves. Raw inputs are processed into embedded memories, which are then periodically consolidated into higher-level summaries.
*   **Provenance & Confidence**: Every piece of data tracks its origin, timestamp, and the confidence level of any AI-driven extraction.

## 3. Architectural Diagram & Flow

```
+-----------------+      +----------------------+      +--------------------+
|   User Client   |----->|   Backend (Node.js)  |----->|   Ollama Service   |
| (CLI, Web, etc) |      |    (Express.js)      |      | (llama3.1, nomic)  |
+-----------------+      +----------+-----------+      +--------------------+
                             |      ^       ^
                             |      |       |
                             v      |       |
+----------------------------+------+-------+-----------------------------+
|                            |      |                                     |
| +----------------+  +------+------v--+  +-----------------------------+ |
| | Redis (BullMQ) |  |   PostgreSQL   |  |   Background Worker(s)      | |
| | - Job Queue    |  | (with pgvector)|  |   - Embedding Generation    | |
| | - Caching      |  | - Memories     |  |   - Entity Extraction       | |
| +----------------+  | - Entities (KG)|  |   - Summarization           | |
|                     | - Embeddings   |  |                             | |
|                     +----------------+  +-----------------------------+ |
|                                                                         |
|                               Data Layer                                |
+-------------------------------------------------------------------------+
```

## 4. Tech Stack

| Component | Technology | Purpose |
| :--- | :--- | :--- |
| **Backend Framework** | **Express.js** | Handles API routing and middleware. |
| **Database ORM** | **Prisma** | Provides a type-safe interface to the database. |
| **Primary Database** | **PostgreSQL + pgvector** | Stores structured data (memories, entities) and vector embeddings. |
| **Background Jobs** | **BullMQ + Redis** | Manages asynchronous tasks like embedding and summarization. |
| **LLM Service** | **Ollama** | Serves the `llama3.1:8b` (reasoning) and `nomic-embed-text` (embedding) models. |
| **Containerization** | **Docker Compose** | Orchestrates all services for development and deployment. |

## 5. Data Model (Prisma Schema)

This schema, defined in `prisma/schema.prisma`, is the source of truth for our database structure. The `vector` type for `pgvector` will require a custom type definition.

```prisma
// This is your Prisma schema file,
// learn more about it in the docs: https://pris.ly/d/prisma-schema

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id         String    @id @default(uuid())
  email      String?   @unique
  createdAt  DateTime  @default(now())
  memories   Memory[]
  entities   Entity[]
  summaries  Summary[]

  @@map("users")
}

model Memory {
  id                String      @id @default(uuid())
  userId            String
  type              String?     // 'note','voice_transcript','entity','task','event','number', etc.
  content           String
  source            String?     // 'mobile','web','email','twitter','import'
  createdAt         DateTime    @default(now())
  recordedAt        DateTime?   // When the event actually happened
  parentContextId   String?     // Link to a higher-level context memory
  metadata          Json?       // { language, confidence, detected_entities }
  deleted           Boolean     @default(false)
  user              User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  embeddings        Embedding[]
  entityLinks       EntityLink[]

  @@map("memories")
}

model Embedding {
  id        String   @id @default(uuid())
  memoryId  String
  modelName String?
  // The actual vector type will be handled by pgvector.
  // Prisma doesn't have a native vector type, so we represent it as Float[]
  // and use raw queries for vector operations.
  embedding Float[]
  createdAt DateTime @default(now())
  memory    Memory   @relation(fields: [memoryId], references: [id], onDelete: Cascade)

  @@map("embeddings")
}

model Entity {
  id            String       @id @default(uuid())
  userId        String
  name          String
  type          String?      // person, org, date, location, product, number, etc.
  canonicalForm String?
  createdAt     DateTime     @default(now())
  user          User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  links         EntityLink[]

  @@map("entities")
}

model EntityLink {
  id         String    @id @default(uuid())
  entityId   String
  memoryId   String
  role       String?   // subject, object, date_of, amount, birthday_of, etc.
  confidence Float?
  entity     Entity    @relation(fields: [entityId], references: [id], onDelete: Cascade)
  memory     Memory    @relation(fields: [memoryId], references: [id], onDelete: Cascade)

  @@map("entity_links")
}

model Summary {
  id              String    @id @default(uuid())
  userId          String
  title           String?
  content         String
  sourceMemoryIds String[]
  level           Int       // 0: atomic, 1: day, 2: week
  modelName       String?
  createdAt       DateTime  @default(now())
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("summaries")
}
```

## 6. System Pipelines

### Ingestion Pipeline

1.  **Capture**: An input (text, voice transcript, etc.) is received via an API endpoint.
2.  **Normalize & Chunk**: The text is cleaned. A small, local LLM is used for context-aware chunking to create semantically complete but small memory units.
3.  **Entity Extraction**: A combination of regex (for dates, numbers) and a NER model extracts key entities.
4.  **Store**: The raw memory, chunks, and extracted entities are saved to the PostgreSQL database via Prisma (`memories`, `entities`, `entity_links`).
5.  **Enqueue Job**: The ID of the new memory is passed to a BullMQ job queue for asynchronous embedding.
6.  **Embed (Async)**: A background worker picks up the job, calls the `nomic-embed-text` model via Ollama, and stores the resulting vector in the `embeddings` table.

### Retrieval Pipeline

1.  **Query**: A user sends a query to the chat API endpoint.
2.  **Embed Query**: The user's query text is converted into a vector using the same embedding model.
3.  **Hybrid Search**:
    *   **Filter (Stage 1)**: A fast SQL query filters potential memories based on metadata (date ranges, user_id, source, entity filters).
    *   **Rank (Stage 2)**: A `pgvector` query ranks the filtered candidates by semantic similarity (cosine distance) to the user's query vector.
4.  **Context Assembly**: The top-ranked memories (and optionally their parent contexts) are retrieved.
5.  **Reasoning**: The retrieved context and the original query are passed to the `llama3.1:8b` model in a carefully constructed prompt.
6.  **Respond**: The final, reasoned answer from the LLM is sent back to the user. The conversation turn (query + response) is then fed back into the ingestion pipeline to be remembered.

## 7. Proposed Directory Structure

```
/src
├── api/
│   └── routes/
│       └── chat.routes.ts
├── config/
│   └── index.ts         // Environment variables, etc.
├── controllers/
│   └── chat.controller.ts // Express request/response handlers
├── db/
│   └── prisma/
│       └── schema.prisma  // The database schema
│   └── index.ts           // Prisma client instance
├── jobs/
│   └── queue.ts           // BullMQ queue setup
│   └── processors/
│       ├── embedding.processor.ts
│       └── summary.processor.ts
├── services/
│   ├── llm.service.ts     // Interacts with Ollama
│   └── memory.service.ts  // Core ingestion and retrieval logic
└── app.ts                 // Express app setup
```

## 8. Security & Privacy

*   **Data Isolation**: All database queries must be strictly scoped to the authenticated `user_id`.
*   **Encryption**: Utilize PostgreSQL's Transparent Data Encryption (TDE) at rest. Consider column-level encryption for highly sensitive `metadata` fields.
*   **User Control**: Implement endpoints for users to export or delete all their data, complying with GDPR.
*   **Audit Logs**: Log all memory access and modifications.

## 9. Scaling

The proposed architecture is designed to scale.
*   **Database**: Start with `pgvector`. If vector search becomes a bottleneck (at tens of millions of vectors), a dedicated vector database like **Qdrant** or **Milvus** can be introduced, with PostgreSQL remaining the source of truth for metadata.
*   **Workers**: Background workers can be scaled horizontally as the number of asynchronous jobs increases.
*   **Caching**: Redis can be used to cache frequent queries and consolidated summaries.
