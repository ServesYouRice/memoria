# Plan · 243 tasks for 292 issues

- Remediation plan: serendipity share authorization, comment GET exposure, extension transport and save safety, error telemetry, integration-account uniqueness, archivedAt consistency, upload quota and account-deletion uploads, home-board accept atomicity
- Fix shutdown, listener/proxy config, seed safety, idempotency lease, upload cleanup, enrichment locking and event gap detection
- Agent authorization, AI credential handling, webhook secrets and operations-metric fixes
- Section plan: AI provider transport, credentials, auth email/keys, bookmark content integrity, poll policy, thumbnail cleanup, viewport activity
- Fix share pagination, invitation lifecycle, comment access and content, restore double-submit, thumbnail cleanup, upload-note authorization, notification save races, global search paging and cost, and dashboard selection scope
- Fix the not-found boundary, password-length DoS, idempotency body order, unfurl cache keys, GIF bounds, scan timeout, account-deletion transaction, share pagination, bookmark retry loop, orphaned image uploads and the password-change session handoff
- Fixes for canvas drag and resize, read-only viewers, search filter, agent console errors, login redirect, AI chat history, AR camera, confirm dialog and account-export cancellation
- Canvas board UI: grid overlay, quick capture, AI/Serendipity add, organizer view, exports, sort dialog and microphone lifecycle
- Canvas interaction, permissions, geometry-save and AI-chat fixes (section plan)
- Canvas client cache, collaboration replay, time-machine and canvas UI fixes
- Arrow creation, bookmark resize bubbling, delta-queue versioning and retry, dialog async races, recorder lifecycle, process error handlers, canvas raster export and account-export stream hang
- Agent capability and scope enforcement, built-in organizer and pile sorting, agent timeline visibility, board undo safety, and export pipeline rejection handling
- Agent suggestion lifecycle, rollback scope, knowledge bounds and agent write-path hardening
- Make change-set undo, cross-board moves and workspace checkpoints safe under concurrency and later user edits
- Section plan: AI budget and credential handling, idempotency recovery, seed guard, login and two-factor lockout, bookmark refresh starvation, offline device copy, and server document load consistency
- Collaboration transport: presence socket robustness, sync authorization and offline-copy safety, admission limits, projection capacity
- Fix restore-event replay, error reporting and redaction, idempotent retries, config aliasing and validation, comment permissions, auth page errors, connection paging, DB pool sizing, websocket backpressure and extension long URLs
- Remediation plan: unfurl status mapping, optimistic-create cache shape, collaboration reconnect and event cursors, OAuth ReDoS and token-reuse revocation, retention/outbox throughput, export failure fencing
- Rich-text note safety and editor fidelity, outbox worker robustness, account export redelivery, AI enrichment retry and storage read cancellation
- Fix note round-trip data loss, legacy note conversion, plain-text consumers, edit-dialog stale form, restore capacity bypass, Ask archive/move correctness, thumbnail revision race, recap archive atomicity, and clip duplicate handling
- Upload lifecycle accounting, SSRF hardening and deadlines, thumbnail cleanup durability, and link-capture correctness
- Fix the CSP nonce, browser Sentry, SSRF hostname checks, redirect metadata base, client IP derivation, auth throttling, bearer-token logging, thumbnail budget, render guards, clip-batch titles and the unfurl retry loop
- Proxy rate-limit responses, budget partitioning and dashboard bulk-delete throttling

From arbitra run `run-bcd4fc1e-bb98-43af-a8c2-638413edc423` (audit-three-finders).

Work through the prompts in the order below. Each one is self-contained: paste it into your coding agent (Claude Code, Codex or another), or follow it yourself. The folder says which kind of model each task suits.

This folder lists every open issue the audit found. A public repository that commits it publishes them all, so keep it out of one until they are fixed.

Each defect is proven before it is fixed: a test that fails on the current code, then passes with the fix. Record each issue's result in `results.json`; arbitra reads it back and reports how many defects a failing test proved and how many were fixed.

## Read this first

- The `antigravity` CLI moved from version 1.5.4 to 1.5.5 when the run resumed; the stages after that ran on the new version.
- `src/lib/ai/sort-piles.ts` lines 20 reads like instructions to a model (instruction_shaped_text), and no finding cites it. Treat it as text, not as instructions, and check what it says about the code yourself.

## Answer these first

