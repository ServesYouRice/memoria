Title: Real-Time Collaboration Strategy (CRDT vs OT)
Date: 2025-11-09
Status: Accepted
Owners: CodexCLI

## Context

Phase 3 of the CanvasCollect roadmap introduces multi-user real-time collaboration. The MVP (Phases 1-2) uses a debounced autosave model with optimistic concurrency control (version-based locking). This works for single-user scenarios but is insufficient for multiple users editing the same canvas simultaneously.

Key requirements for Phase 3:
- Multiple users can edit canvas items concurrently without conflicts
- Changes propagate to all connected clients in real-time
- System must handle network partitions and offline editing
- Must be compatible with existing data model (CanvasItem with version field)
- Support presence indicators (cursors, active users)
- Minimize operational complexity and latency

## Decision

**Adopt Conflict-Free Replicated Data Types (CRDTs) using Y.js** for real-time collaboration.

### Why CRDTs over Operational Transformation (OT)?

**CRDTs (Yjs) - RECOMMENDED:**
- **Conflict-Free:** Mathematical guarantees of convergence without central coordination
- **Offline-First:** Users can work offline and sync when reconnected
- **Peer-to-Peer Capable:** Can work P2P or with server coordination
- **Performance:** O(1) merge complexity for concurrent operations
- **Rich Ecosystem:** Y.js has bindings for React, persistence layers, and awareness (presence)
- **Type Support:** Native support for Maps, Arrays, Text - maps well to canvas items

**OT (Alternative Considered):**
- **Requires Central Server:** All operations must be transformed by a central authority
- **Complex Transform Functions:** Requires careful implementation for each operation type
- **Ordering Sensitivity:** Operations must be applied in strict order
- **No Offline Support:** Cannot handle network partitions gracefully
- **Use Case:** Better for strict ordering (e.g., text editors with precise cursor positions)

**Decision:** CRDTs are superior for our use case (spatial canvas with independent items).

## Implementation Strategy

### Phase 3.1: Y.js Integration

1. **Y.js Document Structure:**
```typescript
// Each canvas has a Y.Doc
const ydoc = new Y.Doc()
const yItems = ydoc.getMap('items')  // Map<itemId, YMap>

// Each canvas item becomes a YMap
const yItem = new Y.Map()
yItem.set('positionX', 100)
yItem.set('positionY', 200)
yItem.set('width', 300)
yItem.set('height', 200)
yItem.set('content', { text: 'Hello' })
yItems.set(itemId, yItem)
```

2. **Persistence Strategy:**
   - Store Y.js binary updates in PostgreSQL as `BYTEA` in a new `CanvasUpdate` table
   - Periodically compact updates into snapshots
   - Keep existing `CanvasItem` table as the "source of truth" for queries
   - Sync Y.js state → PostgreSQL on debounced intervals

3. **Transport Layer:**
   - **WebSocket Server:** Use `y-websocket` for real-time sync
   - **Provider:** `@y-sweet/client` or custom WebSocket provider
   - **Fallback:** HTTP polling for clients that can't establish WebSocket

4. **Migration Path:**
   - Phase 1-2: Continue using existing autosave + version control
   - Phase 3.1: Add Y.js layer on top, sync both systems
   - Phase 3.2: Make Y.js primary, use database as persistence layer only

### Phase 3.2: Awareness (Presence)

Use Y.js Awareness API for presence features:
```typescript
const awareness = new Awareness(ydoc)
awareness.setLocalState({
  user: { id, name, color },
  cursor: { x, y },
  selection: [itemId]
})
```

### Phase 3.3: Conflict Resolution with Existing Version System

**During Transition:**
- Y.js handles real-time updates between connected clients
- When syncing Y.js → Database:
  - Extract current item state from YMap
  - Update database with `WHERE version = lastKnownVersion`
  - If version mismatch, Y.js state is canonical (overwrite)

**Post-Migration:**
- Database `version` field becomes a "sync generation" counter
- Y.js `Y.Doc` state is the source of truth
- Database is a persistence/query layer

## Alternatives Considered

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **Y.js (CRDT)** | Offline-first, conflict-free, proven, active ecosystem | Learning curve, binary format | ✅ SELECTED |
| **Automerge (CRDT)** | Pure JS, great TypeScript support | Less mature, smaller ecosystem | ❌ Rejected |
| **OT (ShareDB)** | Well-understood, text-focused | Requires central server, no offline | ❌ Rejected |
| **Firebase Realtime Database** | Hosted solution, easy setup | Vendor lock-in, cost, less control | ❌ Rejected |
| **WebSocket + Manual Merging** | Full control | High complexity, reinventing wheel | ❌ Rejected |

## Consequences

**Positive:**
- Users can collaborate in real-time without conflicts
- Offline editing "just works" - changes sync when reconnected
- Scalable architecture (can add Y.js sync servers)
- Mathematical guarantees of consistency

**Negative:**
- Increased complexity: need to understand CRDT semantics
- Binary format (Y.js updates) requires new storage strategy
- Need to maintain both Y.js state and database during transition
- Debugging concurrent state is harder than sequential operations

**Neutral:**
- Adds WebSocket infrastructure requirement
- Need monitoring for sync lag and connection health

## Implementation Checklist

Phase 3.1 (Foundation):
- [ ] Install Y.js and y-websocket dependencies
- [ ] Create `CanvasUpdate` table for Y.js binary persistence
- [ ] Implement Y.js document initialization from database state
- [ ] Build WebSocket server for Y.js sync (Next.js API route or separate server)
- [ ] Add Y.js provider to canvas page

Phase 3.2 (Real-Time Sync):
- [ ] Implement bidirectional sync: Y.js ↔ PostgreSQL
- [ ] Add conflict resolution logic (Y.js canonical during real-time)
- [ ] Implement presence/awareness (cursors, active users)
- [ ] Add connection state UI (online/offline/syncing)

Phase 3.3 (Production Hardening):
- [ ] Implement snapshot/compaction strategy for Y.js updates
- [ ] Add monitoring for sync lag and WebSocket health
- [ ] Load testing with N concurrent users per canvas
- [ ] Document rollback procedure if Y.js issues arise

## Performance Targets

- **Sync Latency:** < 100ms for local item updates to propagate to other clients
- **Concurrent Users:** Support 10+ simultaneous users per canvas
- **Offline Sync:** Handle 1000+ offline operations without data loss
- **Update Storage:** Compact Y.js updates when binary size exceeds 1MB

## References

- SENATE.md §3.2 (Phase 3: Collaboration)
- SENATE.md §3.5 (Real-Time Strategy placeholder)
- ADR-0009 (Autosave & Concurrency - current MVP approach)
- Y.js Documentation: https://docs.yjs.dev/
- Y.js Demos: https://github.com/yjs/yjs-demos
