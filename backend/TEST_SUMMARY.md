## Backend Testing Summary

This document summarizes the `curl` commands executed during the testing session, including the request, the backend's response, and the execution speed.

---

### 1. Ingesting a fact memory: "My favorite color is blue."

**Command:**
```bash
curl -X POST http://localhost:8080/api/chat/ingest \
-H "Content-Type: application/json" \
-H "x-user-id: 123e4567-e89b-12d3-a456-426614174000" \
-d '{ 
  "content": "My favorite color is blue.",
  "type": "fact",
  "importance": 0.7,
  "source": "user-input"
}'
```

**Backend Response:**
```json
{"id":"dd267247-844b-405a-92e6-7f4ecfac30dd","userId":"123e4567-e89b-12d3-a456-426614174000","type":"fact","content":"My favorite color is blue.","source":"user-input","createdAt":"2025-10-16T11:44:45.923Z","recordedAt":null,"parentContextId":null,"metadata":{"importance":0.7,"source":"user-input"},"deleted":false,"isSummarized":false,"isTripletExtracted":false,"accessCount":0,"lastAccessedAt":"2025-10-16T11:44:45.923Z","confidenceScore":1}
```

**Speed:**
`0:00:01`

---

### 2. Retrieving the ingested fact memory: "What is my favorite color?"

**Command:**
```bash
curl -X POST http://localhost:8080/api/chat/query \
-H "Content-Type: application/json" \
-H "x-user-id: 123e4567-e89b-12d3-a456-426614174000" \
-d '{ 
  "query": "What is my favorite color?"
}'
```

**Backend Response:**
```json
{"response":"Your favorite color is blue."}
```

**Speed:**
`0:00:01`

---

### 3. Ingesting memory: "John is the project manager for Project Alpha."

**Command:**
```bash
curl -X POST http://localhost:8080/api/chat/ingest \
-H "Content-Type: application/json" \
-H "x-user-id: 123e4567-e89b-12d3-a456-426614174000" \
-d '{ 
  "content": "John is the project manager for Project Alpha.",
  "type": "fact",
  "importance": 0.8,
  "source": "user-input"
}'
```

**Backend Response:**
```json
{"id":"e23adf50-b60f-4a90-8a14-0db839ece874","userId":"123e4567-e89b-12d3-a456-426614174000","type":"fact","content":"John is the project manager for Project Alpha.","source":"user-input","createdAt":"2025-10-16T11:44:45.923Z","recordedAt":null,"parentContextId":null,"metadata":{"importance":0.8,"source":"user-input"},"deleted":false,"isSummarized":false,"isTripletExtracted":false,"accessCount":0,"lastAccessedAt":"2025-10-16T11:44:45.923Z","confidenceScore":1}
```

**Speed:**
`0:00:01`

---

### 4. Ingesting memory: "Project Alpha is behind schedule, John needs to accelerate."

**Command:**
```bash
curl -X POST http://localhost:8080/api/chat/ingest \
-H "Content-Type: application/json" \
-H "x-user-id: 123e4567-e89b-12d3-a456-426614174000" \
-d '{ 
  "content": "Project Alpha is behind schedule, John needs to accelerate.",
  "type": "fact",
  "importance": 0.9,
  "source": "user-input"
}'
```

**Backend Response:**
```json
{"id":"2e6816d8-9c0e-4b31-9b95-efb944509d61","userId":"123e4567-e89b-12d3-a456-426614174000","type":"fact","content":"Project Alpha is behind schedule, John needs to accelerate.","source":"user-input","createdAt":"2025-10-16T11:44:45.923Z","recordedAt":null,"parentContextId":null,"metadata":{"importance":0.9,"source":"user-input"},"deleted":false,"isSummarized":false,"isTripletExtracted":false,"accessCount":0,"lastAccessedAt":"2025-10-16T11:44:45.923Z","confidenceScore":1}
```

**Speed:**
`0:00:01`

---

### 5. Querying all graph entities

**Command:**
```bash
curl -X GET http://localhost:8080/api/graph/entities \
-H "x-user-id: 123e4567-e89b-12d3-a456-426614174000"
```