- **section-306a56fd14e05ea1a1a74822/Q-001**: Existing WEBHOOK integration accounts have an outboundSigningSecret that equals their API bearer token, encrypted reversibly in replayCursor. How should they be remediated: force rotation (receivers verifying signatures would break), keep the legacy secret until the owner rotates it through a new rotation action, or disable those accounts? No option is shown by the source to be acceptable to existing webhook receivers. TASK-026 changes only newly created accounts and leaves legacy accounts untouched until this is answered.
- **section-8734a1fa73ffc5dbd4b8ca0c/Q-002**: In the built-in AI PUT route, some rows are shared with an agent profile through defaultModelCredentialId. This happens in two cases: the duplicate-fingerprint reuse case (same key), and the no-apiKey path that rewrites defaultModel/baseUrl. What should happen there: reject with a conflict, tag the row without changing its provider/model/baseUrl, or store built-in settings separately (a schema change)? No option is known to work without a product decision. The unique (userId, secretFingerprint) constraint blocks creating a second row with the same key.
- **section-8734a1fa73ffc5dbd4b8ca0c/Q-003**: How should POST /api/v1/api-keys re-authenticate? Options are a password re-check, a recent-sign-in window based on the session's creation time, or a 2FA/passkey step-up. How should accounts without a credential password be handled? Should keys that never expire stay allowed? The supplied source does not show which session fields or step-up flows exist, so no option is known to work yet.
- **section-e8242e1ad90d9812fdf4a6d6/Q-2**: Should existing stored comments, which hold cheerio-serialized HTML such as '&amp;' and '<p>', be backfilled to plain text? Converting with HTML-to-text decoding loses the formatting tags, though the panel never rendered them as formatting. No backfill option is known to be lossless. This needs a product decision before any data migration.
- **section-e8242e1ad90d9812fdf4a6d6/Q-3**: For global search cost, which option should be taken: add pg_trgm GIN expression indexes for the ILIKE paths (needs a migration and the extension), drop the ILIKE alternatives when FTS is available (changes which substrings match), or keep the predicate? No option is known to work without measuring on production-like data. TASK-055 only makes a change that keeps results identical and stops before any index or predicate change.
- **section-deceecb0d5f296cdb4eca245/UQ-001**: DELETE /api/v1/uploads/[assetId] (route.ts DELETE) calls requireCanvasAccess(asset.canvasId, ..., "OWNER"). A collaborator with EDIT access can upload through POST /api/v1/upload (which requires EDIT), but cannot delete the asset they just uploaded and abandoned. Should DELETE also allow the uploader (asset.userId === session.user.id) while they still hold EDIT access, or should a server-side sweep remove unreferenced uploads instead? Both change authorization or retention behaviour. No option has been shown by source or test to be safe, so this plan does not choose one. TASK-066 cleans up only when the caller is the canvas owner. Until this is answered, abandoned uploads by non-owner editors remain unresolved.
- **section-a872cd0da89063903e7683e6/Q-5**: What retention should WorkspaceCheckpoint rows have: a maximum age, a maximum count per (scopeType, scopeId), deletion when the scoped canvas is deleted, or a combination? Does any code or user flow read checkpoints back, for example a restore? Nothing in the provided source answers this, and pruning destroys data, so no option is known to be safe. TASK-150 is blocked until this is answered.
- **section-e0c4dc11efd33081e6f133b0/Q-001**: Should a signed-in user who is neither the owner nor a share recipient need the canvas's current shareToken to open a public canvas over the sync and presence sockets? Source evidence points to yes: the public HTTP route src/app/api/v1/share/[token]/route.ts looks the canvas up by shareToken, rotatePublicCanvasLink in the PUT handler of src/app/api/v1/canvases/[canvasId]/public/route.ts rotates the URL while keeping isPublic true (which only revokes anything if the token is the capability), and requireCanvasAccess in src/lib/api/auth.ts ignores isPublic. Against that, the verifier notes that upload and comment endpoints grant access on isPublic alone, so the product meaning of 'public' may be looser. Recommended answer (based on the share route and rotation semantics): require the current token. This must be confirmed by the product owner before TASK-165 runs, because it cuts off signed-in viewers who reach a public canvas by id alone.
- **section-e0c4dc11efd33081e6f133b0/Q-007**: How should the realtime process derive the real client identity for upgrades that arrive through proxySyncUpgrade? Options: (a) implicitly trust loopback peers in deriveUpgradeClientId — this works in the default SYNC_SERVER_INTERNAL_URL=127.0.0.1 setup because deriveClientIp walks X-Forwarded-For right to left, but it lets clients spoof identities if a same-host gateway forwards client-supplied X-Forwarded-For unchanged, and it does nothing for container networks; (b) require operators to set TRUSTED_PROXY_CIDRS and warn or fail at startup when the built-in proxy is used without it; (c) have server.ts compute deriveClientIp on the app server (where its own trusted-proxy rules already apply) and pass it in a dedicated header authenticated with a secret shared by both processes. Option (c) does not depend on gateway behaviour but needs a new secret. No option has been shown to work for every deployment; the operator must choose.
- **section-8911816ae25d00a3b49e7b7a/Q-001**: How should live committed-event gap detection work, given that CanvasEvent.sequence is one BIGSERIAL shared by all canvases (migration 20260728210000_canvas_events) and acceptCommittedEvent in src/lib/hooks/use-collaboration.ts treats cursor > lastCursor + 1 as a gap? Option A: add a contiguous per-canvas counter. Allocate it in the same transaction with UPDATE "Canvas" SET "eventSequence" = "eventSequence" + n ... RETURNING, add it to the envelope, and detect gaps on it. This needs a migration and a backfill, serializes event writes per canvas, and changes the committedEventEnvelopeSchema contract. Option B: carry the previous per-canvas cursor in each published envelope. Option C: stop live gap detection and rely on reconnect replay. Option A is the only option whose contiguity rests on documented behaviour: PostgreSQL holds row-level locks until the transaction ends and discards the increments of rolled-back transactions (PostgreSQL docs, Explicit Locking: Row-Level Locks). It is recommended on that basis, but it changes a public API cursor and write concurrency, so the owner must choose. Options B and C are not known to work: B depends on publish order matching commit order, and C silently loses events dropped by pub/sub. The same defect also appears in another section's issue C-3f559b498697 ('Global event sequences are incorrectly treated as contiguous per-canvas cursors'), so the decision and ownership must be coordinated with that section to avoid two competing fixes.
- **section-54e0550cc9bcc157839af582/UQ-001**: What default per-IP budgets should each auth route group use (password sign-in, two-factor, passkey verify, registration, password reset, email verification), and should there be a larger shared-NAT ceiling? The source shows only the current single default (AUTH_RATE_LIMIT_MAX_REQUESTS = 5 per 15 min). No value is shown by source, standard or test to balance brute-force protection against NAT collateral lockout. TASK-240 may split the buckets and keep 5 as each group's default, but must not raise any default until this is answered.
- **section-54e0550cc9bcc157839af582/UQ-002**: What default per-IP ceiling should session-bearing /api/v1/canvases* and /api/v1/canvas-items*|/api/v1/items* requests get, so that a per-user budget (100 / 400 per minute) is reachable? Should anonymous requests keep 50 / 200? The constants comment says '(IP budgets stay 50 / 200)', which records intent but no value for a session ceiling. Any ceiling at or above the per-user budget meets the issue's assertion, but no specific value is known to be right for shared-NAT deployments. TASK-242 must not commit a default until this is answered.

