# The Living Brain - Implementation Roadmap

This document tracks the phased implementation of advanced features for the Second Brain project.

---

## Phase 0: The Foundation - Memory Prioritization
*Goal: Teach the AI what's important. This is the essential first step.*

- [x] **Step 1: Add "Importance" to Memories:** Add an `importance` score to the metadata of each memory in the database.
- [x] **Step 2: Create a "Reinforce" API:** Build a new backend endpoint (`POST /api/memories/:memoryId/reinforce`) to increase the importance score.
- [x] **Step 3: Embed Memory IDs in AI Responses:** Update the AI's prompt to secretly embed the IDs of the source memories it uses in its answers (e.g., `<Source id="..." />`).
- [x] **Step 4: Build Frontend "Importance" Button:** Guide the user on adding a "⭐️ This is important" button to each AI response that calls the new API.
- [x] **Step 5: Upgrade the Retrieval Algorithm:** Modify the retrieval logic to give a boost to memories with a higher importance score.

---

## Phase 1: Memory Lifecycle & Consolidation
*Goal: Automate memory management and enable high-level summaries.*

- [x] **Step 1: Implement Automated Archiving:** Create a background job to find and archive old, unimportant memories.
- [x] **Step 2: Build a "Forget" Feature:** Create a `DELETE /api/memories/:memoryId` endpoint and guide on adding a "Forget" button to the frontend.
- [x] **Step 3: Activate the `Summary` Table:** Implement a background job to generate daily/weekly summaries of new memories.
- [x] **Step 4: Store Summaries:** Save the generated summaries into the `Summary` table.
- [x] **Step 5: Enable Summary Retrieval:** Upgrade the search algorithm to use summaries for broad date-range queries.

---

## Phase 2: The Knowledge Graph
*Goal: Go beyond search to understand the relationships between ideas, people, and events.*

- [x] **Step 1: Implement Triplet Extraction:** Create a background process that uses an LLM to extract knowledge triplets (Subject-Predicate-Object) from conversations.
- [x] **Step 2: Store Relationships:** Store these triplets in the database to form a queryable knowledge graph.
- [x] **Step 3: Build a Graph Query Engine:** Develop a new service on the backend that can answer complex questions by traversing the knowledge graph.
- [x] **Step 4: Integrate Graph Queries:** Teach the main chat service how to route certain questions to the new graph query engine.

---

## Phase 3: Proactive & Personalized AI
*Goal: Make the AI feel like a true, proactive partner.*

- [ ] **Step 1: Build the "Spaced Repetition" Engine:** Create a background service that proactively generates a "Daily Digest" of important, un-viewed memories.
- [ ] **Step 2: Implement Sentiment Analysis:** The backend will start analyzing the sentiment of your messages.
- [ ] **Step 3: Create an Evolving Personality Profile:** The AI will maintain and update a profile of your communication style and tone.
- [ ] **Step 4: Enable Adaptive Responses:** The AI will use the personality profile to tailor the tone and style of its responses.