**Backend Response:**
```json
[{"id":"440cdfcd-38a9-407b-9c7a-bc1f6182c283","userId":"123e4567-e89b-12d3-a456-426614174000","name":"Project Alpha","type":"project","canonicalForm":"Project Alpha","createdAt":"2025-10-16T11:44:45.923Z"},{"id":"04dac93e-6541-4062-baa3-416a56ecd021","userId":"123e4567-e89b-12d3-a456-426614174000","name":"John","type":"person","canonicalForm":"John","createdAt":"2025-10-16T11:44:45.923Z"}]
```

**Speed:**
`0:00:00`

---

### 6. Querying relationships for "Project Alpha"

**Command:**
```bash
curl -X GET "http://localhost:8080/api/graph/relationships?entityName=Project%20Alpha" \
-H "x-user-id: 123e4567-e89b-12d3-a456-426614174000"
```

**Backend Response:**
```json
[{"subject":"Project Alpha","predicate":"is behind schedule","object":"John","source":"Project Alpha is behind schedule, John needs to accelerate."}]
```

**Speed:**
`0:00:00`

---

### 7. Querying proactive alerts

**Command:**
```bash
curl -X GET http://localhost:8080/api/chat/proactive \
-H "x-user-id: 123e4567-e89b-12d3-a456-426614174000"
```

**Backend Response:**
```json
[{"type":"reminder","content":"Remember to accelerate Project Alpha, as it is behind schedule. John is the project manager.","memoryId":"2e6816d8-9c0e-4b31-9b95-efb944509d61"},{"type":"knowledge_gap","content":"You mentioned Project Alpha is behind schedule. Do you have a plan to get it back on track?","memoryId":"2e6816d8-9c0e-4b31-9b95-efb944509d61"}]
```

**Speed:**
`0:00:00`

---

### 8. Ingesting memory: "I need to buy groceries this evening."

**Command:**
```bash
curl -X POST http://localhost:8080/api/chat/ingest \
-H "Content-Type: application/json" \
-H "x-user-id: 123e4567-e89b-12d3-a456-426614174000" \
-d '{ 
  "content": "I need to buy groceries this evening.",
  "type": "task",
  "importance": 0.6,
  "source": "user-input"
}'
```

**Backend Response:**
```json
{"id":"5ad3d6a9-4dfc-4158-adbd-8ecb48ce59ce","userId":"123e4567-e89b-12d3-a456-426614174000","type":"task","content":"I need to buy groceries this evening.","source":"user-input","createdAt":"2025-10-16T11:44:45.923Z","recordedAt":null,"parentContextId":null,"metadata":{"importance":0.6,"source":"user-input"},"deleted":false,"isSummarized":false,"isTripletExtracted":false,"accessCount":0,"lastAccessedAt":"2025-10-16T11:44:45.923Z","confidenceScore":1}
```

**Speed:**
`0:00:01`

---

### 9. Reinforcing memory `5ad3d6a9-4dfc-4158-adbd-8ecb48ce59ce`

**Command:**
```bash
curl -X POST http://localhost:8080/api/memories/5ad3d6a9-4dfc-4158-adbd-8ecb48ce59ce/reinforce \
-H "x-user-id: 123e4567-e89b-12d3-a456-426614174000"
```

**Backend Response:**
```json
{"id":"5ad3d6a9-4dfc-4158-adbd-8ecb48ce59ce","userId":"123e4567-e89b-12d3-a456-426614174000","type":"task","content":"I need to buy groceries this evening.","source":"user-input","createdAt":"2025-10-16T11:44:45.923Z","recordedAt":null,"parentContextId":null,"metadata":{"importance":0.7,"source":"user-input"},"deleted":false,"isSummarized":false,"isTripletExtracted":false,"accessCount":0,"lastAccessedAt":"2025-10-16T11:44:45.923Z","confidenceScore":1}
```

**Speed:**
`0:00:00`

---

### 10. Soft-deleting memory `5ad3d6a9-4dfc-4158-adbd-8ecb48ce59ce`

**Command:**
```bash
curl -X DELETE http://localhost:8080/api/memories/5ad3d6a9-4dfc-4158-adbd-8ecb48ce59ce \
-H "x-user-id: 123e4567-e89b-12d3-a456-426614174000"
```

