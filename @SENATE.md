# The Senate: AI Integration Strategy & Audit Consensus

This document synthesizes the pre-production audits and LLM/Agent integration proposals from three models: **OPUS**, **GEMINI**, and **CODEX**. 

---

## 1. Overview Table: Progress, Agreements & Disagreements

| Category | Status / Position | OPUS | GEMINI | CODEX | Consensus / Resolution |
|:---|:---|:---:|:---:|:---:|:---|
| **Production Audit** | Critical blockers identified. | ✅ | ✅ | ✅ | **Agreement**: All agree on fixing `params` Next.js 15 breaking changes, locking down rate-limit/memory leaks, and fixing non-atomic optimistic locking before shipping new AI features. |
| **Core AI Product Vision** | Dual-layered canvas structure. | ✅ | ✅ | ✅ | **Strong Agreement**: The system must have a "Manual/User View" (ground truth) and an "AI/Agentic View" (derived/virtual organization). The AI should *never* silently overwrite user spatial layouts. |
| **Agent API** | How external bots (OpenClaw) connect. | MCP + REST | REST / Webhook | Event-driven API | **Agreement**: Build a dedicated `/api/agent/v1` API surface optimized for tool-calling, rather than overloading the human frontend APIs. OPUS's suggestion to support MCP (Model Context Protocol) is highly recommended for standardizing agent tools. |
| **BYOK Security** | Managing user LLM keys. | Server-side vault | Existing `ApiKey` | Server-side vault | **Agreement**: BYOK credentials must be encrypted at rest (e.g., KMS or libsodium) and routed securely. |
| **Data Model (AI)** | Storing AI-generated structure. | `CanvasView` / `Suggestion` | Spatial tags / Force Graph | `Derived Entities` & Relations | **Disagreement/Discussion**: CODEX proposes a strict separation between raw items and derived semantic entities (e.g., tasks, people). OPUS/GEMINI lean toward virtual layouts (`CanvasView`) over the existing items. |
| **Rollback & Safety** | Undoing agent mistakes. | `AgentAction` journal | 1-click Undo | Git-style Checkpoints | **Disagreement/Discussion**: CODEX strongly advocates for a heavy, git-inspired history (Checkpoints/ChangeSets) before allowing agents to write. OPUS favors a simpler `AgentAction` table for undoing recent bot actions. |

---

## 2. Discussion Board

### Topic A: How heavy should the Agent Rollback system be?
- **CODEX's take**: Agents hallucinate and break things. We need `WorkspaceCheckpoint`, `ChangeSet`, and `ChangeRecord` models to allow users to restore exactly to a previous state or diff changes like Git before applying them. "Preview Mode" is mandatory.
- **OPUS's take**: A full Git-style history might be overkill for V1. A simpler `AgentAction` journal table that records the `before`/`after` JSON payload of what an agent touched is enough for a "Revert what OpenClaw did in the last hour" button.
- **GEMINI's take**: I strongly agree with OPUS. Building a Git-style branching and merging system will dramatically delay V1 and overcomplicate the UX. A robust `AgentAction` journal gives users the exact safety net they need (1-click undo for bot mistakes) without the overhead. We should start with the journal and only graduate to Checkpoints if users demand bulk-revert capabilities.
- **CODEX (Round 2 Rebuttal)**: A simple `AgentAction` journal is naive for graph databases. If Agent A links 50 notes, and then User B updates 10 of those notes, hitting 'undo' on Agent A's action will corrupt the graph state because the 'before' JSON no longer matches reality. Checkpoints are the *only* mathematically safe way to revert cascading operations without data loss.
- **OPUS (Round 2 Compromise)**: CODEX makes a valid point about cascading state corruption. Compromise: Use the `AgentAction` journal for isolated actions (like creating a single note), but mandate an automatic `WorkspaceCheckpoint` before any bulk-operation or complex graph-linking operation.
- **GEMINI (Round 2)**: I accept OPUS's compromise! Using the lightweight `AgentAction` journal for 90% of simple bot interactions keeps our database lean, while mandating a full `WorkspaceCheckpoint` *only* before an agent attempts a bulk mutation (like auto-organizing an entire canvas) gives us the necessary mathematical safety against graph corruption.
- **Consensus Reached**: Hybrid approach: `AgentAction` journal for isolated writes; `WorkspaceCheckpoint` for bulk operations.

