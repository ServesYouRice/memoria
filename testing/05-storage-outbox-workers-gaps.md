# 05 — Storage, Transactional Outbox & Background Worker Testing Gaps

## Domain Overview & Architecture

Memoria handles media and asynchronous tasks through:
1. **S3-Compatible Storage**: Uploads for images, canvas attachments, and user avatars (backed by AWS S3 or MinIO in self-host).
2. **Transactional Outbox Worker**: `scripts/outbox-worker.ts` and `src/lib/outbox/` poll `OutboxJob` rows in PostgreSQL, using advisory locks and leasing for durable execution of email verification, thumbnail generation, bookmark unfurling, and webhook deliveries.
3. **Retention & Maintenance Workers**: Automated pruning of soft-deleted items, expired sessions, and audit logs.

```
HTTP Mutation (e.g. Create Bookmark)
   v
PostgreSQL Transaction:
   ├── Insert CanvasItem
   └── Insert OutboxJob (type: "bookmark.unfurl", status: "PENDING")
   v
Outbox Worker Process (scripts/outbox-worker.ts)
   ├── Claim Job (Advisory Lock + Lease Timeout)
   ├── Execute Handler (Fetch Metadata / Generate Thumbnail)
   └── Complete Job (status: "COMPLETED" or retry with backoff)
```

---

## Detailed Testing Gaps & Audit Findings

### GAP-WORKER-01: Outbox Lease Expiration & Concurrency Handover Mid-Batch
- **Severity**: **High**
- **Affected Files**: `src/lib/outbox/`, `scripts/outbox-worker.ts`, `tests/unit/outbox.test.ts`
- **Defect Description**: If an outbox worker encounters a slow external network call (e.g. slow SMTP server or hung URL unfurl), its lease timer in PostgreSQL may expire. A second worker instance can claim the same job, leading to duplicate email sends or dual thumbnail writes.
- **Current Test Gap**: `tests/unit/outbox.test.ts` only tests simple synchronous job execution. There is no test simulating worker crash, lease expiry, or dual-worker contention.
- **Invariant Requirement**: Handlers must be idempotent, outbox updates must use optimistic locking on `leaseVersion`, and long-running handlers must support lease heartbeat renewal.

### GAP-WORKER-02: Poison Pill Jobs & Dead Letter Queue (DLQ) Starvation
- **Severity**: **High**
- **Affected Files**: `src/lib/outbox/job-processor.ts`, `scripts/outbox-worker.ts`
- **Defect Description**: When an outbox job consistently crashes (e.g. malformed JSON payload or unhandled runtime exception), it can enter an infinite retry loop or block subsequent jobs from being processed in FIFO queues.
- **Current Test Gap**: No test verifies maximum retry count exhaustion (e.g. 5 retries), exponential backoff progression, or transition to `DEAD_LETTER` / `FAILED` status with structured error logs.
- **Invariant Requirement**: After reaching `maxRetries`, the job must transition to `FAILED` without crashing the worker process, enqueuing an alert in the system activity log.

### GAP-WORKER-03: Malicious Image Uploads & Decompression Bombs
- **Severity**: **Medium**
- **Affected Files**: `src/lib/uploads/`, `src/app/api/v1/upload/route.ts`, `src/lib/thumbnails/`
- **Defect Description**: Uploading SVGs with embedded `<script>` or XML entity expansion (Billion Laughs), or uploading highly compressed images (e.g., 100,000x100,000 pixels) can cause memory exhaustion during thumbnail generation.
- **Current Test Gap**: `tests/api/uploads.test.ts` only verifies standard MIME type strings; it never uploads hostile SVGs or oversized image dimensions.
- **Invariant Requirement**: Upload validation must parse image headers to reject dimensions exceeding maximum canvas limits (e.g., 8192x8192) and sanitize SVGs using DOMPurify before storage.

### GAP-WORKER-04: Headless Thumbnail Generation Failure Recovery
- **Severity**: **Medium**
- **Affected Files**: `src/lib/thumbnails/thumbnail-generator.ts`, `tests/unit/thumbnail-outbox-handler.test.ts`
- **Defect Description**: If thumbnail generation fails due to missing canvas fonts, corrupt item JSON, or headless canvas rendering errors, the canvas `thumbnailKey` remains indefinitely stale or empty without falling back to a default preview.
- **Current Test Gap**: Existing tests mock successful thumbnail generation. No test exercises the error branch or fallback placeholder generation.
- **Invariant Requirement**: Thumbnail generator failures must cleanly catch errors, increment retry counters, and fallback to generating a deterministic placeholder preview.

---

## Actionable Test Implementation Matrix

| Test ID | Scope | Target File | Test Strategy | Target Model |
| --- | --- | --- | --- | --- |
| `TEST-WORKER-01` | Integration / Concurrency | `tests/integration/outbox-lease-concurrency.test.ts` | Simulate slow worker (3s delay) and competing worker; assert no duplicate execution | Sonnet |
| `TEST-WORKER-02` | Unit | `tests/unit/outbox-dead-letter-retry.test.ts` | Force handler exceptions; assert exponential backoff and transition to FAILED after 5 retries | Sonnet |
| `TEST-WORKER-03` | Adversarial / Security | `tests/unit/upload-image-bomb-defense.test.ts` | Submit decompression bomb and XSS-bearing SVG; assert 400 rejection | Sonnet |
| `TEST-WORKER-04` | Unit | `tests/unit/thumbnail-error-fallback.test.ts` | Force canvas rendering failure and assert fallback placeholder generation | Sonnet |

---

## Advisor-Executor Prompt Specification

```xml
<test_specification domain="storage_outbox_workers">
  <context>
    Memoria runs an asynchronous transactional outbox worker in scripts/outbox-worker.ts and image uploads via S3.
  </context>
  <task>
    Implement unit and integration tests for outbox concurrency leases, retry exhaustion, and hostile image upload filtering.
  </task>
  <invariants>
    1. A job claimed by a worker that exceeds its lease duration must be safely recoverable by a secondary worker without duplicate external side effects.
    2. Any job failing 5 consecutive times must transition to FAILED status and not block subsequent outbox items.
    3. SVG files containing executable script tags or CDATA payloads must be rejected at the upload boundary.
  </invariants>
  <verification>
    pnpm test tests/integration/outbox-lease-concurrency.test.ts tests/unit/upload-image-bomb-defense.test.ts
  </verification>
</test_specification>
```