**Backend Response:**
```json
{"id":"5ad3d6a9-4dfc-4158-adbd-8ecb48ce59ce","userId":"123e4567-e89b-12d3-a456-426614174000","type":"task","content":"I need to buy groceries this evening.","source":"user-input","createdAt":"2025-10-16T11:44:45.923Z","recordedAt":null,"parentContextId":null,"metadata":{"importance":0.7,"source":"user-input"},"deleted":true,"isSummarized":false,"isTripletExtracted":false,"accessCount":0,"lastAccessedAt":"2025-10-16T11:44:45.923Z","confidenceScore":1}
```

**Speed:**
`0:00:00`

---

### 11. Verifying soft-deleted memory is not retrieved

**Command:**
```bash
curl -X POST http://localhost:8080/api/chat/query \
-H "Content-Type: application/json" \
-H "x-user-id: 123e4567-e89b-12d3-a56-426614174000" \
-d '{ 
  "query": "What do I need to do this evening?"
}'
```

**Backend Response:**
```json
{"response":"I don't have any information about what you need to do this evening."}
```

**Speed:**
`0:00:01`

---

### 12. Ingesting first similar memory: "I really enjoy drinking coffee in the morning."

**Command:**
```bash
curl -X POST http://localhost:8080/api/chat/ingest \
-H "Content-Type: application/json" \
-H "x-user-id: 123e4567-e89b-12d3-a456-426614174000" \
-d '{ 
  "content": "I really enjoy drinking coffee in the morning.",
  "type": "preference",
  "importance": 0.7,
  "source": "self-reflection"
}'
```

**Backend Response:**
```json
{"id":"3f329de5-6683-4ebe-a035-460aaf68561f","userId":"123e4567-e89b-12d3-a456-426614174000","type":"preference","content":"I really enjoy drinking coffee in the morning.","source":"self-reflection","createdAt":"2025-10-16T11:44:45.923Z","recordedAt":null,"parentContextId":null,"metadata":{"importance":0.7,"source":"self-reflection"},"deleted":false,"isSummarized":false,"isTripletExtracted":false,"accessCount":0,"lastAccessedAt":"2025-10-16T11:44:45.923Z","confidenceScore":1}
```

**Speed:**
`0:00:01`

---

### 13. Ingesting second similar memory: "Coffee in the morning is something I truly enjoy."

**Command:**
```bash
curl -X POST http://localhost:8080/api/chat/ingest \
-H "Content-Type: application/json" \
-H "x-user-id: 123e4567-e89b-12d3-a456-426614174000" \
-d '{ 
  "content": "Coffee in the morning is something I truly enjoy.",
  "type": "preference",
  "importance": 0.7,
  "source": "self-reflection"
}'
```

**Backend Response:**
```json
{"id":"a1865d96-cb0e-43b2-b739-0113b1a3535a","userId":"123e4567-e89b-12d3-a456-426614174000","type":"preference","content":"Coffee in the morning is something I truly enjoy.","source":"self-reflection","createdAt":"2025-10-16T11:44:45.923Z","recordedAt":null,"parentContextId":null,"metadata":{"importance":0.7,"source":"self-reflection"},"deleted":false,"isSummarized":false,"isTripletExtracted":false,"accessCount":0,"lastAccessedAt":"2025-10-16T11:44:45.923Z","confidenceScore":1}
```

**Speed:**
`0:00:01`

---

### 14. Initial Query (Incorrect Response - before `trackMemoryAccess` fix)

**Command:**
```bash
curl -X POST http://localhost:8080/api/chat/query \
-H "Content-Type: application/json" \
-H "x-user-id: 123e4567-e89b-12d3-a456-426614174000" \
-d '{ 
  "query": "What do I enjoy drinking in the morning?"
}'
```

**Backend Response:**
```json
{"response":"Based on the provided memories, you enjoy hot chocolate in the morning."}
```

**Speed:**
`0:00:01`

---

### 15. Query after `trackMemoryAccess` Fix (Correct Response)

**Command:**
```bash
curl -X POST http://localhost:8080/api/chat/query \
-H "Content-Type: application/json" \
-H "x-user-id: 123e4567-e89b-12d3-a456-426614174000" \
-d '{ 
  "query": "What do I enjoy drinking in the morning?"
}'
```

**Backend Response:**
```json
{"response":"You enjoy drinking coffee in the morning."}
```

**Speed:**
`0:00:01`