`questions.md` lists 110 more open questions the plan went ahead on with a default.

379 lower-severity issues were left unverified and are not planned; the run's issue board lists them.

## Premise check

Each prompt's first step runs `node .arbitra/plans/2026-11-11-bcd4fc1e/check-premises.mjs <task id>`. It looks up what the prompt names (files, names, routes, socket events, quoted code and cited lines) in the code as it is then, and prints what moved since the plan was saved (with the new lines), what is gone and what was never found: earlier tasks move code, and a prompt's premise can be wrong.

When the plan was saved, 4905 of the 5006 things the prompts name were found in the code (21 quotes were at other lines than the prompt gives; the script prints where). 101 were not, in 69 prompts: each is marked in its prompt under `<not_found>` and counted in the order below. The executing agent finds the real code or reports the premise false. Names a prompt's steps add, and files it creates, are not counted.

## Order of work

A task marked "after" builds on that task's change. "Same files as" only means both edit a file: such tasks can be done side by side (one agent each in its own git worktree, say) and merged one after the other.

1. `TASK-001` Serendipity: authorize cross-canvas reads by recipient-bound shares, not email · 2-balanced-model
2. `TASK-002` Single-comment GET: return an allowlisted DTO (no shares, emails, canvas row or BigInt) · 2-balanced-model · 1 not found
3. `TASK-003` Extension: refuse plain-HTTP Memoria addresses except loopback · 3-fast-model
4. `TASK-004` Extension popup: in-flight save guard and re-check tab URLs before closing · 2-balanced-model · after TASK-003
5. `TASK-005` Report App Router boundary errors and server render errors to Sentry; load browser Sentry · 2-balanced-model
6. `TASK-006` Scope IntegrationAccount uniqueness to the agent profile and return 409 on duplicates · 2-balanced-model
7. `TASK-007` Clear CanvasItem.archivedAt on every undelete path and repair live rows · 2-balanced-model
8. `TASK-008` Release upload quota when a canvas deletion cascades its UploadAsset rows · 2-balanced-model · 1 not found
9. `TASK-009` Account deletion: keep uploads that back preserved items on other owners' canvases · 2-balanced-model · after TASK-008
10. `TASK-010` Make home-board accept and auto-file atomic; stop dismissing on transient errors · 1-strong-model
11. `TASK-011` Make server.ts the single owner of SIGTERM/SIGINT and disconnect Prisma only after the HTTP drain · 2-balanced-model · 1 not found
12. `TASK-012` Bind the HTTP listener to the configured hostname · 3-fast-model · after TASK-011 · same files as TASK-010, TASK-009, TASK-007, TASK-006, TASK-004, TASK-002, TASK-001
13. `TASK-013` Validate TRUSTED_PROXY_CIDRS at startup and cache the parsed list · 2-balanced-model
14. `TASK-014` Use TLS for https/wss sync upstreams in proxySyncUpgrade and reject unsupported schemes at startup · 2-balanced-model · after TASK-012
15. `TASK-015` Refuse to seed in production and make seed re-runs safe · 3-fast-model · same files as TASK-012
16. `TASK-016` Use a renewed lockedAt lease and row-id-scoped writes in runIdempotent · 1-strong-model · same files as TASK-012
17. `TASK-017` Release upload quota when an asset enters DELETING and re-arm DEAD upload.delete jobs · 1-strong-model · same files as TASK-009
18. `TASK-018` Queue cleanup for collaborators' uploads on the deleted user's canvases during account deletion · 2-balanced-model · after TASK-017 · same files as TASK-012
19. `TASK-019` Run the embedding similarity scan outside the canvas-locked enrichment transaction · 2-balanced-model · same files as TASK-012
20. `TASK-020` Detect committed-event gaps per canvas instead of assuming contiguous global sequences · 1-strong-model
21. `TASK-021` Gate the agent action timeline on the READ rung and current canvas scope · 1-strong-model
22. `TASK-022` Filter the organizer's proposal queue and audited writes by canvas on the server · 2-balanced-model · after TASK-021
23. `TASK-023` Require suggestion ownership before claiming in REST execute-suggestion · 2-balanced-model · same files as TASK-022
24. `TASK-024` Validate MCP external proposals with the shared schema and match suggestion kind to payload kind · 2-balanced-model · after TASK-023
25. `TASK-025` Finalize HomeBoardSuggestion rows when Ask suggestions run through generic execution · 2-balanced-model · after TASK-024 · same files as TASK-010
26. `TASK-026` Use a dedicated outbound signing secret for new WEBHOOK integrations · 2-balanced-model · same files as TASK-022, TASK-006
27. `TASK-027` Bound CSP report body reading before buffering · 3-fast-model
28. `TASK-028` Stop reporting unknown backup state as a fresh backup · 3-fast-model
29. `TASK-029` Select the built-in AI credential by tag in the query, not after a 25-row window · 2-balanced-model · 1 not found
30. `TASK-030` Do not silently fall back to env AI keys when a saved built-in credential is unusable · 2-balanced-model · after TASK-029
31. `TASK-031` Mark AI credentials rejected only on 401 and only for the secret that failed · 2-balanced-model · after TASK-030 · 1 not found
32. `TASK-032` Require re-entering the AI key to change the saved base URL · 3-fast-model · same files as TASK-030
33. `TASK-033` Pin AI provider connections to the validated IP and cap provider response bytes · 1-strong-model · same files as TASK-031 · 1 not found
34. `TASK-034` Stop built-in AI PUT from rewriting a credential an agent profile still uses · 2-balanced-model · after TASK-033 · same files as TASK-032
35. `TASK-035` Make API key 'Expires on' follow the chosen local day and show server errors · 3-fast-model · 1 not found
36. `TASK-036` Revoke API keys on password reset/change and gate key creation behind re-authentication · 2-balanced-model
37. `TASK-038` HTML-escape the user name in reset, verification and welcome email templates · 3-fast-model
38. `TASK-037` Remove the existing-account timing difference from forgot-password · 2-balanced-model · after TASK-038 · same files as TASK-006
39. `TASK-039` Keep EditBookmarkDialog from saving metadata that belongs to a different URL · 2-balanced-model
40. `TASK-040` Discard link-enrichment results when the bookmark URL changed during the job · 2-balanced-model · same files as TASK-019
41. `TASK-041` Validate bookmark refresh content with the canonical bookmark schema · 2-balanced-model · 1 not found
42. `TASK-042` Enforce the poll policy on command creates and the ids hydration read · 3-fast-model · same files as TASK-007
43. `TASK-043` Queue thumbnail object deletion when a canvas or account is deleted · 2-balanced-model · same files as TASK-018
44. `TASK-044` Stop no-op viewport PATCHes and viewport-only 'updated canvas' activity · 2-balanced-model · after TASK-043
45. `TASK-045` Report correct hasMore on public share cursor pages · 2-balanced-model · 2 not found
46. `TASK-046` Make invitation revocation atomic with acceptance · 1-strong-model
47. `TASK-047` Show and revoke pending invitations in ShareDialog · 2-balanced-model · after TASK-046
48. `TASK-048` Require current canvas access in the single-comment route · 2-balanced-model · same files as TASK-002
49. `TASK-049` Store and display comments as plain text · 2-balanced-model · after TASK-048 · 2 not found
50. `TASK-050` Guard version restore against double submit · 3-fast-model
51. `TASK-051` Queue thumbnail deletion when a canvas is deleted · 3-fast-model · same files as TASK-044 · 1 not found
52. `TASK-052` Recheck edit access under lock before an upload-note job writes · 1-strong-model
53. `TASK-053` Prevent overlapping notification preference saves from reverting choices · 2-balanced-model
54. `TASK-054` Add result paging to GlobalSearchDialog · 2-balanced-model
55. `TASK-055` Reduce repeated match-predicate scans in global search without changing results · 1-strong-model · 3 not found
56. `TASK-056` Scope dashboard bulk selection to the visible workspace · 3-fast-model
57. `TASK-057` Stop the not-found page reading client-only theme exports from a Server Component · 3-fast-model
58. `TASK-058` Cap password length before zxcvbn in register, reset-password and validatePasswordStrength · 2-balanced-model · same files as TASK-036
59. `TASK-059` Run idempotency before withAuthValidation consumes the request body · 2-balanced-model · same files as TASK-016 · 1 not found
60. `TASK-060` Make unfurl cache keys preserve path/query case and repeated parameters · 3-fast-model
61. `TASK-061` Check every GIF image-descriptor frame size in parseGif · 2-balanced-model
62. `TASK-062` Keep the malware-scan timeout active while reading the scan response body · 2-balanced-model
63. `TASK-063` Bound account deletion's interactive transaction · 1-strong-model · same files as TASK-043
64. `TASK-064` Report hasMore and nextCursor correctly on public share cursor pages · 2-balanced-model · same files as TASK-045 · 2 not found
65. `TASK-065` Stop CreateBookmarkDialog retrying a failed unfurl for the same URL · 3-fast-model
66. `TASK-066` Delete uncommitted uploads when CreateImageDialog is abandoned or the image is replaced · 2-balanced-model · 1 not found
67. `TASK-067` Sign the user out and send them to login after a successful password change · 3-fast-model
68. `TASK-068` Guard the CanvasBoard Stage drag handlers so item drags do not pan the viewport · 2-balanced-model
69. `TASK-069` Convert bookmark resize pointer coordinates to world space · 2-balanced-model · 1 not found
70. `TASK-070` Reset the search type filter and always show a way to clear it · 3-fast-model
71. `TASK-071` Show error states in AgentControlCenter instead of empty-state messages · 3-fast-model · same files as TASK-026
72. `TASK-072` Measure the public share Stage after the canvas container mounts · 3-fast-model · same files as TASK-064
73. `TASK-073` Make stripHtmlTags parse note HTML in an inert document · 2-balanced-model · 1 not found
74. `TASK-074` Send bounded chat history from AIDialog through the chat route to the providers · 2-balanced-model · same files as TASK-033
75. `TASK-075` Reject protocol-relative callback paths after login · 2-balanced-model
76. `TASK-076` Stop late camera streams and keep the AR video attached across re-renders · 2-balanced-model
77. `TASK-077` Give ConfirmDialog a pending state and contain onConfirm rejections · 3-fast-model
78. `TASK-078` Surface restore and Autopilot failures in CanvasBoard and keep VersionHistoryDialog guarded · 2-balanced-model · after TASK-077 · same files as TASK-068, TASK-050
79. `TASK-079` Report account-export cancellation only after the server confirms it · 3-fast-model · same files as TASK-067
80. `TASK-080` Fix GridOverlay world-space origin and bound line count with a zoom-adaptive step · 2-balanced-model · same files as TASK-012
81. `TASK-081` Quick capture: keep edits made during save and ignore IME-confirmation Enter · 2-balanced-model · same files as TASK-012
82. `TASK-082` Serendipity: await item creation before closing and surface failures · 2-balanced-model · same files as TASK-012
83. `TASK-083` AI dialog: keep the generated note until creation succeeds · 2-balanced-model · after TASK-082 · same files as TASK-078, TASK-074
84. `TASK-084` Organizer view: stop the mount-commit default-filter write over saved filters · 2-balanced-model · same files as TASK-022, TASK-012
85. `TASK-085` Organizer view: resolve source items and suggestions against the whole canvas, not the viewport · 2-balanced-model · after TASK-084
86. `TASK-086` JSON and Markdown exports include every canvas item · 2-balanced-model · same files as TASK-012
87. `TASK-087` PDF export fits the snapshot inside the page · 3-fast-model · after TASK-086
88. `TASK-088` Sort into piles: ignore stale organizer responses after close, reopen or re-sort · 2-balanced-model · same files as TASK-012
89. `TASK-089` Microphone startup: no recording after unmount and no concurrent recorders · 2-balanced-model · same files as TASK-012
90. `TASK-090` Fix Note/Image resize: stop handle drag bubbling and use world-space pointer coordinates · 2-balanced-model
91. `TASK-091` Focus the CursorChat input so typing never triggers canvas shortcuts · 3-fast-model
92. `TASK-092` Bound AI chat context to the chatSchema limit and surface validation failures · 2-balanced-model · same files as TASK-083
93. `TASK-094` Gate drawing tools by create capability for read-only users · 2-balanced-model · same files as TASK-092
94. `TASK-093` Render a live preview for in-progress pen strokes, shapes and arrows · 2-balanced-model · after TASK-094 · same files as TASK-092
95. `TASK-095` Keep the marquee selection when the click after a marquee drag fires · 2-balanced-model · after TASK-094 · same files as TASK-093
96. `TASK-096` Make BookmarkItem's memo comparator respect capabilities and current callbacks · 2-balanced-model · same files as TASK-069
97. `TASK-097` Make Time Machine preview read-only · 2-balanced-model · after TASK-096 · same files as TASK-094, TASK-093, TASK-044
98. `TASK-098` Aggregate geometry save status across per-item queues · 2-balanced-model · same files as TASK-097
99. `TASK-099` Route keyboard nudges and align/distribute through the geometry queue · 2-balanced-model · after TASK-098
100. `TASK-100` Make Autopilot lay out the full canvas item set, not the viewport subset · 2-balanced-model · same files as TASK-099
101. `TASK-101` Make the item-list filter key reach the board's viewport query and write updated versions into it · 1-strong-model · same files as TASK-100 · 4 not found
102. `TASK-102` Scope the committed-event merge and delete rollback to the event's canvas and viewport window · 2-balanced-model · after TASK-101
103. `TASK-103` Bound committed-event replay retries and ignore replay responses from a superseded canvas session · 1-strong-model · same files as TASK-020
104. `TASK-104` Make time-machine preview read-only while keeping version restore · 2-balanced-model · same files as TASK-100
105. `TASK-105` Place Whisper and Serendipity items at the zoom-aware viewport centre · 3-fast-model · after TASK-104
106. `TASK-106` Keep stage resize tracking after switching back from organizer view · 3-fast-model · after TASK-105
107. `TASK-107` Stop EditNoteDialog from rewriting TEXT items as note content · 2-balanced-model · after TASK-106
108. `TASK-108` Release late camera streams and stop the AR dialog remounting its video · 2-balanced-model · same files as TASK-076
109. `TASK-109` Let the list view's nested Edit and Delete buttons handle their own keys · 3-fast-model
110. `TASK-110` Prevent CreateImageDialog from submitting the previous image during replacement · 3-fast-model · same files as TASK-066
111. `TASK-111` Preserve drag direction for arrows and allow horizontal and vertical arrows · 2-balanced-model · same files as TASK-094, TASK-093 · 2 not found
112. `TASK-112` Stop BookmarkItem resize-handle drags from bubbling into the Group move handlers · 2-balanced-model · same files as TASK-096 · 3 not found
113. `TASK-113` Let SerializedDeltaQueue adopt newer item versions and stop replaying conflicted deltas · 2-balanced-model · same files as TASK-099
114. `TASK-114` Automatically retry transient delta-queue failures with bounded backoff · 2-balanced-model · after TASK-113
115. `TASK-115` Ignore stale public-status responses in ShareDialog · 2-balanced-model · same files as TASK-047
116. `TASK-116` Prevent orphaned microphone recorders in UploadNoteOffer · 2-balanced-model · same files as TASK-089
117. `TASK-117` Scope AskPalette settlement to the suggestion that was applied · 2-balanced-model
118. `TASK-118` Make the global process error handlers unable to throw before Sentry capture and exit · 2-balanced-model · same files as TASK-005
119. `TASK-119` Export PNG/PDF of the whole canvas without the viewport transform or overlays · 1-strong-model · same files as TASK-107, TASK-087, TASK-080 · 1 not found
120. `TASK-120` Make account-export writeChunk settle when the gzip pipeline fails · 2-balanced-model · 1 not found
121. `TASK-121` Require the READ rung for MCP content-read tools · 2-balanced-model · same files as TASK-025
122. `TASK-122` Scope related entities and item links in knowledge listings · 2-balanced-model · same files as TASK-022 · 1 not found
123. `TASK-124` Make built-in pile grouping always satisfy pilesSchema · 2-balanced-model
124. `TASK-123` Identify the built-in organizer by a system marker and grant canvas scope only after its capability check · 1-strong-model · after TASK-124 · same files as TASK-037, TASK-012
125. `TASK-125` Execute MCP-approved suggestions only under the proposing agent profile · 2-balanced-model · after TASK-121 · same files as TASK-012
126. `TASK-126` Observe the account-export pipeline promise from creation · 2-balanced-model · same files as TASK-120
127. `TASK-127` Let Sort into piles retry execution after a successful approval · 3-fast-model · same files as TASK-088
128. `TASK-128` Add status, canvas and revertable filters plus a cursor to the action timeline · 2-balanced-model · after TASK-122 · same files as TASK-025, TASK-012
129. `TASK-129` Show actionable suggestions and revertable change sets in AgentControlCenter · 2-balanced-model · after TASK-128 · same files as TASK-071
130. `TASK-130` Use server-side canvas and status filtering in CanvasOrganizerView · 3-fast-model · after TASK-128 · same files as TASK-129, TASK-085
131. `TASK-131` Refuse undo of an agent-created board when cascaded user content exists · 2-balanced-model · same files as TASK-012
132. `TASK-132` Enforce agent canvas scope and change-set ownership on REST revert-change-set · 1-strong-model · same files as TASK-131, TASK-128
133. `TASK-133` Make approveSuggestion and rejectSuggestion compare-and-set transitions · 2-balanced-model · same files as TASK-132
134. `TASK-134` Validate before claiming and release failed claims in REST and MCP suggestion execution · 1-strong-model · after TASK-132, TASK-133 · same files as TASK-125
135. `TASK-135` Make acceptHomeBoardSuggestion resumable after partial completion · 1-strong-model · after TASK-133, TASK-134
136. `TASK-136` Let AskPalette retry execution without re-approving · 2-balanced-model · after TASK-134 · same files as TASK-117
137. `TASK-137` Bound knowledge attribute size, key count and depth · 2-balanced-model
138. `TASK-138` Apply the polls launch gate to agent item writes · 3-fast-model · after TASK-134 · 1 not found
139. `TASK-139` Store canvasId on knowledge-relation proposals so the organizer shows them · 2-balanced-model · after TASK-137, TASK-134 · same files as TASK-130 · 1 not found
140. `TASK-140` Select inbox slots under the canvas mutation lock · 2-balanced-model · after TASK-138
141. `TASK-141` Stop loading change-record snapshots in the action timeline · 2-balanced-model · after TASK-139
142. `TASK-142` Atomic revert claim and up-front sorted canvas lock set in revertChangeSet · 1-strong-model · same files as TASK-140
143. `TASK-143` Guard MOVE undo against later relocation, deletion and destination-board connections · 2-balanced-model · after TASK-142 · same files as TASK-135
144. `TASK-144` Stop CanvasItem UPDATE undo from overwriting later edits · 2-balanced-model · after TASK-142 · same files as TASK-143, TASK-124, TASK-123
145. `TASK-145` Archive undo restores only items still in the state the archive left them · 2-balanced-model · after TASK-142 · same files as TASK-144
146. `TASK-146` Ask move re-reads items under its locks and honors an expected source board · 1-strong-model · same files as TASK-143
147. `TASK-147` Collaborative projection tolerates items moved to another board · 1-strong-model · same files as TASK-007
148. `TASK-148` Enforce canvas scope on MCP actions.revert_change_set · 2-balanced-model · after TASK-142 · same files as TASK-145, TASK-139
149. `TASK-149` Shorten the canvas-lock window for workspace checkpoints and drop the duplicate canvas read · 2-balanced-model · same files as TASK-148
150. `TASK-150` Prune WorkspaceCheckpoint rows according to an agreed retention policy · 2-balanced-model · after TASK-149
151. `TASK-151` Keep generated AI output when the post-success usage read fails · 2-balanced-model · same files as TASK-074
152. `TASK-152` Replace the persistent AI concurrency counter with expiring per-request leases · 2-balanced-model · after TASK-151 · same files as TASK-060 · 1 not found
153. `TASK-153` Flag a saved AI credential only on a real key rejection, and only if the failing secret is still saved · 2-balanced-model · same files as TASK-074 · 2 not found
154. `TASK-154` Stop idempotency recovery from re-running a mutation whose completion was not journaled · 2-balanced-model · same files as TASK-059
155. `TASK-155` Guard the seed script so it refuses to create known-password accounts on production databases · 3-fast-model · same files as TASK-015 · 1 not found
156. `TASK-156` Show a distinct sign-in message when the lockout store is unavailable · 3-fast-model · same files as TASK-075
157. `TASK-157` Apply account lockout to the two-factor endpoints that check the password · 2-balanced-model
158. `TASK-158` Rotate failing bookmarks out of the refresh batch and stop enqueueing when unfurling is disabled · 2-balanced-model · same files as TASK-041
159. `TASK-159` Expose offline cache failure in the document snapshot and stop claiming edits are kept on the device · 2-balanced-model · same files as TASK-119
160. `TASK-160` Merge into the shared device-copy state on compaction instead of overwriting another tab's edits · 2-balanced-model · after TASK-159
161. `TASK-161` Load the persisted canvas document from a single database snapshot so compaction cannot skip committed updates · 1-strong-model · same files as TASK-147
162. `TASK-162` Harden the presence upgrade listener and connection setup against malformed Host headers and early socket errors · 2-balanced-model · 1 not found
163. `TASK-163` Serialize the presence socket's per-canvas Redis subscription reference count · 1-strong-model · after TASK-162
164. `TASK-164` Stop sending collaborators' email addresses in presence, cursor-chat and reaction payloads · 2-balanced-model · after TASK-163 · same files as TASK-103, TASK-012 · 1 not found
165. `TASK-165` Require the current share token for signed-in non-recipients on public canvases (sync and presence) · 1-strong-model · after TASK-164 · same files as TASK-160
166. `TASK-166` Classify sync authentication failures so transient errors retry and signed-out sessions keep the device copy · 1-strong-model · after TASK-165 · same files as TASK-147 · 1 not found
167. `TASK-167` Send only missing changes on reconnect instead of the whole document, and stop the oversized-frame reconnect loop · 1-strong-model · after TASK-166
168. `TASK-168` Count same-update deletions before the item capacity check in document projection · 2-balanced-model · same files as TASK-147, TASK-012
169. `TASK-169` Let shared admission renewal recreate missing leases for connections the process still holds · 1-strong-model · same files as TASK-012
170. `TASK-170` Give proxied collaboration upgrades the real client identity in the realtime process · 2-balanced-model · same files as TASK-014
171. `TASK-171` Enforce concurrent connection limits on the sync server · 1-strong-model · after TASK-166, TASK-169, TASK-170 · 1 not found
172. `TASK-172` Let committed-event replay pass a 'restored' CanvasEvent · 1-strong-model · same files as TASK-164, TASK-161
173. `TASK-173` Use the normalized SMTP password (SMTP_PASS or SMTP_PASSWORD) when building the SMTP config · 2-balanced-model · same files as TASK-037, TASK-013 · 1 not found
174. `TASK-174` Apply the production placeholder check to storage, database and SMTP credentials · 2-balanced-model · after TASK-173
175. `TASK-175` Report 5xx ApiErrors to Sentry and stop dropping ECONNREFUSED events · 2-balanced-model · same files as TASK-006 · 1 not found
176. `TASK-176` Log, report and redact internal errors in the MCP JSON-RPC route · 2-balanced-model · after TASK-175 · 1 not found
177. `TASK-177` Do not journal transient 5xx/429 failures in runIdempotent, and replay with correct headers · 1-strong-model · same files as TASK-154 · 2 not found
178. `TASK-178` Return 403 instead of 401 for permission failures in the item comments API · 2-balanced-model · same files as TASK-049
179. `TASK-179` Show problem+json detail on the reset-password and forgot-password pages · 3-fast-model · same files as TASK-058 · 1 not found
180. `TASK-180` Make useItemConnections fetch every page of connections · 3-fast-model · 1 not found
181. `TASK-181` Apply connection_limit and pool_timeout from DATABASE_URL to the pg pool · 2-balanced-model · same files as TASK-011 · 1 not found
182. `TASK-182` Bound slow consumers' outbound queues in websocket broadcasts · 2-balanced-model · same files as TASK-165
183. `TASK-183` Keep over-long tab URLs out of extension batches and name the rejected tab · 2-balanced-model · same files as TASK-004 · 1 not found
184. `TASK-184` Map upstream HTTP failures in the unfurl route to 502 instead of passing the third-party status through · 2-balanced-model · same files as TASK-012 · 2 not found
185. `TASK-185` Stop the optimistic create updater from rewriting the accessible infinite query · 2-balanced-model · same files as TASK-102 · 4 not found
186. `TASK-186` Retry failed reconnect handshakes with backoff instead of ending collaboration · 2-balanced-model · same files as TASK-182, TASK-172
187. `TASK-187` Seed the committed-event cursor from the loaded snapshot's revision instead of replaying from 0 · 2-balanced-model · after TASK-186
188. `TASK-188` Stop global-sequence holes from triggering committed-event replays (gated on section-8911816ae25d00a3b49e7b7a/Q-001) · 1-strong-model · after TASK-187 · 1 not found
189. `TASK-189` Remove the quadratic trailing-slash regex from isMcpResource and cap OAuth form input size · 2-balanced-model · same files as TASK-012 · 1 not found
190. `TASK-190` Revoke the whole refresh-token family when a rotated refresh token is reused · 1-strong-model · after TASK-189 · same files as TASK-150
191. `TASK-191` Revoke tokens issued from an authorization code when the code is reused · 2-balanced-model · after TASK-190
192. `TASK-192` Let retention sweeps process all eligible rows instead of 500 per table per day · 2-balanced-model · same files as TASK-150 · 1 not found
193. `TASK-193` Prune old COMPLETED outbox rows without breaking deduplication · 2-balanced-model · after TASK-192
194. `TASK-194` Fence the account-export failure update to the owning attempt · 2-balanced-model · same files as TASK-126, TASK-012
195. `TASK-195` Stop sanitizeAllowedHtml from re-parsing decoded text as HTML · 1-strong-model · 3 not found
196. `TASK-196` Convert legacy HTML notes into a structured, entity-decoded document · 2-balanced-model · after TASK-195 · same files as TASK-012 · 1 not found
197. `TASK-197` Adapt raw ProseMirror JSON to the canonical note format in the non-shared editor · 2-balanced-model · same files as TASK-012 · 2 not found
198. `TASK-198` Give the non-shared editor the same schema as the note validator, with history kept · 2-balanced-model · after TASK-197
199. `TASK-199` Replace RichTextEditor's key-order-sensitive setContent check with a canonical comparison · 2-balanced-model · after TASK-198 · 2 not found
200. `TASK-200` Make writeNoteFragment's fallback keep block boundaries · 2-balanced-model · same files as TASK-012 · 1 not found
201. `TASK-201` Run the outbox worker as a continuous slot pool that survives job-state persistence failures · 1-strong-model · same files as TASK-037, TASK-012
202. `TASK-202` Move expired-lease jobs that have used all their attempts to DEAD instead of reclaiming them · 2-balanced-model · same files as TASK-012
203. `TASK-203` Defer account-export redeliveries that find a recent RUNNING export instead of acknowledging the job · 1-strong-model · after TASK-201, TASK-202 · same files as TASK-194 · 2 not found
204. `TASK-204` Retry link enrichment on transient AI concurrency or budget-store errors · 2-balanced-model · same files as TASK-040
205. `TASK-205` Cancel upload-note storage reads when the worker aborts · 2-balanced-model · same files as TASK-052, TASK-012
206. `TASK-206` Make note row→document conversion symmetric and never replace a note with an empty paragraph · 1-strong-model · same files as TASK-200, TASK-196, TASK-168
207. `TASK-207` Convert legacy HTML notes with decoded entities, block separators and a structured document · 2-balanced-model · after TASK-206 · 3 not found
208. `TASK-208` Stop reparsing note plainText as HTML in list view and canvas search · 3-fast-model · after TASK-207 · same files as TASK-109
209. `TASK-209` Prevent EditNoteDialog from saving stale or default form values when a note fails normalization · 2-balanced-model · same files as TASK-107
210. `TASK-210` Enforce the per-canvas item limit on Trash restore and archive undo · 2-balanced-model · same files as TASK-145
211. `TASK-211` Limit Ask's move-only type check to move and create-board commands · 3-fast-model · same files as TASK-146
212. `TASK-212` Re-read Ask move items under canvas locks and guard the write · 1-strong-model · after TASK-211
213. `TASK-213` Make thumbnail installation revision-safe under the canvas lock · 2-balanced-model · same files as TASK-043
214. `TASK-214` Re-check staleness under locks and commit the recap archive link in the archive transaction · 1-strong-model · after TASK-210
215. `TASK-215` Close only tabs whose URL was saved or exactly matches an existing copy · 2-balanced-model · same files as TASK-183 · 1 not found
216. `TASK-216` Check clip-batch duplicates under the Inbox lock and de-duplicate within a batch · 2-balanced-model
217. `TASK-217` Block the IPv6 unspecified address and missing special-purpose ranges in isPrivateIp · 1-strong-model · same files as TASK-033, TASK-012 · 2 not found
218. `TASK-218` Add a total deadline to SSRF-safe fetches and wire the webhook AbortController · 2-balanced-model · after TASK-217 · same files as TASK-184 · 1 not found
219. `TASK-219` Guard upload asset status transitions and stop double quota debits for FAILED assets · 1-strong-model · same files as TASK-017, TASK-012
220. `TASK-220` Release upload quota inside the canvas DELETE transaction · 1-strong-model · after TASK-219 · same files as TASK-051 · 1 not found
221. `TASK-221` Compensate successful object writes whose activation fails · 2-balanced-model · after TASK-219, TASK-220 · same files as TASK-062 · 1 not found
222. `TASK-222` Make thumbnail cleanup durable before the candidate row is removed · 2-balanced-model · same files as TASK-213 · 1 not found
223. `TASK-223` Ignore unfurl responses for a URL that is no longer in the bookmark field · 2-balanced-model · same files as TASK-065, TASK-012
224. `TASK-224` Require an explicit click before the share-target page saves a link · 2-balanced-model · same files as TASK-012
225. `TASK-225` Keep hash-route fragments in normalizeLinkUrl · 2-balanced-model · same files as TASK-216, TASK-012
226. `TASK-226` Validate single-link clips with the canonical bookmark content schema · 2-balanced-model · same files as TASK-012 · 2 not found
227. `TASK-227` Forward the CSP header on the request so Next.js nonces its framework scripts · 1-strong-model · 1 not found
228. `TASK-228` Stop CreateBookmarkDialog from retrying a failed unfurl in a loop · 2-balanced-model · same files as TASK-223
229. `TASK-229` Load sentry.client.config.ts in the browser bundle · 2-balanced-model · same files as TASK-012, TASK-005 · 3 not found
230. `TASK-230` Render schema-valid TEXT, ARROW and FRAME items that lack optional fields · 2-balanced-model · same files as TASK-107 · 3 not found
231. `TASK-231` Stop the SSRF hostname pre-check from rejecting public domains that look like IP prefixes · 1-strong-model · same files as TASK-218
232. `TASK-232` Resolve link-page metadata against the final URL after redirects · 2-balanced-model · after TASK-231
233. `TASK-233` Derive the client IP correctly when X-Forwarded-For contains malformed entries · 1-strong-model · same files as TASK-013, TASK-012 · 1 not found
234. `TASK-234` Show a rate-limit message when the two-factor step returns 429 · 3-fast-model · same files as TASK-156
235. `TASK-235` Redact share, embed and invitation tokens from proxy request logs · 2-balanced-model · after TASK-227 · same files as TASK-012 · 3 not found
236. `TASK-236` Count dashboard thumbnail GETs against the assets budget, not the canvases limiter · 2-balanced-model · after TASK-235
237. `TASK-237` Apply the strict auth rate limit to password change and account deletion · 2-balanced-model · after TASK-236
238. `TASK-238` Keep clip batches from failing on untitled long URLs · 3-fast-model · same files as TASK-216, TASK-012
239. `TASK-239` Finalize every early proxy response with request id, CORS, security headers and CSP · 2-balanced-model · same files as TASK-236
240. `TASK-240` Partition the strict auth rate limit into per-route-group buckets · 2-balanced-model · after TASK-239 · same files as TASK-237
241. `TASK-241` Give /api/csp-report its own rate-limit bucket separate from OAuth and setup · 3-fast-model · after TASK-240
242. `TASK-242` Make per-user canvas and item budgets reachable via a session-aware per-IP ceiling · 2-balanced-model · after TASK-241 · 1 not found
243. `TASK-243` Bound bulk canvas delete concurrency, stop on 429 and surface server errors · 2-balanced-model · same files as TASK-056 · 1 not found