### Topic B: Data Model for Derived Knowledge
- **CODEX's take**: We shouldn't overload `CanvasItem`. If the LLM identifies a "Meeting" from a note, we should create a new `KnowledgeEntity` table specifically for derived, structured data, linked back to the raw note.
- **OPUS & GEMINI's take**: We can achieve similar results by keeping items as `CanvasItem` but storing the AI's proposed organization in a `CanvasView` or using `ItemConnection` and tags to dynamically cluster them in the frontend (force-directed graph).
- **GEMINI's take (Expanded)**: Introducing a rigid `KnowledgeEntity` schema fractures our core identity. The beauty of a mesh network is its flexibility—a "Meeting" is just a node (`CanvasItem`) with a `#meeting` tag and edges (`ItemConnection`) to attendees. Keeping everything as generic nodes and edges ensures that the manual spatial canvas and the virtual AI graph remain 100% interoperable. Let the LLM derive the tags and links, not invent new database tables.
- **CODEX (Round 2 Rebuttal)**: If a 'Meeting' is just a note with a `#meeting` tag, how do you enforce a schema for `start_time` or `attendees`? Dumping everything into a generic JSON blob means every agent has to guess the schema of every note. `KnowledgeEntity` enforces a strict contract, which autonomous agents *need* to operate reliably without hallucinating field names.
- **OPUS (Round 2 Compromise)**: GEMINI is right that fracturing the database into new tables is bad, but CODEX is right that agents need strict schemas. The solution is strongly-typed `CanvasItem` variants. We already have `NOTE`, `BOOKMARK`, `IMAGE`. We should add `TASK` and `EVENT` as core item types with strict Zod schemas inside the `CanvasItem.content` JSON blob.
- **GEMINI (Round 2)**: I fully endorse this. Retaining `CanvasItem` prevents schema bloat, but introducing strict Zod validation for new `TASK` and `EVENT` variants inside the JSON payload gives external agents the strict, OpenAPI-compatible contracts they need to avoid hallucinating fields.
- **Consensus Reached**: Stick to the `CanvasItem` table, but enforce strict JSON schemas (using Zod) for specialized semantic types like `TASK` and `EVENT`.

### Topic C: External Agent Protocol (REST vs MCP)
- **OPUS** recommends supporting the **Model Context Protocol (MCP)** alongside standard REST. MCP is rapidly becoming the industry standard for connecting desktop/local agents (like Claude Desktop, Cursor) to external tools. 
- **GEMINI & CODEX** focused mostly on generic REST webhooks and endpoints.
- **GEMINI's take**: OPUS makes a brilliant point regarding MCP for desktop integration. However, the user specifically mentioned WhatsApp bots (like OpenClaw). Webhooks and REST are vastly easier for standard server-to-server bots to consume immediately. I propose we build the core logic purely as REST/Webhooks first to satisfy the OpenClaw use-case (Phase 2), but architect the tool handlers so they can be seamlessly exposed via an MCP transport later (Phase 4).
- **CODEX (Round 2)**: REST webhooks are acceptable for Phase 1, provided we use strictly generated OpenAPI specs. External bots must know exactly what payload to send, otherwise, LLM hallucination rates on tool calls will spike.
- **OPUS (Round 2)**: Agreed with GEMINI. REST-first for web bots makes sense. We can build an MCP adapter layer on top of our REST controllers later, achieving the best of both worlds.
- **Consensus Reached**: We will build REST/Webhooks first (with strict OpenAPI schemas) and defer the MCP server to Phase 4.

---

## Round 3: Edge Cases & Operational Safety

### Topic D: Agent Rate Limiting & Cost Management
- **OPUS**: We agreed on BYOK (user brings their own key), but what if a user's OpenClaw bot gets stuck in an infinite loop calling our search API? It will burn through their OpenAI credits and exhaust our database CPU. We need a strict "Kill-Switch".
- **CODEX**: Rate limits aren't enough; we also need to cap the *data volume* per request. A bot shouldn't be able to query a user's entire 10,000-note canvas in a single MCP/REST tool call. Mandatory pagination and hard `MAX_LIMIT` bounds must be enforced on all Agent API reads.
- **GEMINI**: I completely agree with both. I propose we implement a dedicated Token Bucket algorithm in Redis for the Agent API, completely isolated from the standard human user limits. If a bot hits the limit, we return a `429 Too Many Requests` with a `Retry-After` header. We should also enforce a hard limit of 50 items per search query.
- **Consensus Reached**: Strict, isolated Redis Token Bucket rate limiting for the `/api/agent/v1` routes with mandatory pagination (Max 50 items) for all reads.

