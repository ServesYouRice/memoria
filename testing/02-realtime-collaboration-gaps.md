# 02 — Real-Time Collaboration & WebSocket Testing Gaps

## Domain Overview & Architecture

Memoria uses a custom Node/WebSocket server implemented in `server.ts` and `src/lib/collaboration/websocket-server.ts`. It hosts WebSocket connections on `/api/collaboration/:canvasId` for ephemeral collaboration signals (presence, live cursors, reactions, cursor chat), while durable canvas item state remains strictly governed by validated HTTP API calls to PostgreSQL.

```
Browser Client A                           Browser Client B
     |                                             ^
     | WebSocket: cursor/presence/chat             | WebSocket Broadcast
     v                                             |
+------------------------------------------------------+
|             Custom Node Server (server.ts)           |
|  - Auth Session Upgrade Verification                 |
|  - Canvas Permission Check (VIEW/COMMENT/EDIT)       |
|  - Room-based Client Registry                        |
|  - Redis Pub/Sub Fanout (Multi-instance sync)        |
+------------------------------------------------------+
```

---

## Detailed Testing Gaps & Audit Findings

### GAP-WS-01: Cursor Stream Halts Under Rapid Movement (`LOG-02`)
- **Severity**: **High**
- **Affected Files**: `src/lib/collaboration/websocket-server.ts`, `src/features/canvas/hooks/use-canvas-collaboration-ui.ts`
- **Defect Description**: When a user moves their mouse continuously, high-frequency cursor updates trigger server-side message rate limiters or client buffer overflow. The server abruptly closes the message stream or the client disconnects without automatic recovery.
- **Current Test Gap**: `tests/unit/collaboration-admission.test.ts` tests initial handshake admission, but contains zero tests simulating high-frequency cursor traffic (e.g. 60 messages/sec over 10 seconds).
- **Invariant Requirement**: Cursor streams must throttle cleanly without dropping connection or terminating presence state. Client reconnect logic must transparently recover cursor broadcast upon temporary drop.

### GAP-WS-02: Cross-Room Event Leakage & Share Revocation
- **Severity**: **High**
- **Affected Files**: `src/lib/collaboration/websocket-server.ts`, `src/lib/sharing/`
- **Defect Description**: If a collaborator's access to a canvas is revoked via `DELETE /api/v1/share-invitations/:id` while their WebSocket is actively open, the server fails to proactively terminate the WebSocket connection or evict the client from the room.
- **Current Test Gap**: No integration test covers the interaction between sharing revocation in the HTTP API and live WebSocket connection termination.
- **Invariant Requirement**: When a user's share permission is revoked or downgraded to invalid in the database, an outbox or Redis eviction signal must close their active WebSocket connection with code 4403 (Forbidden).

### GAP-WS-03: Multi-Instance Redis Pub/Sub Message Duplication / Dropping
- **Severity**: **Medium**
- **Affected Files**: `src/lib/collaboration/websocket-server.ts`, `src/lib/collaboration/committed-events.ts`
- **Defect Description**: In multi-node deployments with Redis fanout, if Redis reconnects after a transient network blip, subscription handlers may attach duplicate listeners or drop in-flight cursor/presence events.
- **Current Test Gap**: `committed-events.test.ts` tests event formatting in memory, but never simulates multi-node fanout with mock Redis pub/sub instances.
- **Invariant Requirement**: Redis pub/sub reconnect handlers must be idempotent, re-subscribing without duplicate event delivery to connected clients.

### GAP-WS-04: Ephemeral Signal Mutation Leakage (State Authority Invariant)
- **Severity**: **Critical**
- **Affected Files**: `server.ts`, `src/lib/collaboration/websocket-server.ts`
- **Defect Description**: Need automated assertions guaranteeing that no WebSocket frame can ever mutate PostgreSQL tables (`CanvasItem`, `Canvas`, `User`) directly without going through the HTTP Zod validation pipeline.
- **Current Test Gap**: No adversarial test exists that sends malicious payloads (e.g. `{ type: "ITEM_CREATE", item: { ... } }`) over the WebSocket to assert strict server rejection.
- **Invariant Requirement**: Any non-ephemeral message type received by the WebSocket server must be discarded and logged as a protocol violation.

---

## Actionable Test Implementation Matrix

| Test ID | Scope | Target File | Test Strategy | Target Model |
| --- | --- | --- | --- | --- |
| `TEST-WS-01` | Integration / Stress | `tests/integration/websocket-cursor-storm.test.ts` | Send 60 msg/sec for 10s across 10 clients; assert zero disconnects | Opus (Advisor) + Sonnet (Exec) |
| `TEST-WS-02` | Integration | `tests/integration/websocket-share-eviction.test.ts` | Revoke share via API and assert WebSocket closes within 500ms | Sonnet |
| `TEST-WS-03` | Integration | `tests/integration/websocket-redis-fanout.test.ts` | Spin up 2 mock WS servers sharing Redis pub/sub; test bidirectional relay | Sonnet |
| `TEST-WS-04` | Adversarial | `tests/unit/websocket-protocol-guard.test.ts` | Send forged mutation frames over WS and verify Prisma is never called | Sonnet |

---

## Advisor-Executor Prompt Specification

```xml
<test_specification domain="realtime_collaboration">
  <context>
    Memoria runs a stateful WebSocket server in src/lib/collaboration/websocket-server.ts.
    Ephemeral signals are presence, cursor, chat, and reactions. Durable state is HTTP only.
  </context>
  <task>
    Implement an integration test harness for high-frequency cursor storms and permission-revocation evictions.
  </task>
  <invariants>
    1. Sustained cursor messages (60/s) must not crash the connection or trigger unhandled promise rejections.
    2. Revoking share permission in DB must trigger an immediate socket eviction across all connected cluster nodes.
    3. Ephemeral WebSocket messages must never trigger write queries on Prisma models.
  </invariants>
  <verification>
    pnpm test tests/integration/websocket-cursor-storm.test.ts tests/unit/websocket-protocol-guard.test.ts
  </verification>
</test_specification>
```