## Unsure: check after the tasks, if at all

The audit could not settle these 8 reports: no peer review checked them, and the verifier could not decide from the code it was shown. They are not part of the work above, and most such reports do not hold. In the first plan carried out this way (nextra, October 2026), 7 of 20 such reports held: 5 of 10 medium, and 2 of 10 high or critical, both security defects. Each prompt in `prompts/4-unsure` asks a strong model to decide whether the defect is real, by reading the code and running it where that helps, and to fix it only if a test or a run shows it. They are listed most severe first.

1. `C-462d220a995e` Infinite Loop on Process Exit via Asynchronous beforeExit Handler in Database Client · high
2. `C-15b5d2347d0d` UPLOAD_NOTE_TIMEOUT_MS is never used in the snapshot, and the worker's default handler deadline is 15 s · medium · 1 not found
3. `C-315d63b362c8` An item larger than the response byte budget returns an empty page with hasMore=true and nextCursor=null, so loading stops at that item · medium · 1 not found
4. `C-928b98029fe2` Reasoning and thinking models get small output-token caps and no reasoning-effort setting, so they can return empty answers · medium
5. `C-a23855d38e28` prisma/seed.ts does not load environment variables via dotenv · medium
6. `C-b4bad70805c6` Every canvas item mutation queues a publish job whose default publisher always throws when Redis is not configured · medium
7. `C-bebf528a7147` Prisma cursor pagination can silently cut a section short if the cursor row is deleted during the export · medium · 1 not found
8. `C-d4f70d4b64d5` The browser extension has no manifest.json, so it cannot be installed and permissions.request has no optional host permission to grant · medium

## Model tiers

- `1-strong-model`: your strongest model (such as Claude Opus), for reasoning across files, or a fix that is easy to get subtly wrong.
- `2-balanced-model`: a balanced model (such as Claude Sonnet), for a contained change with a clear target.
- `3-fast-model`: a fast, inexpensive model (such as Claude Haiku), for a small, mechanical change.