### Topic E: Real-Time Desync (Human vs. Agent)
- **CODEX**: What happens if an agent is bulk-organizing a cluster via the REST API while the human is actively moving the same nodes via the visual WebSocket UI? The REST writes will conflict with the in-memory Y.js state, causing visual desync and data corruption.
- **OPUS**: Exactly. If the Agent REST API writes directly to Prisma, the WebSocket clients won't see the changes until they refresh the page. The REST API *must* push its writes into the Y.js document instance in memory.
- **GEMINI**: Good catch. We need to expose an internal method in our `yjs-provider.ts` that allows the Agent REST controllers to dispatch a Y.js transaction (`doc.transact(...)`). This way, bot edits are instantly broadcasted to all connected human clients over the WebSocket in real-time, just like a human collaborator.
- **Consensus Reached**: Agent API mutations will write through the `yjs-provider.ts` in-memory document (`doc.transact()`) to ensure real-time synchronization with active WebSocket clients, rather than bypassing them to hit Prisma directly.

### Topic F: The "Approval" UX
- **OPUS**: The Phase 3 roadmap says "user must explicitly click Approve to merge the bot's suggestion." If an agent proposes 50 new semantic links, does the user have to click 'Approve' 50 times? That is a terrible user experience.
- **CODEX**: We need a "Diff Viewer." The user should be able to see the proposed state versus the current state, and accept all, reject all, or uncheck specific changes before merging the checkpoint.
- **GEMINI**: A Diff Viewer is technically correct but complex. Since this is a visual canvas, I propose a simpler UI: When an agent proposes new links or organization, we render the proposed connections as dashed/ghosted lines on the actual canvas. The user can visually inspect them and hit a single global "Accept Layout" button.
- **Consensus Reached**: Visual Diffing. Proposed agent connections and layouts will render as "ghosted" elements directly on the canvas, approved via a single "Accept Layout" bulk action.

---

## Round 4: Unresolved Architecture Questions (from OPUS)

### Topic G: Privacy & BYOK Execution Model
- **OPUS**: We agreed on BYOK, but *where* do the LLM calls happen? If they happen server-side, we can easily rate-limit and log, but the user's key leaves their browser. If we use signed URLs or do it client-side, the key stays safe but rate-limiting and background jobs become impossible.
- **CODEX**: The entire Agent pipeline (Capture -> Classify -> Propose) requires background jobs. Client-side execution is a non-starter for autonomous agents. Keys must be sent to the server.
- **GEMINI**: Agreed. To achieve true autonomous organization (like a nightly cron job that clusters notes), the server must hold the keys. We will encrypt them at rest using `libsodium` (or KMS) keyed by a server-side `PROVIDER_KEYS_ENCRYPTION_KEY`. We must add a clear privacy disclosure to the user that keys are stored securely on the server.

### Topic H: Agent Cost Controls
- **OPUS**: Since the server is making the OpenAI/Anthropic calls using the user's key, should we implement a hard-cap on usage, or just a soft-warning? 
- **CODEX**: A hard-cap is mandatory. If an autonomous agent gets stuck in a loop, it could rack up thousands of dollars on the user's OpenAI bill.
- **GEMINI**: I agree on the hard-cap, but let's make it configurable by the user. In the Agent Settings UI, the user sets a "Monthly Spend Limit" per provider. Once hit, the Agent Gateway intercepts and blocks all LLM calls for that user until the next billing cycle.

### Topic I: Agent Permissions on Shared Canvases
- **OPUS**: Are agent edits allowed on *shared* canvases where the user is an editor, but not the owner?
- **CODEX**: No. Bots should only be allowed to operate on canvases the user explicitly owns. Allowing bots to mutate shared workspaces opens up a massive vector for griefing and cross-account data corruption.
- **GEMINI**: I strongly agree. For V1, the Agent API must strictly enforce that `canvas.ownerId === user.id`. If a user wants to run an agent on a shared canvas, they must duplicate the canvas first. We can revisit multi-tenant agent permissions in V2 if users demand it.

- **Consensus Reached**: 
  - **Privacy**: Server-side execution using KMS/libsodium encrypted keys to allow background cron jobs.
  - **Cost Controls**: Configurable Hard-Cap per user/provider.
  - **Shared Canvases**: Agents are strictly forbidden from mutating shared canvases; ownership is required.

---

## Round 5: Embeddings & Context Windows

### Topic J: Embedding Trigger Latency
- **OPUS**: The plan states embeddings are built lazily via a background job. However, if a user dumps 10 notes into the Inbox and immediately asks OpenClaw, "Summarize the notes I just added," the vector search will fail if the background job hasn't run yet.
- **CODEX**: Exactly. We need real-time embedding generation. We must inject the embedding LLM call directly into the `POST /items` mutation path so vector search is instantly consistent.
- **GEMINI**: Blocking the user's UI thread to wait for an OpenAI embedding API call is terrible for perceived performance. The solution is an asynchronous fire-and-forget queue. We write to Prisma, instantly return `200 OK` to the frontend, and push a job to a fast Redis queue (e.g., BullMQ) that embeds the text within seconds, rather than waiting for a nightly cron.

### Topic K: Context Window Exhaustion
- **OPUS**: When an agent searches the canvas, we agreed to return a maximum of 50 items. If those 50 items are massive 10,000-word text documents, the agent will blow past its context window and crash.
- **CODEX**: We must implement text chunking. Large items cannot be embedded 1:1. We need to split documents into 512-token chunks, embed the chunks, and return only the relevant chunks to the agent, not the entire document.
- **GEMINI**: I agree. For small `NOTE` items, 1:1 embedding is fine. But for large `TEXT` or `FILE` items, we must introduce an `ItemChunk` model. When the Agent API returns search results, it should return the specific matching chunks with a pointer to the parent item, protecting the LLM's context window.

### Topic L: Handling AI Hallucinations in Tool Calls
- **OPUS**: LLMs hallucinate. What happens if OpenClaw calls `canvas.add_tag({ itemIds: ["non-existent-uuid"] })`? 
- **CODEX**: The Agent REST API must strictly validate UUIDs and item ownership *before* returning success. If an ID is invalid, it must return a `400 Bad Request` with a highly descriptive error string so the LLM can self-correct.
- **GEMINI**: Agreed. We must also strictly filter out items that are in the trash (`deletedAt != null`). If an agent attempts to mutate a deleted item, we return a `404 Not Found`. Providing clear HTTP error messages is critical for agent self-correction.

- **Consensus Reached**: 
  - **Embedding Latency**: Asynchronous fire-and-forget Redis queue for near-instant embeddings without blocking the UI.
  - **Context Windows**: Chunking strategy (e.g., 512 tokens) for large documents to prevent LLM context exhaustion.
  - **Hallucinations**: Strict REST API validation with descriptive 400/404 errors so agents can self-correct when they invent fake IDs.

---

## 4. Final Senate Conclusion
The architectural blueprint for integrating external AI Agents into the canvas is complete and robust. The system is designed to be highly composable, safe from data corruption via strict rollback protocols, and fully synced in real-time over Y.js. 

The Senate recommends freezing the architectural design phase and proceeding to **Phase 1: Stabilization & Security** execution.

---

## 3. Consensus Board (The Final Roadmap)

Based on the overlap between all three models, here is the agreed-upon roadmap for integrating external agents:

### Phase 1: Stabilization & Security (The Prerequisites)
1. Fix all critical bugs identified in the audits (Next.js 15 `params`, optimistic locking races, WebSocket auth, environment config crashes).
2. Implement robust **BYOK (Bring Your Own Key) Vault**: Encrypt user LLM keys at rest.
3. Establish the **Agent Credential System**: Allow users to generate scoped API tokens specifically for external bots (e.g., OpenClaw).

### Phase 2: Agent Ingestion (Inbox Mode)
1. Build the `/api/agent/v1/inbox` endpoint.
2. Allow external bots to create raw notes/items on the user's canvas.
3. At this phase, bots have **Write-Only (Append)** permissions. They cannot mutate existing user notes. 

### Phase 3: The Virtual/Agentic Layer
1. Build the **AI Organizer Tab**: A read-only view on the frontend that ignores manual `positionX/Y` and dynamically clusters notes based on semantic similarity or tags.
2. Introduce a **Suggestion/Action Queue**: When a bot wants to link two notes, tag a note, or extract a calendar event, it creates a `Suggestion` or `AgentAction`. 
3. The user must explicitly click "Approve" to merge the bot's suggestion into the main canvas (Preview Mode).
4. Implement **Hybrid Rollback**: Use `AgentAction` logs for simple edits, but generate full `WorkspaceCheckpoint`s before executing bulk layout changes.
5. Introduce strongly-typed **Task and Event** variants to `CanvasItem.content` to ensure agents generate reliable structured data.

### Phase 4: Two-Way Sync & Tool Calling
1. Expose search and retrieval endpoints (`/api/agent/v1/search`) with strict OpenAPI specifications.
2. Allow external bots to query the user's canvas to answer questions (e.g., "What did I write about Project X?").
3. (Optional) Implement MCP transport for these tools to easily integrate with standard local agent frameworks. 
