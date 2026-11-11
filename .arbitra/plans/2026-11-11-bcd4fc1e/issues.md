# Issues this plan fixes

## Serendipity bypasses recipient-bound share authorization

high · accepted · C-7b8170535b73

The route checks ownership only of the current canvas, then searches other canvases using the caller's email. Canonical authorization instead requires a share bound to recipientId. The migration leaves legacy shares unbound when their email has no existing user. An account subsequently registered with that email can therefore retrieve another owner's note/text content through serendipity despite having no recipient-bound access.

## Single-comment GET returns the full canvas row, including every collaborator's email address

high · accepted · C-72c3d1b665d1

getCommentWithAccess loads the comment with `item -> canvas -> shares: true` so it can check access. The GET handler then serializes that whole object with `NextResponse.json(comment)`. The response therefore holds the full CanvasItem row (content included, even for trashed items, because item.deletedAt is never checked), the full Canvas row (userId, workspaceId, isPublic, shareToken and so on) and every CanvasShare row. Each CanvasShare row carries the `email` of the person the canvas was shared with, plus recipientId and role. The access gate lets in any authenticated user when the canvas is public, any share recipient including VIEW, and the comment's author.

## Individual comment GET serializes an unsupported BigInt

medium · accepted · C-49596a38ad19

The nested Canvas include retrieves every scalar field, including thumbnailRevision as a JavaScript bigint. Returning the complete comment object through NextResponse.json throws during JSON serialization, including when the revision is its default zero.

## Remote HTTP addresses expose API keys and saved tab data

medium · accepted · C-894fcae47f4b

normalizeServerUrl accepts HTTP for any hostname, and sendBatch transmits the reusable API key and tab payload to that address. There is no restriction to loopback development addresses or secure transport. An eventual HTTPS redirect cannot protect the initial HTTP request.

## Changing selection re-enables Save during an active operation

medium · accepted · C-5f3ce465a20b

Disabling the button is the only protection against concurrent saves. Selection checkboxes remain enabled, and their change handler calls renderSelection, which re-enables Save whenever any tab remains selected. save has no in-flight guard, so another operation can start while the first is awaiting a response. There is also an initial re-entry window before batchesFor finishes.

## Tabs are closed without checking whether their URLs changed

medium · accepted · C-863c6aec14df

The extension submits URLs from the initial tab snapshot and subsequently removes those tab IDs without checking their current or pending URLs. A tab that navigates after collection or during the request is therefore closed based on confirmation of its previous page.

## Errors caught by error.tsx and global-error.tsx never reach error reporting, and browser Sentry is never initialized

medium · accepted · C-f3940998b3c4

Both App Router error boundaries only call console.error, even though the comment in error.tsx says the error is logged to an error reporting service. When React catches a render error in an error boundary, it does not fire window 'error' or 'unhandledrejection', so Sentry's global handlers never see it. A Sentry.captureException call in the boundary is what reports these errors, and neither boundary has one. On top of that, the browser Sentry setup is never loaded. sentry.client.config.ts is not imported anywhere (a repository search for 'sentry.client.config' returns nothing). next.config.mjs exports only withBundleAnalyzer(nextConfig) and does not use withSentryConfig, which is what would inject that file. There is also no instrumentation-client file. A repository search for 'onRequestError' also found nothing, so server-component render errors behind the digest shown to users are not sent to Sentry either.

## IntegrationAccount (providerType, externalAccountId) is unique across all tenants, so external IDs and webhook URLs can be claimed first by anyone and collide between users

medium · accepted · C-2f560dd27409

The unique index covers only (providerType, externalAccountId). It is not scoped to the agent profile or the user. The externalAccountId is free text supplied by the user (for WEBHOOK it is the delivery URL), and the create route never checks that the caller controls that external account. One user's registration therefore blocks every other user, and every other agent profile of the same user, from registering the same WhatsApp/OpenClaw ID or webhook URL.

## A unique constraint across all users on (providerType, externalAccountId) lets one user block another and reveals other users' registrations

medium · accepted · C-3cfde66d9c3e

IntegrationAccount is scoped to a tenant (agentProfile, then user), but its uniqueness is not. The constraint `@@unique([providerType, externalAccountId])` applies to every user's rows at once. For WEBHOOK accounts the route makes externalAccountId the delivery URL. For other providers it is a free-form external identifier, such as a WhatsApp or OpenClaw account id. The create path in `POST /api/agent/v1/integrations` neither checks for an existing row nor catches the unique violation. I found no handler for P2002 or Prisma errors in src/lib/errors.ts; db.ts only lists P2002 as non-retryable. Nothing uses the constraint to route data either: no code looks rows up by `providerType_externalAccountId`, and ingest authenticates by integration token. So the constraint protects nothing and only causes conflicts between users.

## Two restore paths leave CanvasItem.archivedAt set, so a later normal delete is kept in Trash forever

medium · accepted · C-dd4adfb8fdb7

Migration 20261105220000_weekly_recap adds CanvasItem."archivedAt" as a free nullable column. The schema documents it as being set together with deletedAt when an item is archived, but nothing in the database enforces that. The trash retention sweep skips every row whose archivedAt is non-null. Only two paths clear archivedAt when they un-delete an item: the Trash restore route and the unarchive in services/archive.ts. Two other paths do not:

1. The version-restore SQL sets "deletedAt" = NULL and "deletedById" = NULL but never touches "archivedAt".
2. The sync projection does the same when a known item id is re-created (the comment calls this "an undone deletion").

In both cases an archived item comes back as a live item that still has archivedAt set. The ordinary delete paths (canvas-items DELETE, canvas-items commands, the projection delete, and the restore route's own delete-missing step) set deletedAt and deletedById but also leave archivedAt alone. The row then sits in the trash with a stale archivedAt, and the retention sweep never purges it.

## Canvas deletion bypasses upload quota release

medium · accepted · C-1a2faa10f89f

Deleting a canvas cascades away its UploadAsset records before the queued deletion handler executes. The handler deletes each storage object, but its asset update then matches zero rows and returns before releasing quota. Quota belonging to surviving users remains charged.

## Account deletion keeps the user's items on other owners' canvases but deletes the uploads those items display

medium · accepted · C-c5733dbe6a04

The code says it keeps content the user added to another owner's canvas by transferring `createdById` to that canvas's owner. In the same transaction, though, it queues deletion of every asset the user uploaded, including assets on those foreign canvases. `enqueueUploadDeletion` sets the status to DELETING, the asset GET returns 404 for any status other than ACTIVE, and `user.delete` then cascades the UploadAsset rows away. The items are kept, but the images they show through `/api/v1/uploads/{assetId}` are gone.

## Home-board accept and auto-file are not atomic: a crash, a transient error or a concurrent dismiss leaves an executed move marked DISMISSED with no changeSetId, so it cannot be undone

medium · accepted · C-50e7d2967581

The model keeps one HomeBoardSuggestion row per item, forever. Its status and changeSetId are the only Inbox record of a move, and the undo path depends on them. acceptHomeBoardSuggestion runs in separate steps: approve, claim, executeAskCommandSuggestion (the move and its ChangeSet), markSuggestionExecuted, and finally a conditional updateMany that only sets ACCEPTED/AUTO_FILED and changeSetId while the row is still OPEN. Nothing marks the row as in progress before the move runs. This causes three problems. (1) If the process dies or the DB call fails after the move but before the last updateMany, the row stays OPEN with no changeSetId. The recovery path that the comment says 'completes an auto-file that a crash interrupted' calls acceptHomeBoardSuggestion again. That call sees item.canvasId !== row.sourceCanvasId, runs closeStale, and marks the row DISMISSED and the executed suggestion REJECTED. (2) A concurrent dismiss (a user click while the auto-file job or another accept is running) can switch the row to DISMISSED mid-flight. The accept's last updateMany then matches 0 rows, but the move has already happened and success is still returned. (3) Any error thrown by executeAskCommandSuggestion, transient ones included, calls closeStale, so a temporary failure dismisses the suggestion for good and the item is never proposed again.

## db.ts SIGTERM/SIGINT handlers disconnect Prisma and exit(0) at once, bypassing server.ts graceful drain

high · accepted · C-e24e437c5ef6

In production, src/lib/db.ts registers its own process.on("SIGTERM") and process.on("SIGINT") listeners. Each one awaits prisma.$disconnect() and then calls process.exit(0). server.ts also registers process.once("SIGTERM"/"SIGINT") listeners. Those call server.close() and wait up to 20s for in-flight requests to finish before exiting. Node runs every listener, so the db.ts listener disconnects and ends the database pool while requests are still running, then kills the process. The drain in server.ts never gets to finish.

## HTTP listener ignores the configured hostname

medium · accepted · C-f1a1d2c6349b

The hostname is passed to Next.js but omitted from the actual Node HTTP listener. Calling server.listen with only the port binds an unspecified address, so configuring localhost or a private interface does not restrict network exposure.

## TRUSTED_PROXY_CIDRS is never checked at startup, and a bad value makes every HTTP request fail with 500

medium · accepted · C-17547e5c0982

env.ts accepts TRUSTED_PROXY_CIDRS as any string. The CIDR list is parsed again on every call to deriveClientIp, and a bad entry throws. server.ts calls deriveClientIp inside the per-request try block for every HTTP request, so a typo in the value turns every request into a 500. Health and readiness probes fail too. The websocket upgrade paths call the same function, so collaboration upgrades also fail. The process starts and looks healthy until traffic arrives, and the only diagnostic is a per-request error log. A fresh BlockList is also built from the string on every request.

## HTTPS sync upstreams are contacted over plaintext TCP

medium · accepted · C-e3da098db269

<quotes>
  const upstream = connect(
    Number(target.port || (target.protocol === "https:" ? 443 : 80)),
    target.hostname,
  );
</quotes>
An https target only changes the default port. net.connect does not establish TLS, and the proxy writes the upgrade request and its original headers over that plaintext connection.

## Database seed script lacks production guard and fails idempotency when NODE_ENV is unset

high · accepted · C-8a6b54dfe4c0

In prisma/seed.ts, the existing data cleanup is guarded solely by `if (process.env.NODE_ENV === "development")`, but there is no check preventing the rest of the script from executing in production or staging environments. If `prisma db seed` is triggered in production, cleanup is skipped but the script proceeds to provision test accounts (alice@example.com, bob@example.com) with hardcoded credentials (TestPassword123!). In addition, in standard local development where CLI processes run with `process.env.NODE_ENV` undefined, the cleanup block is bypassed, causing re-runs of the seed script to fail on the unique email constraint.

## Development seed disables first-run setup in production

medium · accepted · C-f5a4644a4fb5

The development environment check guards only deletion; fixture creation runs in production too. The configured seed uses DATABASE_URL, so running it against a fresh production database creates users and disables bootstrap. These users default to unverified, while production authentication requires verification. The command therefore closes initial setup without provisioning a usable production account.

## The 60s in-flight lease is measured from createdAt and never renewed, so a slow request can be run twice

medium · accepted · C-b50793ce923a

The lease check on line 254 compares the time since `existing.createdAt` with a fixed 60s. If the original handler is still running after 60s, a concurrent retry treats the lease as expired, deletes the in-flight row, creates a new one and runs the handler again. When the first request finishes, it updates the new row by unique scope and overwrites that row's journal. The schema has a `lockedAt` column meant for this, but the code never reads or renews it.

## Canvas deletion permanently retains upload quota charges

medium · accepted · C-aca702c0a857

Canvas deletion enqueues object cleanup and immediately cascades away the UploadAsset rows. The cleanup worker deletes the object but cannot transition the missing asset from DELETING to DELETED, so it returns before decrementing UploadQuota. The usage endpoint continues reporting those charges, and future reservations enforce them.

## If an upload.delete job dies, the asset stays DELETING for good: the object and quota are never released, and deleting again does nothing

medium · accepted · C-be22fcf3a35a

The delete handler first removes the storage object. Only then does it move the asset from DELETING to DELETED and decrement the quota. It throws a plain Error if the quota row does not match, and a failed S3 call also throws. The outbox treats both as retryable. After maxAttempts (default 8, with backoff of about 1+2+4+…+64 s, roughly 2 minutes in total) the job is marked DEAD. Recovery is not possible from the app. enqueueUploadDeletion uses a fixed dedupeKey, and enqueueOutboxJob runs an upsert whose `update: {}` changes nothing. So deleting the upload again (or deleting the canvas or account again) sets DELETING but leaves the job DEAD. requestUploadNote does re-arm DEAD jobs for the same reason. The delete path has no equivalent, and I found no other code in src/ that sweeps DELETING assets.

## Deleting an account cascades away collaborators' upload rows, leaving their files in storage and their quota permanently used

medium · accepted · C-e75303230082

Account deletion only queues storage deletion for assets whose `userId` is the deleted user. It then deletes all of that user's canvases. `UploadAsset.canvas` uses `onDelete: Cascade`, so the database silently removes the rows for assets that collaborators (EDIT shares) uploaded to those canvases. No `upload.delete` outbox job is created for them, so the objects stay in S3 or on disk and nothing reduces the uploaders' `UploadQuota` counters. The canvas DELETE route avoids this by finding assets by `canvasId` and queueing each one before deleting the canvas; the account route does not follow that pattern.

## Account deletion skips uploads contributed by collaborators

medium · accepted · C-efc95eaeb56e

Editors can upload to another user's canvas, and reservations record the uploader as userId. Account deletion queues only the departing user's uploads, then deletes their canvases. Collaborators' UploadAsset rows consequently cascade away without an object-deletion job, losing the storage references needed for cleanup.

## Link enrichment loads up to 1000 JSON embedding vectors inside a 5-second transaction that holds the canvas row lock

medium · accepted · C-dbefa20d5cd3

The enrichment write runs in `prisma.$transaction(async (tx) => ...)` and passes no options, so Prisma's default interactive-transaction timeout of about 5s applies. Its first step is `lockCanvasForMutation`, which runs `SELECT ... FROM "Canvas" ... FOR UPDATE`. While holding that lock it calls `findSimilarLinks(tx, ...)`. That query reads up to `MAX_COMPARED_EMBEDDINGS = 1000` `ItemEmbedding.vector` values, each stored as `Json`, and the cosine comparison runs in JS. With 1536-dimension vectors that is tens of MB of JSON to fetch, deserialize and score while the canvas stays locked. Every other canvas mutation path takes the same row lock. Other heavy transactions in the repo pass explicit `{ maxWait: 5_000, timeout: 15_000 }` or 30s options; this one does not.

## Global event sequences are incorrectly treated as contiguous per-canvas cursors

medium · accepted · C-3f559b498697

The cursor is allocated globally, but replay and WebSocket consumption are canvas-specific. Events on other canvases therefore create legitimate numerical gaps. The hook mistakes these gaps for lost messages and defers otherwise valid events until an unnecessary HTTP replay completes.

## Action history exposes item snapshots after canvas access is revoked

high · accepted · C-330a8ed7456f

The timeline authorizes by profile identity, not its current allowedCanvasIds or READ capability. Its HTTP caller also performs no capability check. Consequently, an active integration can retrieve complete historical item snapshots after the owner removes that canvas from its scope or disables its READ rung.

## Proposal queue and audited writes come from the user's 100 most recent records across all canvases, then are filtered in the browser

medium · accepted · C-ad4a02533bd2

The organizer calls `useAgentTimeline(100)`. On the server, `listScopedActionTimeline` filters only by `userId`, orders by creation or start time, and returns at most `limit` rows, capped at `maxLimit: 100`. The organizer then filters suggestions and change sets to the current canvas in the browser. Once the user has more than 100 suggestions or change sets across all canvases, older records for this canvas are never fetched. They disappear from the proposal queue, the audited-writes list, and the 'Open suggestions' and 'Audited change sets' counts. The UI does not say the list is incomplete.

## An agent token can execute, or permanently strand, another agent's approved suggestion

medium · accepted · C-4163cb1593a6

When the caller is an integration or OAuth token, `resolveRequiredAgentProfile` returns the token's own profile and the suggestion is then loaded by `id` and `userId` only. Nothing requires `suggestion.agentProfileId === agentProfile.id`; only the ask-command branch checks it. Agent A can therefore execute agent B's owner-approved suggestion under A's identity. The resulting writes and change sets are attributed to A, against the owner's intent of approving B. Because the claim happens before A's scope and rung checks, A can also call execute on B's suggestions purely to make them fail and stay in EXECUTING. External-webhook suggestions fail A's integration-account lookup. Canvas suggestions fail A's canvas scope.

## actions.propose_external stores arbitrary payloads and summaries without the REST schema, and execution dispatches on payload.kind alone

medium · accepted · C-7b32cb45dc0b

The REST propose-external action checks the payload against externalActionPayloadSchema: kind must be 'external-webhook', a cuid integration account ID, a method enum and header size limits. It also requires a summary of 1 to 255 characters. The MCP tool accepts any object as payload and String(args.summary || "") as the summary, which can be empty or unbounded, and stores both as an EXTERNAL_ACTION suggestion. executeApprovedSuggestion never reads suggestion.kind and dispatches only on the payload's own kind field. An EXTERNAL_ACTION suggestion can therefore carry an internal payload such as canvas-item-batch-create with executionMode 'bulk'. It is shown to the owner as an external action, and when executed it only needs the PROPOSE rung.

## Generic suggestion execution skips home-board bookkeeping

medium · accepted · C-becc29715865

Home-board proposals use the generic Ask suggestion kind and are exposed through the general suggestion timeline. Executing one through the Agent Control Center follows the generic Ask branch, which moves the item and marks only Suggestion as executed. It never performs home-board finalization, leaving HomeBoardSuggestion OPEN with no changeSetId. That bypasses the Inbox's recently-filed tracking and makes its dedicated Undo reject the completed move.

## The inbound integration bearer token doubles as the outbound webhook HMAC secret and is stored with reversible encryption

medium · accepted · C-721a908fdb5c

For WEBHOOK integrations the route uses the plaintext API bearer token as `outboundSigningSecret` and stores it encrypted (AES-GCM, decryptable) in `replayCursor`, next to its argon2 hash. Delivery decrypts it and uses it as the HMAC key. Anyone who verifies these webhook signatures must hold the signing secret, and that secret is a working API credential for the agent. The decryptable copy also undoes the protection the argon2 hash is meant to give at rest.

## CSP report size limit is enforced after buffering the entire body

medium · accepted · C-79dd70e4273b

The 16 KiB limit is checked only after request.text() has consumed and buffered the entire unauthenticated request. TextEncoder then allocates another representation before rejection. Consequently this check does not bound request-consumption memory; oversized or concurrent requests can exhaust the application where upstream limits are insufficient.

## memoria_backup_age_seconds reports 0 (fresh) when no backup was ever recorded or Redis is unavailable

medium · accepted · C-ced5cdd2d001

readBackupSuccessTimestamp returns 0 when Redis is not configured, when the key is missing and when Redis errors. The metrics route then sets backupAge to 0 instead of a large or sentinel value. So the gauge that describes backup staleness reports a perfectly fresh backup in exactly the cases where backup health is unknown or backups have never succeeded.

## Newer agent credentials can hide the saved built-in AI credential

medium · accepted · C-cadbde468b34

The database limits results before the built-in capability tag is checked. Agent credentials share this table, are created in an eligible status, and their creation endpoint has no corresponding 25-row cap. After 25 newer eligible agent credentials exist, a valid saved built-in credential is excluded and findAiProvider falls back to server environment credentials or reports no provider.

## When the user's saved credential cannot be used, built-in AI silently sends their content to the operator's env-key provider

medium · accepted · C-4123f7f277db

findAiProvider uses the env provider (OPENAI_API_KEY or ANTHROPIC_API_KEY) whenever the user's builtin credential resolves to null. That covers three cases: the credential is in ERROR, it cannot be decrypted after a key rotation, or it is OPENAI_COMPAT with no base URL. These are users who chose a provider on purpose, often a local or self-hosted model for privacy, and their canvas content now goes to a different third-party provider without any check or notice. The Settings route lists the builtin credential whatever its status (`where: { userId }`), while resolution only looks at ACTIVE and UNVERIFIED rows. The UI can show the user's credential while requests actually use the server key.

## Any HTTP 403 marks the user's saved AI key as rejected, which silently moves the user to the server's env provider

medium · accepted · C-efde97b75172

`authFailed` treats every 403 as a bad key. Providers also return 403 for other reasons: model or permission denied (Anthropic permission_error), unsupported region (OpenAI), and flagged input (OpenRouter moderation). On any 403, `generateText` and `providerFailure` set the credential to ERROR. `findUserAiCredential` only selects ACTIVE or UNVERIFIED credentials, so `findAiProvider` then falls through to `fromEnvironment()`. The user's later requests go to the operator's OPENAI_API_KEY or ANTHROPIC_API_KEY without telling them, or fail with 'not configured'. Changing only the model in Settings does not reset the status; the user has to re-enter the key.

## A delayed rejection can disable a newly replaced AI key

medium · accepted · C-21d49b05bbb7

An in-flight request retains only the credential ID for rejection handling. Settings can replace the secret in that same row before the old request returns. A delayed 401 or 403 then marks the replacement ERROR without checking which secret or credential revision failed. Provider resolution subsequently excludes the newly saved credential.

## The saved AI key can be sent to any public host by changing only the base URL

medium · accepted · C-1fcd6f58aba7

The route says the provider key is write-only: no response ever returns it. But when PUT has no apiKey, it still saves a new baseUrl on the existing credential, and the only check is that the provider is unchanged. Later AI calls decrypt the saved key and send it to `row.baseUrl`. assertSafeAiBaseUrl blocks only private or SSRF targets, so any public host passes. Anyone who can make one authenticated PUT can point the base URL at a server they control. The next AI call then sends them the user's plaintext provider key, which makes the write-only promise meaningless.

## AI base-URL SSRF check can be bypassed by DNS rebinding because the request is not pinned to the IP that was checked

high · accepted · C-760eea0402f5

Any signed-in user can save a custom AI base URL (PUT /api/v1/ai/provider). Before each call, `assertUsableBaseUrl` runs `assertSafeAiBaseUrl`, which calls `validateUrlForSsrfWithDns`. That function looks the hostname up and returns a `pinnedIp`, but `assertSafeAiBaseUrl` throws the pinned IP away. `postBody` then calls the global `fetch(url)` with the hostname, and fetch looks the name up again. A hostname that answers with a public IP the first time and an internal IP the second time (TTL 0) passes the check and then connects to the internal address. The codebase already has `pinnedHttpRequest` for exactly this problem, and the comment in provider-resolution says AI base URLs get 'the same SSRF rules as bookmark unfurling'. But unlike unfurling, the AI path does not pin the connection. `validateUrlForSsrf` also allows plain `http:`, so TLS hostname checks do not block the rebound connection.

## Custom AI providers can return unbounded response bodies

high · accepted · C-25e9ee126be7

The adapter's shared transport buffers and parses the entire provider response without a byte limit. Users can configure their own public provider endpoint, so this response is attacker-controlled. A requested output-token limit and a 60-second timeout do not bound the bytes returned during that interval.

## Saving built-in AI settings changes a credential an agent profile still uses

medium · accepted · C-ac503849e22a

When a new built-in key has the same fingerprint as an agent-profile credential, PUT reuses that row. It overwrites the row's provider, baseUrl, defaultModel and status and tags it as built-in. After that the row is the `existing` built-in credential. A later PUT with a different key and no fingerprint match sets target = existing, so the agent profile's credential gets the new secret and provider in place. The no-apiKey path at lines 143-146 likewise rewrites model and baseUrl on that shared row. DELETE does check `defaultModelCredentialId` before deleting, which shows such sharing is expected, but PUT never checks it.

## API key 'Expires on' date is converted to UTC midnight, so keys expire early or are rejected, and the server error is hidden

medium · accepted · C-9437e8f712fc

The `<input type="date">` value ("YYYY-MM-DD") is passed to `new Date(...)`, which reads a date-only string as UTC midnight. So the key expires at 00:00 UTC at the start of the chosen day, not at the end of that day in the user's time zone. West of UTC, the list then shows the expiry as the previous day, because `toLocaleDateString` renders that UTC instant in local time. The server rejects any `expiresAt <= now`, so choosing today always fails. For a US user in the evening, choosing tomorrow also fails, because tomorrow 00:00 UTC has already passed. The catch block replaces the server's message ("expiresAt must be in the future") with a generic toast, and the input has no `min`.

## Any session can create a non-expiring API key without re-authentication, and password reset does not revoke API keys

medium · accepted · C-1d414042907c

POST /api/v1/api-keys needs only a valid session cookie. It does not re-check the password or require a recent sign-in, and `expiresAt` can be null, which gives a key that never expires. Password reset, the usual recovery step after a compromise, deletes server-side sessions but does nothing to ApiKey rows. A repository search found no `apiKey.updateMany` anywhere, so reset and change-password never revoke keys in bulk. authenticateApiKey accepts any key with revokedAt null that has not expired.

## Account emails put the user-chosen name into HTML without escaping, so anyone who signs up can inject HTML into a genuine Memoria email

medium · accepted · C-29c393e543d9

passwordResetTemplate, emailVerificationTemplate and welcomeEmailTemplate place `userName` straight into the HTML body. The same file defines escapeHtml and uses it in the newer share and recap templates, but not in these three. `userName` is the name typed at sign-up. The register route only checks that it is 1 to 100 characters. The verification outbox handler passes `user.name` through unchanged. Sign-up accepts any email address, so an attacker can register the victim's address with a name such as `</p><a href="https://evil.example">Verify Email</a><p hidden>`. The verification email then reaches the victim from Memoria's real sender, signed by its domain, with the attacker's link in it. The password-reset email has the same flaw when the account name is attacker-controlled.

## Forgot-password sends the reset email inside the request only for existing accounts, so response time reveals which emails have accounts

medium · accepted · C-0a93e33d3345

The route always returns the same message so that attackers cannot tell which emails have accounts. But only the existing-account branch writes a token row and then awaits sendPasswordResetEmail, a full SMTP transaction or HTTPS call to the email provider, before responding. sendPasswordResetEmail accepts no deliveryId or signal, so it cannot go through the outbox the way verification emails do. Registration guards against the same timing leak with a response-time floor; this route has no floor.

## Editing a bookmark URL preserves unrelated metadata

medium · accepted · C-07949581527e

Metadata is initialized from the original bookmark but is not invalidated when its URL changes. Saving without explicitly re-fetching combines the new URL with the old metadata and even marks it freshly unfurled. The HTTP handler validates and replaces the supplied content without reconciling that association.

## Enrichment applies stale page results after the bookmark URL changes

medium · accepted · C-ed3be2331a2a

The job fetches metadata and generates suggestions for its initial URL, then applies those results to freshly loaded content without checking that its URL still matches. The optimistic version check uses the freshly loaded version, so it does not detect a URL edit made during the external requests. The PATCH endpoint permits replacing bookmark content.

## The bookmark refresh writes remote page metadata into item content without the canonical bookmark content schema

medium · accepted · C-1498c7647e07

Every other content writer (PATCH route, commands, clip batch, link enrichment, sync validation) runs content through `parseCanvasItemContent`. That function applies the bookmark schema, which is documented to sanitize URLs against javascript:/data: URIs, and enforces a byte limit. The refresh handler skips it and writes `{...next, history}` straight to the database. The `image` value comes from the remote page's og:image, twitter:image or first <img>. It is only resolved with `new URL()` and trimmed, so any scheme (javascript:, data:, file:) and any host, including internal addresses, is kept. Title and description come from the same page and are written without schema checks.

## Command creation and hydration bypass the disabled-poll policy

medium · accepted · C-7428e0b2ca99

Ordinary creation checks poll availability, but command creation accepts the shared POLL-capable schema and persists items without that check. The ids hydration branch also returns matching items without excluding POLL. Consequently, disabling polls does not prevent their creation and retrieval through these alternate routes.

## Thumbnail objects stay in private storage after a canvas or account is deleted

medium · accepted · C-4ebcc6ccdc02

The thumbnail store handler writes rendered canvas images to object storage under `thumbnails/<canvasId>/<revision>.<ext>`. Only two places ever enqueue `thumbnail.delete`: the thumbnail DELETE route and the handler itself when it replaces an old key. Deleting a canvas (`canvases/[canvasId]` DELETE) and deleting an account (`users/account` DELETE) both enqueue deletion for upload assets (and, for accounts, exports). Neither reads `Canvas.thumbnailKey` or enqueues a thumbnail deletion before removing the canvas row. A repo-wide search for `thumbnailKey` and `thumbnails/` found no other cleanup path. Once the row is gone, nothing references the object, so nothing can ever remove it.

## Owners save the viewport with a canvas PATCH after every pan or zoom, and each save logs a 'updated canvas' activity

medium · accepted · C-99043406b0cd

The viewport effect in useCanvasData runs whenever zoom or position changes. About 750 ms after the gesture settles, it calls updateCanvas({ defaultViewport }) if the user owns the canvas. That sends PATCH /api/v1/canvases/:id. The PATCH handler does not treat a viewport-only change differently: it updates the canvas row, clears the Redis canvas cache and writes a CANVAS_UPDATED Activity row on every call. The dashboard feed shows each row as "updated canvas X".

The save also runs just from opening a canvas. The init effect (lines 187-196) moves zoom and position from their defaults to the stored viewport, which triggers the persist effect. Any canvas whose saved viewport is not the default therefore sends a PATCH with unchanged values and gets a fake 'updated' activity on every open.

## Public share page shows at most 100 items because cursor pages from the share API always return hasMore=false

high · accepted · C-dbc16376412d

The share page follows `nextCursor` until `hasMore` is false. The first request has no cursor, so the server runs in offset mode, sets `hasMore = offset + items.length < total`, and `boundedItemsResponse` returns a `nextCursor`. Every later request carries `?cursor=`. In cursor mode the route sets both `offset` and `hasMore` to `undefined` in the metadata. `boundedItemsResponse` can only work out `hasMore` from a boolean `metadata.hasMore` or a numeric `metadata.offset`. With neither present, it falls through to `false` and sets `nextCursor = null`, unless the page was cut short by the byte budget. So the second page always ends the client loop. Items after the 100th (2 × the default limit of 50) are never fetched. The client never checks `allItems.length` against `total`.

## Concurrent acceptance can survive a successful invitation revocation

high · accepted · C-f30009446b23

Acceptance locks the invitation, but revocation reads its pending state without locking and subsequently updates it by ID without rechecking respondedAt. Under READ COMMITTED, revocation can read the pending row while acceptance holds its lock, wait for acceptance to commit, then overwrite its response with REVOKED. The accepted CanvasShare remains, yet revocation returns success.

## ShareDialog ignores pending invitations, so owners cannot see or revoke a sent invite

medium · accepted · C-7722a54dba74

The server's GET /api/v1/canvases/[canvasId]/share returns two lists. `shares` holds accepted collaborators only (`recipientId: { not: null }`). `invitations` holds pending, unexpired invitations. The dialog's `loadShares` reads only `data.shares` and throws `data.invitations` away. Every POST from the dialog now creates a pending `CanvasShareInvitation`, not a `CanvasShare`. So the `loadShares()` call after a successful share never shows the new invitee. The list at lines 424-447 shows only accepted shares, so the owner never gets a revoke button for a pending invitation. The DELETE /share/[shareId] route does support revoking a pending invitation by its id, but no UI path can reach it. Sharing the same address again only revokes the old invitation and creates a new one (share route lines 49-53), so it does not cancel the invite either.

## Revoked collaborators can still edit their comments

medium · accepted · C-2ca71358dfec

getCommentWithAccess treats authorship as sufficient even without current canvas access. PATCH then checks only authorship. Deleting the collaborator's share therefore does not prevent subsequent edits to their existing comments on the private canvas.

## Comment authors can still read and edit their comments after their share is revoked or downgraded

medium · accepted · C-99ad8075ac6c

Creating a comment requires an active COMMENT or EDIT share. getCommentWithAccess, though, lets the caller through when `isAuthor` is true, whatever their current share state. PATCH only checks `isAuthor`. A user whose share was removed, or cut to VIEW, can still change the comment text on the owner's canvas and read the comment along with its full item and canvas payload. The gate also never checks whether the item is in the trash (only comment.deletedAt is checked), so comments on trashed items stay readable and editable.

## Comments panel shows HTML-escaped server content as plain text, and every edit escapes it again

medium · accepted · C-6442b9108b8f

Both the create and update APIs pass comment text through `sanitizeComment`. That function parses the text as HTML with cheerio and stores `root.html()`, the serialized HTML, which escapes `&`, `<` and `>` in text nodes and keeps the allowed tags as markup. CommentsPanel renders `comment.content` as a React text node, so users see the raw serialization: "Tom & Jerry" shows as "Tom &amp; Jerry", and allowed tags appear literally. The edit flow puts that escaped string into the TextField. Saving sends it through the sanitizer again, so the stored text gets more mangled with each edit (`&amp;` becomes `&amp;amp;`). The client and server disagree on whether content is plain text or HTML.

## Version restore confirm button has no in-flight guard, so a double click restores twice and can delete an extra saved version

medium · accepted · C-9884609176a5

`handleRestore` checks only `activeId` before it calls `restoreVersion`. It does not check the `restoring` flag it sets. The ConfirmDialog stays open with `pendingRestore` true until the request finishes. Its confirm button runs `void onConfirm()` and is never disabled. The `restoring` state disables only the outer "Restore This Version" button. A second click on "Restore" therefore sends a second POST to the restore route. On the server, each restore runs in its own locked transaction. Each one creates a new MANUAL "Restored …" version. When a canvas is at the 50-manual-version cap, each one also deletes the oldest manual versions.

## Deleting a canvas never queues deletion of its stored thumbnail, so private canvas renderings stay in storage

medium · accepted · C-12121cc46224

The canvas DELETE transaction queues `upload.delete` jobs for UploadAsset rows and then hard-deletes the canvas row. It never reads `thumbnailKey` and never queues a `thumbnail.delete` job. Thumbnails are written by the store handler to `thumbnails/{canvasId}/{revision}.{ext}` in the private upload store. The dedicated thumbnail DELETE route is the only other place, besides the replace path in the store handler, that queues `thumbnail.delete`. Once the canvas row is gone, no row references the object. A search of src/lib for `thumbnails/` found no sweep that would clean it up.

## Upload-note jobs can write after edit access is revoked

medium · accepted · C-80dcd7a23a13

The handler checks edit access before storage and potentially long-running AI calls. Its final transaction checks asset status and note deduplication, but never rechecks authorization. A share can be revoked while the model is answering, and the former editor's job will still insert a note afterward.

## Overlapping notification saves can undo earlier choices

medium · accepted · C-509ebd6fa3ce

All rows share one mutation observer, but only its latest type is disabled. Starting a save for type B re-enables type A while A's save remains pending. Another change to A then resends both flags from its stale cached preference, potentially overwriting the earlier change.

## Global search cannot display subsequent result pages

medium · accepted · C-2000f2f9e7f9

The API returns paginated results, but the dialog requests only the initial page, ignores pagination metadata, and provides no next-page control. Its displayed total includes matches that users cannot reach from the dialog.

## Global search ORs leading-wildcard ILIKE with FTS, so the GIN index cannot be used and four full scans run per request

medium · accepted · C-b30e51a4ac0b

Even when the `searchVector` GIN index exists, the filter is `searchVector @@ tsquery OR content->>'text' ILIKE '%term%' OR ...` across four JSON paths. A leading-wildcard ILIKE on an expression has no index, so PostgreSQL cannot build a bitmap OR from indexes and has to look at every candidate row. The access filter (`c.userId = X OR EXISTS(share)`) is also an OR across tables. The same predicate runs four times per request: count, type facets, tag facets and the main page, with OFFSET allowed up to 1,000,000.

## Canvas selection is kept when the workspace filter changes, so a bulk delete can permanently delete canvases that are no longer on screen

medium · accepted · C-ee6f7e5219a0

The workspace filter comes from the `?workspace=` search parameter. selectionMode and selectedCanvasIds are component state that nothing ties to workspaceId: no effect resets them and no `key` remounts the component. The dashboard page renders DashboardContent unkeyed inside Suspense. Moving from /dashboard?workspace=A to /dashboard, or to another workspace, therefore keeps the same component instance and its selection. Ids that were selected in the earlier view stay in selectedCanvasIds even when they are not in the new `canvases` list. handleBulkDelete deletes `Array.from(selectedCanvasIds)` without checking it against the visible list. The server DELETE is a hard `tx.canvas.delete`, and the dialog itself warns 'This action cannot be undone'.

## Not-found rendering accesses a client-only export from the server

high · accepted · C-224fd28be3ae

NotFound is a Server Component, but gradients comes from a client-only module. Reading gradients.hero crosses the React Server Component boundary through property access, which throws instead of producing the not-found UI.

## Register and reset-password send passwords of any length to zxcvbn, so one request can block the event loop

high · accepted · C-d6cc998e0deb

The register schema only sets a minimum password length, and so does the reset-password schema. Neither caps the length. validatePasswordStrength checks the minimum and then runs zxcvbn on the whole string. zxcvbn's matchers enumerate substrings, so their cost grows faster than linearly with input length. The zxcvbn authors advise truncating input to about 100 characters for this reason. change-password already caps new passwords at 128 characters with `.max(128)`, but these two endpoints do not. In open registration mode, prepareRegistrationAdmission returns immediately, so an unauthenticated caller reaches zxcvbn with any password size the request body allows. Reset-password reaches zxcvbn for anyone holding a valid reset token, and any account holder can get one for their own account.

## withAuthValidation reads the request body before runIdempotent clones it, so any request with X-Idempotency-Key gets a 500

medium · accepted · C-66c2dc12d24d

withAuthValidation calls `await req.json()` on line 137, which reads the request body to the end. On line 150 it hands the same request to runIdempotent. When the X-Idempotency-Key header is present, runIdempotent then calls `req.clone().arrayBuffer()` on line 212 to hash the body. Under the Fetch spec, and in Node's undici Request that NextRequest extends, `clone()` throws a TypeError once the body has been read. withApiHandler catches that TypeError and returns a generic 500. The other runIdempotent callers do it in the right order: canvases/route.ts, canvas-items/route.ts, commands/route.ts and upload/route.ts call runIdempotent first and read the body inside the callback. The upload route even has a comment saying the idempotency hash reads the whole body.

## Unfurl cache key lowercases the whole URL and drops repeated query params, so different URLs share metadata across users

medium · accepted · C-776855510a68

normalizeUrl lowercases the whole serialized URL, including the case-sensitive path and query. It also rebuilds the query with searchParams.set, so for repeated keys only the last value is kept. URLs that differ only in path/query case (short links, video IDs, document IDs), or only in repeated parameters, get the same Redis key. The unfurl route returns the cached metadata before any fetch, and the cache is shared by all users. The image-proxy cache in this same directory hashes the exact URL because paths and queries are case-sensitive.

## GIF bounds check ignores each frame's image-descriptor size, so a tiny logical screen can hide a huge frame

medium · accepted · C-050601f3c48d

parseGif takes width and height only from the Logical Screen Descriptor (bytes 6–9). It skips each Image Descriptor, whose left, top, width and height fields are each 16 bits wide (up to 65535×65535), without reading them. Common decoders, including the Mozilla/Chromium-derived GIF readers, enlarge the canvas to the first frame's size when it exceeds the logical screen. GIF87a files are treated the same way. A few-KB GIF that declares a 1×1 screen and a 65535×65535 frame therefore passes the MAX_IMAGE_EDGE and MAX_IMAGE_PIXELS checks, which defeats the module's stated purpose of rejecting decode bombs.

## Malware scan timeout stops before the response body is read

medium · accepted · C-bdc5252d948b

fetch resolves when response headers arrive. The finally block then cancels the abort timer before response.json consumes the body. A scanner that sends successful headers but stalls its body can therefore hold the upload indefinitely, bypassing UPLOAD_SCAN_TIMEOUT_MS.

## Account deletion runs as one large interactive transaction under Prisma's default 5 s timeout

medium · accepted · C-8476c824d23a

The whole deletion runs inside one `prisma.$transaction(async (tx) => ...)`. That includes two sequential queries per upload asset (up to 500 assets), one `update` per foreign item, and a `deleteMany` over every item on up to 200 canvases (up to 2,000 items each, with cascades). The PrismaClient is built without `transactionOptions` and the call passes no `timeout`, so Prisma's default interactive-transaction timeout of 5,000 ms applies. Large accounts will hit P2028 and roll back.

## Public shares stop after the first cursor continuation

medium · accepted · C-2121b3d47396

Cursor requests omit both offset and an explicit hasMore value. When that page fits the byte budget, boundedItemsResponse consequently reports hasMore=false regardless of remaining items. The client trusts that flag and stops. With the default 50-item page size, a public canvas containing 101 small items displays only 100.

## Public share pagination reports hasMore=false on every cursor page, so viewers get at most two pages of items

medium · accepted · C-db118fe616c3

When a page is not cut short by the byte budget, `boundedItemsResponse` only reports `hasMore` if the caller passes a boolean `hasMore`, or a numeric `total` together with a numeric `offset`. Otherwise it returns `false`. On a cursor request the public share route passes `hasMore: undefined` and `offset: undefined`, so every cursor page comes back with `hasMore: false` and `nextCursor: null`. The route also fetches exactly `query.limit` rows on cursor pages, not `limit + 1`, so it could not detect further rows anyway. The share page follows `hasMore`/`nextCursor`, so it stops after the first cursor page.

## Failed bookmark previews retry indefinitely

medium · accepted · C-24e4e343fa93

A failed request leaves metadata null and resets unfurling to false. Because unfurling is an effect dependency, completion immediately starts another request for the unchanged URL. The displayed error does not stop this cycle.

## Uploads abandoned in the image dialog are never deleted and keep counting against the user's quota

medium · accepted · C-5126fa6536e2

The dialog uploads the file and creates a stored UploadAsset as soon as a file is picked, before the user confirms. Cancel, Escape or backdrop close (`handleClose`) and "Change Image" just discard `uploadedImage` in client state. They never call the existing `DELETE /api/v1/uploads/{assetId}`. Server-side deletion only happens through that endpoint (OWNER only), canvas deletion or account deletion. My search of src/lib/uploads found no job that cleans up unreferenced assets.

## Password change ends every session, including the current one, but the settings UI shows success and keeps the user on a dead session

medium · accepted · C-f7a5094909dd

The change-password route deletes every Session row for the user, the caller's included, in the same transaction that sets the new hash. Sessions are looked up server-side on every request with no cookie cache, so the current browser session is revoked at once. The client handler only clears the form fields and shows 'Password changed'. It does not call signOutAndRedirect, does not clear the offline canvas cache (signOutAndRedirect does that), and does not send the user to login.

## Password change revokes the current session without a sign-in handoff

medium · accepted · C-1091202aa5a7

The endpoint deletes every session, including the browser's current session. Its successful client handler only clears the fields and displays success; it neither clears the browser's authenticated state nor navigates to sign-in.

## Item drag events bubble to the Stage's pan handlers, which set the viewport position to the dragged item's coordinates

high · accepted · C-940f1dbc8521

Item Groups in ImageItem, NoteItem and PollItem are draggable, and nothing stops their drag events from propagating. The Stage registers onDragMove and onDragEnd handlers no matter whether the stage itself can be dragged, and they call setPosition({ x: event.target.x(), y: event.target.y() }) without checking that event.target is the stage. Konva bubbles drag events, so each dragmove of an item reaches this handler with event.target set to the item Group. The stage translation is then set to the item's world coordinates. The pointer-driven drag position is computed against the moved stage, which creates a feedback loop. Elsewhere the codebase guards Stage mouse handlers with e.target === e.target.getStage(), but the drag handlers have no such guard.

## Bookmark resize mixes screen pointer coordinates with world item coordinates, so it breaks under any zoom or pan

medium · accepted · C-7b8087ea75e7

The Stage is scaled by `zoom` and offset by `position`. `stage.getPointerPosition()` returns coordinates relative to the container, not world coordinates. `localPosition` is in world/layer space. `handleResize` subtracts one from the other without converting. Elsewhere CanvasBoard converts with `(pointer - position) / zoom`, and use-drawing-interaction uses `getRelativePointerPosition()`.

## The type filter stays set when the query changes, so a new search can show "No results" when matches exist, and the user may have no way to clear it

medium · accepted · C-c791b53513d6

`typeFilter` is a separate piece of state. Nothing resets it when `debouncedQuery` changes. The chips that show and clear the filter come from `availableTypes`, which only lists the types in the current results, and they only render when `availableTypes.length > 1`. Say the user picks "Images" and then types a query whose results are all NOTE items. `results` filters to an empty array and the page says `No results for “…”`. With only one type left, no chips render, so the filter cannot be cleared. The "Load more results" button sits inside the `results.length > 0` branch, so later pages cannot be loaded either. If the new results do have more than one type, the chip for the old filter is missing because it is not in `availableTypes`. Only the "All" chip still works, and it looks unselected.

## Agent data failures are displayed as empty results

medium · accepted · C-db44c91484f6

<quotes>
                No suggestions are waiting for review.
</quotes>
Failed requests throw into React Query, but the component never checks query error states. On an initial failure, undefined data becomes empty arrays and produces affirmative empty-state messages after loading ends.

## Public canvas dimensions remain at their initial defaults until a resize

medium · accepted · C-58906b5f8c71

The mount-only sizing effect runs while the loading branch is displayed, before the canvas container exists. Its initial measurement therefore does nothing. Mounting the container after loading does not rerun the effect, leaving the Stage at 800×600 until a window resize occurs.

## Public share and embed views parse stored note HTML with innerHTML on a live-document element

medium · accepted · C-5e7c630b9b82

ReadonlyCanvasItem passes the stored note HTML (`item.content.text`) to `stripHtmlTags`. In the browser, `stripHtmlTags` creates a div with `document.createElement` and assigns the HTML to `innerHTML`. The div is never attached, but it belongs to the live document, so markup such as `<img src=... onerror=...>` is parsed for real: images are fetched and inline event handlers are queued. This read-only layer renders anonymous public share pages (`/share/[token]`) and third-party embeds (`/embed/[token]`), so content written by a canvas owner, editor or API/agent client runs through this sink in every viewer's browser. Server-side sanitization does not fully close the gap. `sanitizeAllowedHtml` replaces each disallowed element with `$(element).replaceWith($(element).text())`. Cheerio parses a string argument to `replaceWith` as HTML, so entity-encoded markup inside a disallowed tag (e.g. `<span>&lt;img src=x onerror=...&gt;</span>`) is decoded and inserted back as a live element. That new element is never visited, because `root.find("*")` was computed beforehand. Today the strict nonce CSP is the only barrier: `script-src` has no `'unsafe-inline'`, which blocks inline handlers.

## Chat omits the conversation displayed to the user

medium · accepted · C-b7704ecdc011

Although AIDialog accumulates and displays a conversation, each request contains only the latest message and canvas context. The server passes that single message to stateless provider requests. Previous user messages and assistant answers are never available for follow-up questions.

## Callback path reconstruction bypasses the same-origin redirect check

medium · accepted · C-d2495224c4bd

A callback such as https://memoria.example//attacker.example/phish passes the same-origin check. Reconstructing its pathname produces //attacker.example/phish, which router.push can interpret as a protocol-relative external URL. The validated origin is therefore lost before navigation.

## Camera acquisition can complete after AR closes

medium · accepted · C-dbbf52a74e35

Closing or unmounting stops only a stream already stored in streamRef. If getUserMedia is still pending, cleanup sees no stream. Its later resolution unconditionally installs a live stream after cleanup, with no remaining cleanup guaranteed to stop it.

## AR rerenders replace the transition and disconnect the camera view

medium · accepted · C-f35d4c6c9480

SlideTransition is defined inside ARCanvasLayer, so each state update supplies a new component type to MUI's transition slot. Replacing that type remounts the dialog subtree, including the video element. The stream is attached only when camera acquisition completes; unchanged effect dependencies do not attach it to the replacement video.

## ConfirmDialog keeps Confirm enabled while an async onConfirm runs and drops its rejections

medium · accepted · C-d5f4b38c7c7d

The dialog accepts an async `onConfirm` but calls it as `void onConfirm()`. It has no pending state: the Confirm button stays enabled and the dialog stays open until the caller closes it. A rejected promise is thrown away and becomes an unhandled rejection. The callers run destructive async work in onConfirm. CanvasBoard's version restore awaits `restoreVersion` with no try/catch. The autopilot layout awaits a raw `fetch` that rejects on network failure. VersionHistoryDialog tracks `restoring` itself but never passes it to ConfirmDialog, so its Confirm button stays clickable during the restore.

## When restoring a version or applying Autopilot fails, the error is swallowed and the user sees nothing

medium · accepted · C-da1fa6db53a8

The restore confirm handler awaits `restoreVersion` (a React Query `mutateAsync`) with no try/catch. `useRestoreVersion` has an `onSuccess` and no `onError`. The app's QueryClient sets no global mutation error handler either: providers.tsx only sets `retry: false` for mutations. If the restore request fails, the promise rejects. ConfirmDialog calls `void onConfirm()`, which discards the rejected promise, so it becomes an unhandled rejection. No toast appears, `pendingRestoreVersionId` is never cleared, and the dialog stays open with no explanation. Autopilot's HTTP fallback has the same problem. It shows a toast only when `!response.ok`. If `fetch` itself rejects (offline, DNS failure, connection reset), the error escapes the same way and the user gets no feedback.

## Failed export cancellation is reported as successful

medium · accepted · C-fd38cb80bcca

Cancellation aborts polling before the server confirms cancellation. The DELETE response is never checked, network failures are swallowed, and success is always announced. Aborting polling also clears the active export ID, removing the cancellation control even when the server job remains active.

## Grid overlay is drawn mirrored and off-screen after panning because the offset is converted to world space twice

medium · accepted · C-1ce894cd32c5

CanvasBoard already passes the visible world origin as offset, -position.x / zoom. GridOverlay then computes startX = floor(-offset.x / zoom / gridSize) * gridSize, which negates the value again and divides by zoom a second time. That gives +position.x / zoom². The grid is a child of the transformed Stage and is drawn in world space, so it covers a mirrored region rather than the visible one. At zoom 1, the visible region [L, L+W] and the drawn region [-L, -L+W] stop overlapping once the pan passes half the viewport width.

## Grid offset is transformed twice

medium · accepted · C-42aa6b47f4e3

The caller supplies an already inverted, zoom-adjusted viewport origin, but GridOverlay negates and divides that value by zoom again. Grid lines consequently start in the wrong world-space region rather than covering the visible canvas.

## Grid renders over a thousand Konva Line nodes per frame at low zoom because the grid step never adapts to zoom

medium · accepted · C-65d4a37e73fb

The comment says the grid size is adjusted for zoom, but adjustedGridSize is just gridSize, a fixed 20 world units. The line count grows as width/zoom/20 + height/zoom/20. With wheel zoom clamped to a minimum of 0.1, a 1920x1080 stage produces about 1,500 Line nodes, 2 screen pixels apart. Pan and zoom update React state on every dragmove or wheel event, so all of them are rebuilt on each frame, and their keys shift as startX changes.

## Quick capture discards edits made while saving

medium · accepted · C-1060d8d0ae92

The text field remains editable during the awaited save. Changes made after submission are not included in the submitted string, but successful completion clears the current draft and the caller closes the dialog. Those intervening edits are silently discarded.

## IME confirmation Enter submits quick capture

medium · accepted · C-d70bb0c7d9e4

The input treats every unshifted Enter as submission without checking whether an IME composition is active. Enter used to confirm a composition candidate can therefore save the current text and close quick capture instead of merely completing composition.

## Serendipity closes before item creation succeeds

medium · accepted · C-b88124bf3314

The supplied callback performs asynchronous item creation, but handleUsage ignores its promise and immediately closes the dialog. If creation fails, the rejection escapes this handler and the discovery results have already been dismissed, with no local error or retry state.

## Adding an AI note discards the result before creation succeeds

medium · accepted · C-5f95c14704e3

The parent callback starts mutateAsync without returning or awaiting its promise, and AIDialog immediately closes. CanvasDialogs then unmounts AIDialog and its generated result. If creation rejects, there is no retained output or retry path, and the promise is also left unhandled.

## Reopening the organizer can overwrite saved filters

medium · accepted · C-8f6c917cd594

<quotes>
    lastSavedFiltersRef.current = nextState;
</quotes>
When the component mounts with cached, nondefault view data, hydration schedules state updates and immediately sets the ref to true. The save effect runs in that same commit with the initial default filters and submits them. The subsequent hydrated render submits the saved filters again. These concurrent writes can complete out of order, leaving defaults persisted despite no user change.

## Organizer lens checks source items and suggestions against only the items loaded for the current viewport

medium · accepted · C-309bd2820487

CanvasBoard passes `allItems` to CanvasOrganizerView. `allItems` holds full items only for the current, padded viewport window, since it comes from `useCanvasItems(canvasId, undefined, viewport)`. CanvasBoard itself says so: "N detailed items in this viewport; all M remain indexed". The organizer builds `itemsById` from this partial list and uses it in two places. First, each entity's `itemLinks` are resolved through it, so links to items outside the viewport are dropped. If none are in the viewport, the card says "This entity no longer has a readable source item on the canvas." Second, `getSuggestionCanvasId` uses it to find the canvas of suggestions whose payload has only an `itemId`. When that item is not in the viewport, the function returns null and the suggestion is filtered out of the proposal queue.

## JSON backups and Markdown exports silently omit off-screen items

medium · accepted · C-95a50fda187a

The array named allItems is a viewport-filtered, bounded working set, including when rendered from the collaborative document. That array passes unchanged to both export helpers. Neither helper retrieves the remaining canvas records, so the downloaded files silently contain only the current working set rather than the full canvas.

## PDF exports clip tall canvas snapshots

medium · accepted · C-c28057a25d05

The snapshot is fitted only to the width of a landscape PDF page. Its calculated height is not bounded by page height, and no additional pages are created. Tall viewport snapshots therefore extend below the page and lose their lower content.

## Late sort responses can overwrite a reopened dialog's current proposal

medium · accepted · C-a770a4837cd6

Closing resets local state but neither invalidates nor cancels the outstanding organizer request. CanvasBoard keeps this component mounted while closed. Reopening starts another request, and both requests' callbacks can still update proposal, instruction and sorting state. An older response can therefore replace the newer preview or clear loading while the newer request remains pending.

## Microphone startup can outlive its UI or create concurrent recordings

medium · accepted · C-5567dda0c0cc

Microphone acquisition has neither a pending-start guard nor a lifecycle check after awaiting permission/device access. If the component unmounts while acquisition is pending, cleanup finds no recorder. The continuation then resets cancellation and starts recording after unmount, without a Stop control or the mounted effect that enforces the recording timeout. Repeated clicks during acquisition can also create multiple recorders while recorderRef retains only the last one.

## Resize-handle drag events bubble into the item Group's move handlers, corrupting position and issuing a second geometry commit

high · accepted · C-5c04dc19ab23

Each resize handle is a draggable Konva Circle nested inside the item's Group. The Group also has onDragMove={handleDragMove} and onDragEnd={handleDragEnd}. Konva fires dragmove and dragend with bubbling turned on, and the Circle handlers never set cancelBubble. So while a handle is dragged, handleResize runs first, then the event bubbles to the Group's handleDragMove. There e.target is the Circle, and setLocalPosition({x: node.x(), y: node.y()}) stores the handle's group-local coordinates, such as (width, height), as the item's world position. That overwrites the position handleResize just computed. On release, handleResizeEnd commits size plus the corrupted position. The bubbled dragend then reaches handleDragEnd, which commits a second, position-only geometry of { positionX: circle.x(), positionY: circle.y() }. That breaks the 'one gesture, one durable write' contract and saves a wrong position.

## Note/Image resize mixes screen-space pointer coordinates with world-space item geometry

high · accepted · C-a7ff2369314b

handleResize reads stage.getPointerPosition(). That value is relative to the stage container and ignores the stage transform. It is then subtracted from localPosition, which is in world coordinates. The Stage is transformed with scaleX={zoom} and x={position.x}, so after any pan or zoom the computed width and height are wrong: they collapse to MIN_WIDTH/MIN_HEIGHT or jump to large values. The drawing hook in the same codebase correctly uses stage.getRelativePointerPosition().

## CursorChat never focuses its input, so typed text runs canvas shortcuts and Backspace can delete the selected items

medium · accepted · C-2182e20af6c4

`inputRef` is passed as the `ref` prop of MUI `InputBase`. That ref points to InputBase's root `<div>`, not to the `<input>`, which needs the `inputRef` prop. The mount effect then calls `.focus()` on a div that has no tabIndex, and that call does nothing. The chat opens when the user presses "/" (use-canvas-keyboard), but the input never gets focus. Keystrokes stay on the body. `shouldIgnoreGlobalShortcut` checks only for editable targets or open dialogs, and the CursorChat Box is neither, so the global canvas shortcut handler gets every key. Typing "e" opens the reaction picker, arrow keys move the selected items, and Backspace or Delete calls `onDelete`. CanvasBoard deletes every selected item with no confirmation.

## AI chat sends the full, unlimited note text as context, so the server's 8,000-character limit rejects every message on larger canvases

medium · accepted · C-a3160193c7ca

`handleChatSend` sends `getContext()` as `context`. On the canvas page that function is CanvasBoard's `getAIContext`, which joins the text of every note on the canvas with no length cap. The server's `chatSchema` limits `context` to 8,000 characters, and `withAuthValidation` turns a Zod failure into an error response. The client treats any non-OK response as 'Sorry, I encountered an error.', so once a canvas has about 8 KB of note text, every chat message fails and the user is not told why.

## Saved activeTool survives a switch to a read-only canvas and starts item creation for users who cannot edit

medium · accepted · C-524f05df240a

The zustand store writes `activeTool` to localStorage under one global key that is shared by every canvas. When a user leaves the store in "draw", "shape" or "arrow", `useCanvasInteraction` sends every stage mouse-down to the drawing hook. Nothing checks `capabilities.canCreateItems` along the way. On mouse-up, `useDrawingInteraction` calls `createItem`. CanvasBoard shows `MainToolbar`, the only place that calls `setActiveTool`, only when `canEdit` is true. A VIEW or COMMENT user who arrives with a saved drawing tool therefore cannot switch back to select. The keyboard hints shown in the toolbar (V/H/P…) are not wired to anything. This breaks the IMP-008 contract that capability flags decide which optimistic mutations may be created locally.

## Read-only users with a saved draw/shape/arrow tool cannot box-select and keep sending rejected creates

medium · accepted · C-ba3a9f84395c

useCanvasInteraction sends stage mouse events to the drawing hook based only on activeTool. It never checks edit permission (canEdit is not even one of its props). activeTool is saved to localStorage by the store's persist config. MainToolbar is hidden when the user cannot edit. So a user who last used draw/shape/arrow on their own canvas and then opens a shared view-only or comment-only canvas: (1) cannot box-select, because mouse down goes to drawing; (2) has no toolbar to switch tools; (3) creates items on every stroke. These show up optimistically and are then rejected by the server's EDIT check and rolled back, with no message.

## No live preview of the pen stroke, shape or arrow while drawing

medium · accepted · C-e766a8cd04b2

useDrawingInteraction updates currentPath on every mouse move and currentCreation during shape/arrow drags. useCanvasInteraction passes both values back, but CanvasBoard, its only caller, takes only isDrawing. A search of src finds no other reader of currentPath or currentCreation. Nothing is drawn until mouse up, so the user draws blind.

## The click following a marquee drag clears the selection

medium · accepted · C-a2b017319381

<quotes>
      setSelectedItemId(null);
      setSelectedItemIds(new Set());
</quotes>
Mouseup populates the marquee selection, but the subsequent click on the empty stage unconditionally clears it. Both handlers are attached to the stage, and the selection rectangle does not intercept events. Unlike an actual Konva drag, this selection gesture does not suppress the click.

## BookmarkItem's memo comparator ignores capabilities and callback props, so bookmarks keep stale permissions and handlers after an access change

medium · accepted · C-471564b90bac

The custom comparator re-renders only when item.id, isSelected, updatedAt or version change. It never compares `capabilities` or the callbacks (`onActivate`, `onSelect`, `onCommitGeometry`, `onContextMenu`), and CanvasItemLayer builds fresh callbacks on every render. Capabilities do change during a session. They start from a fallback (`VIEW`, or `EDIT` offline) until the canvas detail loads, and they are re-fetched when the sync server reports an access change. A memoized bookmark keeps its old `draggable` flag, its old resize-handle visibility, and an `onActivate` closure that checks the old `capabilities.canEditItems`. After an upgrade, bookmarks cannot be moved, resized or opened by double-click. After a downgrade, bookmarks can still be dragged. `useItemGeometry` then quietly rejects the commit (`return false`), but `localPosition` keeps showing the moved item, which was never saved.

## Time Machine preview items are live, editable items: dragging a historical item moves the real one

medium · accepted · C-c83541be83f2

When the Time Machine is on, the board draws `hydrateSnapshotItems(...)`. These snapshot items keep the live item IDs. Canvas capabilities come only from the access level, with nothing tied to the Time Machine. Item adapters such as TextItem stay draggable, and geometry commits check only `canMoveItems`. The intended non-destructive path is the explicit "Restore This Version" button with confirmation. Instead, an editor can drag, edit or delete items while previewing a historical version, and the change is written to the current live item with that ID.

## One item's save can hide another item's unsaved failure

medium · accepted · C-f9e0dec8b5bb

Each item has a separate queue, but every queue overwrites the same status and error. If item A fails and retains its pending delta, a successful save of item B changes the controller to saved and clears A's error. The header then stops displaying the geometry failure even though A remains unsaved. The same last-callback-wins behavior can hide an outstanding save.

## Arrow-key nudges skip the serialized geometry write path and can cause version conflicts

medium · accepted · C-3229e8a0bcc9

use-item-geometry.ts says it is the single geometry write path: every move goes through a per-item SerializedDeltaQueue that tracks the item version. The keyboard hook does not use it. It calls the raw updateItem mutation directly with `version: item.version`. On the HTTP route, which is used when no document session accepts writes, two things go wrong. (1) Key repeat sends several PATCHes with the same version before the first one returns, because the optimistic merge keeps the old version, so later presses hit 409 conflicts and roll back. (2) A nudge moves the server version forward behind the back of an existing geometry queue. That queue keeps its own stale version and only updates it from its own writes, so the next drag of the item conflicts.

## Autopilot lays out only the items loaded for the current viewport, placing them on a grid from the origin and over other items

medium · accepted · C-3eadd2bceb1a

`calculateAutopilotLayout(allItems)` receives `allItems` from useCanvasData. That list only holds the items whose full data was loaded for the padded viewport window: it calls `useCanvasItems(canvasId, undefined, viewport)`, and in document mode it uses `overlayDocumentItems({... window: viewport ...})`. The board even shows a status line saying only part of the canvas is loaded. The layout code sorts that subset and gives each item an absolute grid slot starting at (0,0): `col * SPACING`, `row * 250`. It knows nothing about the items outside the viewport, which stay where they are. Items sitting near the origin can therefore end up covered by the new grid. The confirm text says Autopilot will 'reorganize N items', which suggests the whole canvas is being organized.

## Invalidations keyed on canvasItemKeys.list(canvasId) miss the board's viewport query, so the snapshot-recovery, version-restore and create refreshes do nothing for the board

high · accepted · C-c83989f56aaa

`canvasItemKeys.list(canvasId)` builds the key `["canvas-items","list",{ canvasId, type: undefined, viewport: undefined }]`, and the object keeps `type` and `viewport` as own keys. The board's only item query is `useCanvasItems(canvasId, undefined, viewport)`, and `viewport` there is always an object from `calculateViewportWindow`. TanStack Query compares filter keys with partialMatchKey. That check runs over every key of the filter object, so `viewport: undefined` in the filter fails against the board's `viewport: {minX,...}`. As a result, every `invalidateQueries`, `cancelQueries` or `setQueriesData` call that uses `canvasItemKeys.list(canvasId)` matches only the accessible infinite query (its key extends the same object) and never the board's item list. This covers snapshot recovery after a failed or gapped committed-event batch, version restore, the autopilot layout, upload-note completion, and the create mutation's optimistic insert and success invalidation.

## After a successful HTTP update the board's list still holds the pre-update version, so the next edit gets a 409

medium · accepted · C-b9d9a123ec7e

`onMutate` spreads the caller's `data`, including the old `version` used for concurrency control, into every list entry, so the version in the cache does not move. `onSuccess` writes the server item, with its incremented version, only into `canvasItemKeys.list(updatedItem.canvasId)`. That key does not match the board's viewport query (see the key-matching finding). The board keeps rendering the item at the old version. Callers such as EditNoteDialog and the align/distribute actions send `version: item.version` from those rendered items, so a second HTTP edit before a committed event arrives returns a version conflict.

## Committed-event merge appends new items to every cached item list, including other canvases' lists

medium · accepted · C-de547eca9002

`mergeCommittedCanvasItemEvents` takes a `canvasId` but does not pass it on. `applyCommittedCanvasItemBatch` updates every query under `canvasItemKeys.lists()` and appends each hydrated item that a list has not seen. That includes cached lists of other canvases, every cached viewport window of this canvas (including windows the item is not in), and fully loaded accessible lists of other canvases, where `total` is also raised. Nothing checks `item.canvasId` against the list's canvas.

## If committed-event replay keeps failing, a deferred gap event makes it retry forever with no backoff

high · accepted · C-093420661154

When a live event arrives with a gap, acceptCommittedEvent stores it in deferredCommittedEventsRef and calls replayCommittedEvents(lastCursor). If the replay fails (non-OK response or fetch rejection), or the server answers snapshotRequired, lastCursorRef does not move forward. The snapshotRequired branch ignores the nextCursor the server returns. The finally block then clears the deferred map and feeds every deferred event back into acceptCommittedEvent with gap detection on. The same gap is found again, which starts another replay from the same lastCursor. Nothing limits attempts, adds backoff, or stops the cycle except a successful replay or unmounting. Each pass also calls onSnapshotRequired, which in CanvasBoard invalidates the canvas item list query. A WebSocket close or terminal stop does not clear the deferred map either.

## Outstanding replay responses can mutate a replacement canvas session

medium · accepted · C-0812d7ef9561

Changing canvasId resets shared refs but neither cancels outstanding replay requests nor checks their generation after awaiting responses. If the hook instance is retained, a response for the previous canvas can advance the replacement session's cursor and enqueue foreign events for its current callback. Legitimate replacement-canvas replay events below that cursor are then discarded.

## Time-machine (version preview) mode is fully editable, so moving or editing an old version of an item changes the live item

medium · accepted · C-8fb67c2da205

`capabilities` comes only from `accessLevel`. It never accounts for `isTimeMachineActive`. While time-machine mode is on, `useCanvasData` returns snapshot items as `items`. `hydrateSnapshotItems` keeps the original item ids and reuses the live `canvasId`. `CanvasItemLayer` renders those snapshot items with the same full `capabilities` and `onCommitGeometry`/`onActivateItem` handlers it uses for the live board. So dragging or resizing a historical item calls `commitGeometry` on an item whose id points at the live row. Double-clicking opens the edit dialog with the historical content. Keyboard Delete removes the live items whose ids are selected: Ctrl+A selects snapshot `items`, and `onDelete` filters `allItems` by those ids. Only stage panning is turned off in time-machine mode (`draggable={... && !isTimeMachineActive}`); item editing is not.

## Whisper and Serendipity insertions ignore canvas zoom

medium · accepted · C-abb8979d0726

Both insertion handlers pass screen-space offsets as world coordinates. Since the Stage scales world positions by zoom, the inverse transformation must divide the viewport-center offsets by zoom. Other insertion paths in this file already perform that division.

## Returning from organizer view loses canvas resize tracking

medium · accepted · C-bb446adc6d17

The mount-only effect observes the initial manual-view container. Switching to organizer view unmounts that element, and returning creates a different container. The effect never reruns, so the new container is not observed and stageSize stops following layout changes.

## EditNoteDialog accepts TEXT items and saves them as note content, losing text styling and storing markup

medium · accepted · C-c95e8b5c443f

CanvasBoard's double-click handler opens EditNoteDialog for both NOTE and TEXT items. The dialog only checks `isNoteContent`, which passes for any content that has a `text` key, so TEXT items get through. On load the dialog treats TEXT content as a legacy note. On submit it sends `normalizeNoteContent(data.content)`, a note-format object (`formatVersion`, `document`, `plainText`, `text: renderNode(document)`), as the item's new content. The server parses that with `textContentSchema`, which drops the unknown keys and replaces the whole stored content. The item loses its `fontSize`, `fontFamily`, `color` and `align`, and its `text` becomes the editor's rendered rich-text form. TextItem draws `content.text` as plain Konva text, so any markup would show up literally.

## If the AR view closes while getUserMedia is still pending, the camera stream is never stopped

medium · accepted · C-c3af86c49eaa

`startCamera` awaits `getUserMedia` and then stores the stream in `streamRef` without checking whether the component is still open or mounted. CanvasDialogs renders `ARCanvasLayer` only while `arOpen` is true, so closing the dialog unmounts it, and the effect cleanup calls `stopCamera()`. If the permission prompt or device start is still pending at that point, the promise resolves after cleanup and stores the new stream in a ref nobody owns. Nothing stops its tracks. The doc comment says the stream 'is released on close', but in this case it is not.

## SlideTransition is a new component on every render, so the AR dialog remounts, the camera feed goes blank and fullscreen exits

medium · accepted · C-c7db18582da5

`SlideTransition` is an arrow function declared inside the body of `ARCanvasLayer` and passed as `slots.transition` to the MUI Dialog. Each render makes a new function, so React sees a different element type for the transition wrapper. It unmounts and remounts the whole subtree inside it: the `containerRef` Box and the `<video ref={videoRef}>` element. `srcObject` is only assigned once, inside `startCamera`, so the new video element never gets the stream back and shows nothing. Many things cause a re-render. The component's own state changes do (`setShowOverlay`, `setIsFullscreen`, `setError`). So does every parent render, because CanvasDialogs passes a fresh `items.map(...)` array on each render. The fullscreen toggle breaks itself: `requestFullscreen()` is called on the container, then `setIsFullscreen(true)` re-renders, the remount detaches the fullscreen element, and the browser leaves fullscreen. next.config.mjs does not enable the React compiler, so nothing memoizes the function.

## The row keydown handler takes Enter/Space from the nested Edit/Delete buttons, so Delete cannot be pressed from the keyboard

medium · accepted · C-08dde0b0eef5

Each row's Paper has `onKeyDown={(event) => handleKeyDown(event, item)}`, and the row's Edit and Delete buttons sit inside it. `handleKeyDown` never checks `event.target === event.currentTarget`. Pressing Enter or Space on the Delete button therefore bubbles up to the row. When editing is allowed, the row calls `event.preventDefault()` and `onActivateItem(item)`, which opens the editor and announces "Editing …". When editing is not allowed, it announces "… is read-only." and also calls preventDefault. Calling preventDefault on keydown cancels the native button's activation, so the Delete button never fires from the keyboard. Arrow keys and Backspace pressed on the buttons are likewise handled as row commands.

## Replacing an image can submit the previous upload

medium · accepted · C-5ec56adae9ed

Selecting a replacement does not clear the previous uploadedImage. After the replacement POST completes, uploading becomes false immediately, but uploadedImage changes only when the separate image load succeeds or fails. During that interval, Add to Canvas is enabled and submits the previous image.

## Drawn arrows always point top-left to bottom-right, whatever the drag direction

medium · accepted · C-98bb7fd4a6a4

The mouse-move handler normalises the creation rectangle to a positive width and height and moves x and y to the top-left corner, which throws away the drag direction. On mouse-up the arrow is saved with `startPoint {0,0}` and `endPoint {width,height}`. ArrowItem draws `[start.x, start.y, end.x, end.y]` relative to the group position, so the arrowhead always ends up at the bottom-right. An arrow dragged right-to-left or bottom-to-top points the wrong way. Mouse-up also requires both width and height to be over 5, so a purely horizontal or vertical arrow cannot be created.

## Horizontal or vertical arrows and thin shapes are silently thrown away

medium · accepted · C-04eb159464af

An item is only created when the drag box is more than 5 units wide and more than 5 units tall. Arrows use the same check. A straight horizontal arrow (height about 0) or vertical arrow (width about 0) fails it, and the creation state is cleared with no feedback.

## Horizontal and vertical arrows are silently discarded

medium · accepted · C-c135df522e3c

The same two-dimensional minimum-size check is applied to shapes and arrows. A horizontal arrow has zero height and a vertical arrow has zero width, so neither reaches createItem regardless of its length. The creation state is then cleared without feedback.

## Dragging a bookmark resize handle also runs the item's own move handlers, so a resize moves and saves the bookmark at the handle's local offset

high · accepted · C-d23b064b7160

The resize handles are draggable `Circle` nodes inside the bookmark's own draggable `Group`. Konva bubbles the `dragmove` and `dragend` events of a child up to its ancestors, and keeps `e.target` set to the child. So each handle `dragmove` runs `handleResize`, and then the Group's `handleDragMove` runs with `e.target` = the Circle. That second handler calls `setLocalPosition` with the Circle's group-local coordinates, roughly `(width, height)` or `(0, 0)`, which overwrites the position `handleResize` just computed. On release, `handleResizeEnd` commits that corrupted `localPosition`. The Group's `handleDragEnd` then commits a second write using `node.x()/node.y()` of the Circle. Neither Group handler checks `e.target === e.currentTarget` or sets `cancelBubble`.

## SerializedDeltaQueue keeps its first version forever, so after any outside write every HTTP save conflicts until the canvas is reloaded

medium · accepted · C-a7e40b677850

The queue takes its optimistic-concurrency version once, in the constructor. The only line that changes it is the success path (`this.version = result.version`). Nothing can set a newer version from outside. A failed save puts the delta back in the queue but keeps the old version. The callers create the queue once and keep it: use-item-geometry keeps one queue per item id for the life of the canvas, starting from `item.version` at the first gesture, and use-autosave only builds a new queue when `itemId` changes, not when its `version` prop changes. On the HTTP write path, `api.updateItem` sends `data.version`, and the PATCH route accepts the update only when `version: data.version` matches. Other writes also bump the item version: the separate autosave queue for the same item, another collaborator, the background bookmark refresh, and agents. After any of these, the queue sends an old version, gets a 409, keeps the delta, and sends the same old version on every later flush. Each of those saves conflicts until the component remounts.

## After a version conflict, the serialized delta queue keeps retrying with the stale version and never recovers

medium · accepted · C-eef7121ed1ee

`SerializedDeltaQueue.run` sends `this.version`. On failure it merges the delta back into `pending` and leaves `version` alone. `useAutosave` builds the queue once per itemId with the `version` prop of that moment and never passes in later versions. `useItemGeometry` likewise caches one queue per item, seeded with `item.version`, for the whole canvas session. After a 409, `useUpdateCanvasItem.onError` invalidates and refetches the items, but the queue never reads the fresh version. Every later flush resends the merged delta at the stale version and conflicts again.

## Autosave shows 'offline/retrying' after a network failure, but nothing retries the pending delta

medium · accepted · C-55265f069248

After a failure the queue keeps the delta and reports 'offline/retrying' for a TypeError or 'failed' otherwise, then rethrows. The queue has no retry timer or backoff, and both callers discard the rejection with `.catch(() => {})`. The pending change is only sent again if the user makes another edit, or once on unmount, and a failure there is also swallowed. The status message promises a retry that never happens.

## An older status response can make a public canvas appear private

medium · accepted · C-04d83296aad1

The initial status request is neither cancelled nor checked for staleness, and controls remain enabled during that request. A GET that captured the private state can finish after a successful enable operation and overwrite isPublic with false. The switch then appears off and hides the link while public access remains enabled on the server.

## The microphone can keep recording with no way to stop it if recording starts after unmount or on a repeated click

medium · accepted · C-35b6a88b1a74

startRecording awaits getUserMedia and only then creates and starts the MediaRecorder. It does not check whether the component has unmounted, or whether another start is already running. The unmount cleanup sets cancelledRef = true and stops recorderRef.current. If the component unmounts while getUserMedia is still pending, recorderRef.current is null at that moment, so nothing is stopped. When getUserMedia resolves afterwards, line 138 sets cancelledRef back to false and lines 162-163 start a recorder that no remaining code can reach. The 10-minute cap does not apply either, because it lives in a useEffect of the unmounted component. The record button also stays enabled while getUserMedia is pending (disabled only when busy and not recording). A second click therefore opens a second stream and recorder and overwrites recorderRef. The first recorder and its stream are never stopped.

## An older execution can mark a new suggestion as done

medium · accepted · C-7c2a97f21c7d

Submitting another question is allowed while a suggestion is being applied: submission checks asking, not applying. The result and settled state are shared rather than associated with a suggestion ID. Once the older execution completes, it sets Done for whichever result is now displayed, including a new suggestion that was never executed. That also hides the new suggestion's Approve and Dismiss controls.

## The global error handlers call JSON.stringify on raw error objects, so a circular or BigInt value throws and the production process never exits after an uncaught exception

medium · accepted · C-83277ff98e68

Both handlers turn the error or rejection reason into a string with plain `JSON.stringify` before they log it. That skips the logger's own circular-safe sanitizer (`sanitizeLogValue` in src/lib/logger). `JSON.stringify` throws a TypeError on circular structures, which are common on HTTP-client errors that carry request and response objects, and on BigInt values. The listeners are `async`, so the throw becomes a rejected promise. In the uncaughtException handler this happens before the Sentry capture and before `process.exit(1)`. The process keeps running after an uncaught exception, the original error is never sent to Sentry, and the new rejection goes to the unhandledRejection handler, which logs only the TypeError. A circular rejection reason has the same effect in the unhandledRejection handler: the original reason is never logged or captured.

## "Export Canvas" as PNG or PDF captures only the visible viewport, overlays included, not the whole canvas

medium · accepted · C-aff8b4096679

Both raster export paths call `stage.toDataURL({ pixelRatio: 2 })` on the Konva Stage with no `x/y/width/height`. Konva's Stage defaults the export area to its own width and height at the current pan and zoom transform. The result is a screenshot of whatever is on screen: items outside the viewport are left out, and every visible layer (grid, selection highlights, remote cursors) is included. Nothing computes the bounding box of all items or resets the transform before export.

## `writeChunk` waits for 'drain' forever after the gzip pipeline fails, for example when the archive budget is exceeded

medium · accepted · C-c4118d37854a

The `meter` Transform enforces the archive budget by failing its callback with `ExportLimitError`. The pipeline then destroys `gzip`. The handler only sees that error if it happens to be awaiting `once(gzip, 'drain')` at that moment. Most of the time the main loop is awaiting other I/O instead: a Prisma page fetch, or the next chunk from the S3 or local upload stream. In that case the next `write()` calls `gzip.write()` on a destroyed stream. That call returns false and emits no further 'error' or 'drain' event, so `once(stream, 'drain')` never settles, and the `once` call is not given the abort signal. `buildArchive` never returns. The catch that records FAILED never runs, and neither does the `finally` that removes the temp directory. With the default budgets (256 MiB archive, 384 MiB input), the archive limit is hit first for accounts with many uploads, because base64-encoded images barely compress. An output error such as ENOSPC on tmpdir follows the same path.

## MCP content reads ignore the disabled READ capability

high · accepted · C-89766c3ca41f

<quotes>
  assertAgentCapability(context.agentProfile, AGENT_CAPABILITY_RUNGS.READ);
</quotes>
MCP content-read cases invoke scope-filtered query helpers without asserting READ. Those helpers enforce canvas membership, not enabled capability rungs. Unlike the REST endpoint, MCP therefore allows a profile with READ disabled to retrieve board metadata and item contents. The same missing guard affects the examined search, item-detail, board-list, and knowledge-list paths.

## Knowledge reads do not scope related entities

high · accepted · C-9f8a64ff8374

Only the root entity's source canvas or item is authorized. Both query branches then include incoming and outgoing relations and endpoint titles without checking those endpoints' current source-item scopes. The canvas branch additionally returns every itemLink. A surviving relation to an entity on an unauthorized board therefore exposes its metadata. The inspected move code changes source-item canvasId, making this boundary relevant, although the remainder of that transaction could not be inspected.

## Knowledge graph expansion exposes entities outside current canvas scope

medium · accepted · C-ac49c15fe9ea

The read checks the requested canvas, but expands incoming and outgoing relations without authorizing their other endpoints. Item moves change canvasId without removing knowledge relations. After one related source item moves to a forbidden canvas, querying the remaining permitted entity still returns the forbidden entity's title, type and relation metadata.

## Knowledge listing returns related entities' titles and status without checking the related entity against the agent's canvas scope

medium · accepted · C-c0e2113fcbd9

listScopedKnowledgeEntities only checks the canvas or item that was requested. It then loads every outgoingRelations and incomingRelations row, including the id, entityType, title and status of the entity at the other end. Nothing checks that this other entity's source item is on a canvas in agentProfile.allowedCanvasIds. Relations are created when both entities share a canvas, but items can later move to another board: home-board filing compares row.item.canvasId with row.targetCanvasId, which suggests filed items end up on the target board. After a move, a related entity can sit only on a canvas the agent may not access, and its title and status still come back through the relation includes.

## Built-in pile grouping can return more items than pilesSchema allows, so Sort into piles and inbox.sort fail on large boards

medium · accepted · C-15aa4bd25d2f

pilesSchema caps a sort at MAX_PILE_ITEMS = 500 items in total and at 80 characters per title. The built-in grouping, suggestPiles, has no such caps. Its greedy keyword loop and its host fallback keep adding every matching loose item until maxPiles is reached. Tag keywords are exempt from the 60% share limit, host titles can be as long as a hostname (up to 253 characters), and keyword tokens have no length limit. suggestPilesForOwner validates only the AI answer with pilesSchema. Its `words` fallback (sort-piles.ts 189-193) returns input.fallback() without validation, and the AI prompt is capped at MAX_SORT_ITEMS while the fallback receives every loose item. The organize route then passes these piles to proposeCanvasPiles, and the MCP inbox.sort tool passes suggestPiles output to it directly. proposeCanvasPiles calls pilesSchema.parse, which throws on piles that are too large or have long titles.

## Built-in grouping generates titles rejected by its own proposal schema

medium · accepted · C-efb025550486

Built-in grouping places complete keywords or hostnames into pile titles without enforcing the 80-character limit. The organize endpoint passes those generated piles directly to proposeCanvasPiles, which rejects them. This also affects the word-matching fallback after an AI failure.

## Sorting can silently expand an unrelated integration profile's scope

medium · accepted · C-8263fe7ad6ab

The built-in organizer is identified by a mutable, unrestricted display name. If an existing integration profile is named "Memoria organizer", sorting a new board reuses that profile and grants it access to the board. The grant happens before the caller checks PROPOSE, so even a failed sort can expand a READ-enabled integration's permissions.

## Approved suggestions run under the caller's agent profile, not the profile that proposed them

medium · accepted · C-2d0e77a61125

resolveAgentProfileForWrite returns context.agentProfile, meaning the calling integration or OAuth agent, before it looks at the suggestion's agentProfileId. In a user session, args.agentProfileId also takes priority over the proposer. executeApprovedSuggestion loads suggestion.agentProfileId but never compares it with the resolved profile. As a result, any agent holding a token for the same user can execute another agent's approved suggestion as long as it has the PROPOSE rung and canvas scope. The change set and agent action are then recorded under the wrong profile. The code's own comment says the 'proposing agent' is the one whose rung and scope are checked.

## Archive pipeline failures can become unhandled rejections

medium · accepted · C-71f1eb62395c

The pipeline promise has no rejection handler until archive production finishes or the producer enters its catch block. Disk errors or signal cancellation can reject it while the producer is awaiting a database or upload operation. That rejection is unhandled during the intervening event-loop turns; observing the outer handler promise does not handle this separate promise.

## Apply cannot retry after approval succeeds but execution fails

medium · accepted · C-9562558e7fa8

Approval persists APPROVED status before execution is requested. If the execution request fails before reaching the server, the catch retains the proposal and re-enables Apply. Clicking Apply again repeats approval, which now fails because the suggestion is no longer OPEN; execution is never retried.

## The suggestion queue and rollback list show only the 12 newest records of any status, so older pending suggestions and revertable change sets drop out of view

medium · accepted · C-e23adc828c77

listScopedActionTimeline returns the newest N suggestions and change sets ordered by createdAt or startedAt, with no status filter. The component asks for 60 and then renders only the first 12 of each list, whatever their status. Newer EXECUTED, REJECTED or EXPIRED suggestions, and newer COMPLETED or REVERTED change sets, push actionable records out of view. An OPEN suggestion older than the 12 newest can no longer be approved or rejected here. A bad change set followed by 12 newer change sets can no longer be reverted from this panel, even though the panel tells users to 'roll back the whole audited change set'. The message 'No suggestions are waiting for review.' appears only when no suggestions exist at all. It is not tied to whether any are actually pending.

## Global timeline limits hide pending canvas suggestions

medium · accepted · C-c7fcf0befa16

<quotes>
      orderBy: { createdAt: "desc" },
      take: input.limit,
</quotes>
The backend limits suggestions across the user or agent profile before the organizer filters by canvas and status. An older but still-open suggestion disappears once 100 newer suggestions exist, including suggestions for unrelated canvases or already-closed suggestions. There is no continuation mechanism in this view.

## Undoing an agent-created board can permanently delete trashed items, manual versions and embeds, even though undo is meant to work only on an empty board

medium · accepted · C-963909916d1d

createAgentBoard records a reversible CREATE change record for the new Canvas, and its comment says undo removes the board only while it is empty. The revert handler that consumes this record only counts live CanvasItem rows (deletedAt: null) and non-deleted uploads. It then hard-deletes the canvas. CanvasItem and CanvasVersion rows use onDelete: Cascade, so this also deletes soft-deleted items that are still restorable from trash and any MANUAL versions a person saved, which never expire. CanvasEmbed rows and other cascaded relations are deleted too. A board that only looks empty can still hold user content.

## Any agent token with WRITE_SINGLE can revert any of the owner's change sets, including other agents' changes on canvases it is not allowed to touch

high · accepted · C-49d966245a26

For the `revert-change-set` action, `resolveRequiredAgentProfile` returns the caller's own agent profile as soon as the integration or OAuth context has one. It never looks at the change set's `agentProfileId`, because the change-set lookup at lines 200-221 runs only for user sessions without a profile. The route then checks only that the agent has the WRITE_SINGLE rung. Nothing calls `assertCanvasScope` on the change set's scope. `revertChangeSet` loads the change set by `id` and `userId` alone. So an agent limited to canvas A can revert change sets made by other agents, or by the owner's assistant profile, on canvas B or at user scope. Reverting a CanvasItem CREATE soft-deletes the item even if the user has edited it since.

## Scoped integrations can roll back changes on unauthorized canvases

high · accepted · C-bbadeae09d55

The integration authorization checks only the write capability, not canvas scope. The rollback service accepts any change set belonging to the same user, then soft-deletes created items by target ID without checking the integration's allowedCanvasIds. An integration can therefore undo changes on a currently forbidden canvas.

## Rollback bypasses the agent's canvas allowlist

high · accepted · C-ecae25b920ed

Rollback checks the owning user but not the acting agent's allowedCanvasIds. The API caller checks only the capability rung before invoking it. A scoped agent can therefore undo changes on an unauthorized canvas, including after its access to that canvas has been revoked.

## approveSuggestion/rejectSuggestion check status, then write without a condition (lost update and double execution)

medium · accepted · C-09cc3990b686

Both functions read the suggestion, check its status in application code, then call prisma.suggestion.update with only the id in the where clause. The status in the database can change between the read and the write. A slow approve can overwrite EXECUTING (set by another request's claim) back to APPROVED, and claimSuggestionForExecution will then claim the suggestion a second time. A slow reject can overwrite EXECUTING with REJECTED, which makes markSuggestionExecuted silently update 0 rows. An approve can also overwrite a concurrent REJECTED.

## Concurrent approval or rejection can overwrite execution state

medium · accepted · C-1acbf3617ff7

Approval and rejection check a previously read status, but their updates do not include that status in the write predicate. A delayed approval can overwrite EXECUTING or EXECUTED with APPROVED, permitting another execution despite the atomic execution claim. A delayed rejection can similarly mark already-running work REJECTED without stopping its effects.

## actions.execute_suggestion claims a suggestion before any checks and never releases it, so failures leave it stuck in EXECUTING

high · accepted · C-d4acdcbcdfd3

executeApprovedSuggestion calls claimSuggestionForExecution first. That moves the suggestion from APPROVED to EXECUTING. Only after that does it resolve the agent profile (resolveWriteActor), check canvas scope and capability rungs, check the payload, and do the write. Nothing in the snapshot moves a suggestion out of EXECUTING except markSuggestionExecuted. The only references to SuggestionStatus.EXECUTING are the claim, markSuggestionExecuted and a home-board filter. So any exception after the claim leaves the suggestion stuck in EXECUTING for good, and claimSuggestionForExecution rejects every retry because it needs status APPROVED. The exceptions include: profile resolution failing, canvas out of scope, rung disabled, canvas full, an empty items array, an unsupported payload kind such as the Ask command kind that the REST route supports but MCP does not, a DB error, and a webhook answering with a non-2xx status.

## Rerunning acceptHomeBoardSuggestion cannot finish an interrupted auto-file and can lose a committed move

medium · accepted · C-09e2f4ec5ada

acceptHomeBoardSuggestion runs several separate non-transactional steps: approveSuggestion (OPEN→APPROVED), claimSuggestionForExecution (APPROVED→EXECUTING), executeAskCommandSuggestion (its own transaction, which moves the item), markSuggestionExecuted, and finally the HomeBoardSuggestion update that stores changeSetId. The rerun path in proposeHomeBoard says a rerun completes an interrupted auto-file. It does this by calling acceptHomeBoardSuggestion again from the start, which only works when the interruption came before approveSuggestion. (1) If the worker dies or the job fails after approve but before execute, the rerun calls approveSuggestion again. That throws 'Only open suggestions can be approved.' on every outbox attempt. The row stays OPEN and the Suggestion stays APPROVED, so the listing hides it (it requires SuggestionStatus.OPEN) and the user cannot accept it either. (2) If the failure comes after the move transaction commits but before the HomeBoardSuggestion update, the rerun finds item.canvasId !== row.sourceCanvasId. It calls closeStale, which marks the row DISMISSED and the EXECUTING Suggestion REJECTED. changeSetId is never stored, so an item was filed but cannot be undone and does not appear in 'recently filed'.

## Ask cannot retry execution after approval has succeeded

medium · accepted · C-e6e1cde4acb4

Approval and execution are separate requests, but every attempt starts with approval. If approval succeeds and the execution request fails before reaching the server, the suggestion remains APPROVED. The error handler leaves the Approve action available, but retrying calls approval again, which rejects non-OPEN suggestions before execution can be attempted.

## Knowledge attributes have no size or depth limit and are saved several times per write

medium · accepted · C-4864afcb9cbb

`knowledgeAttributesSchema` is `z.record(z.string(), z.unknown())`. It has no limit on key count, nesting depth or serialized size. Every other field in the same schemas has a limit (`summary` max 2000, `title` max 255, `entityType` max 120). The agent knowledge POST handler reads the body with a plain `request.json()`. The only body-size helper in the repo (`src/lib/uploads/body-limit.ts`) is used only by the upload route. The attributes blob is then saved on KnowledgeEntity or KnowledgeRelation, copied again into `ChangeRecord.after` through `toJsonValue(knowledgeEntity)`, and on propose paths copied a third time into the suggestion payload.

## The disabled polls feature can still be used through the agent item-write path

medium · accepted · C-8ae8b4e80f79

requirePollsEnabled is the server-side guard for the disabled `polls` launch capability. It is called only from the REST canvas-item routes and from sync validation. The agent write path accepts any ItemType, including POLL, through `z.nativeEnum(ItemType)`. It parses poll content and creates the item in createCanvasItemWrite, and through the bulk path, without calling requirePollsEnabled. As a result, poll items can be created even though the feature is disabled until voting is server-authoritative.

## Knowledge-relation proposals never appear in the organizer queue

medium · accepted · C-664bab438a4f

<quotes>
  return null;
</quotes>
Relation proposals contain entity IDs, but getSuggestionCanvasId recognizes only canvasId or itemId. The proposal payload is stored unchanged, and the timeline returns it unchanged. Consequently, every relation proposal resolves to null and is excluded even when it belongs to the current canvas.

## Concurrent inbox saves choose the same position

medium · accepted · C-5b2044cd04c3

Position selection happens before createCanvasItemWrite acquires the canvas mutation lock. Two concurrent saves can observe identical occupancy and choose the same slot. The subsequent serialized writes persist those already-selected coordinates without recalculating them.

## The action timeline eagerly loads every change record, with full item snapshots, for up to 100 change sets

medium · accepted · C-f2554aec80c3

The GET timeline accepts limit up to 100 and includes `changeRecords: true` with no take or select. Batch and bulk writes record one change record per item, with `after` holding the whole serialized item, and bulk suggestions carry up to 250 items. One request can therefore load and serialize tens of thousands of JSON snapshots.

## Concurrent rollbacks bypass the already-reverted guard

medium · accepted · C-90673a2c9fbe

The change set and revertedAt guard are read before entering the transaction. Two requests can both pass, then serialize on the canvas lock without rechecking the change set. Both subsequently apply its inverse and create completed rollback histories.

## Multi-canvas archive undo violates the archive lock order

medium · accepted · C-17763e10de3c

<quotes>
  await lockCanvasForMutation(tx, existing.canvasId);
</quotes>
Archiving acquires all canvas locks in sorted order, but archive undo acquires them lazily in change-record order. Archive change sets have user scope, so revertChangeSet does not pre-lock their canvases. An undo that locks B before A can deadlock against an archive that locks A before B.

## undoHomeBoardMove reverts the move even after the user has moved the item elsewhere

medium · accepted · C-18b504d642a7

undoHomeBoardMove only checks the row status and that a changeSetId exists before calling revertChangeSet. The MOVE revert in service-core loads the item wherever it is now (only filtered by owner, not by board or deletedAt) and sets canvasId back to the snapshot board and position. The Inbox listing hides filed rows whose item has left the target board (row.item.canvasId === row.targetCanvasId), so this was meant to be checked. The POST /api/v1/items/{itemId}/home-board 'undo' action does not check it and has no age limit.

## Undoing an Ask move leaves connections made on the destination board pointing at an item that has left it

medium · accepted · C-94dfcff67904

The forward move enforces 'Lines cannot cross boards': before an item changes board, it drops every connection the item has. The undo branch for a MOVE record only rewrites the item's canvasId and position back to the source board. It does not delete or account for connections the user created on the destination board after the move. After undo, an ItemConnection whose canvasId is the destination board still references an item that now sits on another board. The connections API normally prevents this state by requiring both endpoints on the canvas.

## UPDATE undo overwrites later user edits to content and geometry without any conflict check

medium · accepted · C-a880d46d0796

The CanvasItem UPDATE undo writes the whole pre-change snapshot back: position, size, zIndex, content and tags. It does not compare the current version with the record's `after` state and does not check `deletedAt`. If the user or a collaborator edited the item after the agent's change (for example, edited a note's text after an agent pile layout only moved it), undo silently throws those edits away. The Canvas CREATE branch explicitly protects later additions, but this branch has no such guard. The overwritten state is stored only in a ROLLBACK_UPDATE record, which revertChangeSet cannot revert ('Unsupported revert operation').

## Undoing a pile sort also reverts later edits to the moved items' content, tags and size

medium · accepted · C-ce03cedeb6e9

applyCanvasPiles changes only positionX, positionY and zIndex on each moved item. However, it stores the whole item row (content, tags, width, height and so on) as the `before` snapshot of an UPDATE change record. The revert code for CanvasItem UPDATE records writes back positionX, positionY, width, height, zIndex, content and tags from that snapshot. It does not check the item's version and does not compare against later changes. So undoing the sort restores the moved items to their full pre-sort state, not just their pre-sort positions. The comment says the existing revert path 'undoes the whole sort in one step', but it undoes more than the sort.

## Undoing an archive can bring back items the user deleted or archived again later

medium · accepted · C-40c8a24d977e

`revertArchivedItem` decides from one test: is `deletedAt` null right now. Any item that is soft-deleted when the undo runs is restored. The function never checks that the item is still in the state this archive change set left it in. It does not check `archivedAt`, and it does not compare the version with the change record's `after` snapshot. `applyRevertOperation` passes only the targetId, so the snapshot is never available to it. Trash restore clears both `deletedAt` and `archivedAt`. Take this sequence: archive, restore from Trash, then a deliberate delete or a second archive (a new recap or Ask command). Undoing the old archive change set then restores the item and overrides the later user action. The docstring says only items already restored from Trash are left alone. The function also reads the item before `lockCanvasForMutation` and never reads it again under the lock, unlike `archiveItems`, which re-reads under the lock. A trash restore that runs at the same moment can therefore lead to a second `created` event and a stale `before` snapshot.

## Undoing an old archive also undoes a subsequent archive

medium · accepted · C-e01d38ebb9eb

<quotes>
      deletedAt: null,
      deletedById: null,
      archivedAt: null,
      version: { increment: 1 },
      updatedById: input.userId,
</quotes>
The undo operation distinguishes only live versus deleted items. It does not establish that the current deletion belongs to the change set being reverted. After an item is archived, restored, and archived again, undoing the first archive restores the second archive as well. The dispatcher supplies no expected archive timestamp or version.

## Automatic filing can override a concurrent manual move

medium · accepted · C-8e9081805a20

The source-canvas check runs outside the move transaction. If the user moves the item after this check, the executor reloads it using ownership and deletion filters only, then unconditionally changes its canvas to the suggested destination. No expected source canvas or version reaches the executor, so a stale automatic suggestion can undo the user's intervening organization.

## Move execution uses item snapshots obtained before acquiring canvas locks

medium · accepted · C-938ca0f906b9

Items and their source canvas IDs are read before locks are acquired and are never re-read afterward. Under READ COMMITTED isolation, two concurrent moves can both capture source A; after the first moves an item to B, the second still locks A and its own target, updates by item ID alone, and emits deletion for A rather than B. Its undo snapshot and invalidated canvas set also reflect the stale source. Global transaction isolation could not be checked before the external-source read budget was exhausted.

## A cross-board move rewrites CanvasItem.canvasId directly, while document projection rejects any source-board update that still references the item

medium · accepted · C-aec1bfbfcf5c

Ask moves an item by updating its row's canvasId and emitting row-level 'deleted' and 'created' events. The collaborative sync projection treats item ids as bound to one canvas and throws InvalidDocumentUpdateError for the whole update batch if any referenced row now belongs to another canvas. Unless the source board's document is reconciled before a client sends an update that touches the moved item, the source board's document update is rejected. Likely cases are a concurrent drag or an offline-queued edit. The moved item also does not appear in the target board's document until something adds it.

## actions.revert_change_set lets a canvas-scoped agent revert any of the user's change sets on any canvas

medium · accepted · C-7cea7293efca

For an integration or OAuth caller, the revert tool resolves the caller's own profile, checks only the WRITE_SINGLE rung and calls revertChangeSet. revertChangeSet looks the change set up by id and userId only. It does not check that the change set's scopeId canvas is in agentProfile.allowedCanvasIds, or that the change set belongs to this agent. Every other MCP write path calls requireScopedCanvas or assertCanvasScope, but this one does not.

## Workspace checkpoints copy the whole canvas into JSON inside the canvas lock and are never pruned

medium · accepted · C-8849656060a4

createCanvasCheckpointTx loads every live item with its full content and all its comments, plus every linked knowledge entity, and stores it all as one JSON snapshot row. It runs for every BULK batch write, every bulk suggestion and every create-checkpoint call. In createCanvasItemBatchWrite it runs after lockCanvasForMutation, so the canvas row stays locked (SELECT ... FOR UPDATE) while up to 2,000 items are loaded, serialized and written. The canvas is also read twice (getOwnedCanvasTx and then the same findFirst). No code in src deletes workspaceCheckpoint rows, and WorkspaceCheckpoint has no relation to Canvas. Snapshots therefore pile up without limit and outlive the canvas they copy.

## A usage-read failure discards successful AI output

medium · accepted · C-3fb11ff67dfa

After the provider operation succeeds, runBudgetedAi performs another Redis read before returning the result. getAiUsage throws on production read failures, so this reporting failure rejects the entire operation and prevents callers from receiving already-generated output. Budget reservations remain charged.

## Lost AI reservations consume concurrency slots until UTC rollover

medium · accepted · C-9735eefb1af0

Active requests are persistent counters in the daily usage hash, not expiring request leases. A process termination after reservation prevents the finally block from releasing its slot. A failed Redis release is also only logged. The 48-hour hash TTL cannot promptly recover these slots; admission continues counting them for the remainder of that UTC day.

## AI concurrency slots stuck in Redis until UTC midnight when the release is lost

medium · accepted · C-be2850ed37a0

Each request takes a concurrency slot with a plain `HINCRBY concurrency 1` on the per-user daily hash. That hash has a 48-hour TTL, and every call pushes the TTL forward. The slot comes back only through `release()` in the `finally` of `runBudgetedAi`. Nothing else expires a held slot. The slot stays taken if the process dies while a provider call is running (deploy, OOM, SIGKILL), if the release `eval` fails (the error is only logged), or if `getRedisClient()` returns null at release time. It stays taken until the next UTC day starts a new key. The default limit is 2, so losing two releases blocks the account.

## One 401 or 403 from the provider permanently marks the saved credential ERROR, including 403s that are not about the key and keys saved while the request was running

medium · accepted · C-bc7ea9f7ec9d

`authFailed` is true for any 403. Providers also return 403 for reasons that have nothing to do with the key: OpenRouter for moderation-flagged input, OpenAI for an unsupported region or no access to a model, and WAF or proxy blocks in front of a local server. markAiCredentialRejected then sets status ERROR with an unconditional `update` by id. Credentials in ERROR are no longer in USABLE_STATUSES, so one flagged prompt turns the user's key off until they save it again in Settings. The update also does not check which secret failed. If the user saves a new key during a slow request (PUT updates the same row and sets it UNVERIFIED), the old key's failure marks the new key ERROR.

## Idempotency recovery repeats mutations whose completion was not journaled

medium · accepted · C-7f881d8a6eed

The business mutation commits before the separate idempotency response update. A crash or journaling failure after that commit leaves an unfinished key, even though the mutation succeeded. Once the 60-second lease expires, recovery deletes the key and executes the mutation again rather than reconciling its committed result.

## Seed script has no environment guard: it creates accounts with a known password and turns off first-run bootstrap on any database it runs against

medium · accepted · C-defc272cabf8

`prisma/seed.ts` is registered as the Prisma seed command (`prisma.config.ts`, which uses `DATABASE_URL`). It never checks which environment or database it is running against. NODE_ENV only decides whether existing data is wiped first. The create path runs every time and makes `alice@example.com` and `bob@example.com` with credential accounts hashed from the hard-coded password `TestPassword123!`. The app's first-run setup (`/api/setup/initialize`) works only while `prisma.user.count() === 0`, so seeding a fresh deployment turns setup off for good. Email verification is required only when `NODE_ENV === "production"`. On staging, preview or other non-production deployments, the seeded accounts can sign in with a public password.

## When the lockout store is down (503 LOGIN_SAFETY_UNAVAILABLE), the form shows "Invalid email or password"

medium · accepted · C-27091242e988

If the lockout store is unavailable, the server's sign-in hook throws APIError("SERVICE_UNAVAILABLE") with code LOGIN_SAFETY_UNAVAILABLE. LoginForm only recognises ACCOUNT_LOCKED, EMAIL_NOT_VERIFIED and status 429. Every other error, including this 503, ends in the generic 'Invalid email or password' branch.

## Two-factor endpoints that check the password are allowed but sit outside the account lockout, contradicting why /verify-password was excluded

medium · accepted · C-016250b42220

The allowlist leaves out `/verify-password` because it is 'a session-backed password oracle outside lockout'. It still allows `/two-factor/enable`, `/two-factor/disable` and `/two-factor/generate-backup-codes`. In Better Auth these take the account password and return a distinct error when it is wrong. The lockout and progressive-delay hooks only match `/sign-in/email`, so wrong passwords on these endpoints are never counted. The only control left is the per-IP proxy limiter.

## Bookmarks whose fetch always fails never get a new bookmarkRefreshedAt, so they take every refresh batch and starve healthy bookmarks

medium · accepted · C-03e90fd83a8b

When the fetch fails (dead link, timeout, non-OK status) or the feature flag is off, the handler throws or returns early and never updates `bookmarkRefreshedAt`. Each cron run picks the 100 bookmarks with the oldest timestamp, nulls first, and enqueues them with a new per-15-minute dedupe key and 6 attempts. Items that always fail keep a null or very old timestamp, so they are selected again in every bucket. Once 100 or more such bookmarks exist across all users, no other bookmark is ever refreshed, and worker time goes on repeated 5-second fetch timeouts with retries.

## Permanently failing bookmarks can starve the global refresh queue

medium · accepted · C-f5c3e6c99cab

Selection always takes the oldest 100 bookmarks globally, with never-refreshed items first. Failed fetches do not advance their timestamp or eligibility. Once 100 permanently failing, never-refreshed bookmarks exist, they occupy every batch indefinitely. Bucket-specific deduplication creates fresh jobs for those same failures instead of allowing later bookmarks to progress.

## Offline persistence failures silently leave edits only in memory

medium · accepted · C-bcf94ea8e97b

A failed cache write permanently disables subsequent persistence for the session without exposing the failure in its snapshot. Editing and unsaved-change counting continue, while the offline status describes those edits as kept on the device. Following a storage failure, offline edits can therefore exist only in memory despite the durability claim.

## Device-copy compaction overwrites the shared compacted state, which can drop another tab's offline edits

medium · accepted · C-d73a632ede3b

All tabs of one user share a single STATES entry for each [userId, canvasId]. compact() replaces that entry with the calling tab's own Y.Doc state, then deletes only the update rows that this instance loaded or wrote (this.known). The code comment covers another tab's appended updates, but not another tab's compaction. Suppose tab A compacts: its updates are folded into STATES and its update rows are deleted. Tab B never received A's edits (both offline, and client-session has no cross-tab channel). When tab B compacts, it puts its own state over A's. A's edits are now in neither STATES nor UPDATES. Similarly, clear() in one tab (on reset or forbid) deletes every update row for the canvas through the index, including rows another tab still relies on.

## Loading during compaction can permanently skip committed updates

high · accepted · C-e29857ce38d9

The initial compacted-state and update-log reads are separate queries without a consistent snapshot. If another replica compacts between them and then appends a newer update, loading combines the old state with only the newer surviving log entries. Its updateCursor advances past the missing updates. The subsequent locked pull cannot repair this when compactedThrough is below that cursor; it can also advance eventSequence past the missing edits' reconciliation events.

## Malformed Host header throws before the try block in the async upgrade handler, leaking the socket and raising an unhandled rejection

medium · accepted · C-a671a27e8d72

The presence `upgrade` listener is `async` and builds `new URL(request.url || "", `http://${request.headers.host}`)` before its `try` block. A Host value that the Node HTTP parser accepts but WHATWG URL rejects (for example containing a space, `[`, or an out-of-range port such as `x:99999`) throws a TypeError. That rejects the listener's promise, which nobody handles. `rejectUpgrade` is never called, so the raw socket is neither answered nor destroyed. The sync server's own upgrade hook parses with a fixed base (`http://sync.local`) and hands non-sync collaboration paths to this listener through `passUpgrade`, so nothing else closes the socket. The per-client upgrade budget (`admission.consumeUpgrade`) sits inside the try, after the throw, so these requests are never rate-limited.

## Malformed Host headers escape upgrade error handling

high · accepted · C-7686b75f71fe

The upgrade listener constructs a URL from the caller-controlled Host header before entering its try block or checking origin and authentication. A Host such as '[' throws here, rejecting the async EventEmitter callback without handling the rejection or closing the socket. The supplied proxy forwards Host unchanged. handleConnection repeats the same unsafe construction.

## Accepted sockets lack error handlers during asynchronous setup

high · accepted · C-b36b5b48600a

The accepted WebSocket awaits admission and Redis subscription before its error listener is registered at lines 723–725. During either wait, a malformed frame can make ws emit an unhandled EventEmitter error. That exception occurs outside the surrounding asynchronous setup and can terminate the realtime process.

## Redis subscription refcount loses updates under concurrent connects and drops live clients' fan-out

high · accepted · C-095f90d7212b

`subscribeToCanvas` reads the per-canvas count, awaits the Redis SUBSCRIBE, and only then writes `count + 1` from the value it read before the await. When two connections to the same canvas subscribe at the same time, both read 0, both await, and both write 1. The count ends at 1 even though two sockets hold the subscription. `unsubscribeFromCanvas` has the same read-then-await shape: it reads `count <= 1`, awaits UNSUBSCRIBE, then calls `subscriptions.delete`. A connect that lands during that await finds the old count, skips SUBSCRIBE, writes 2, and is then wiped by the delete. In both cases the first later disconnect unsubscribes the channel for this process and deletes the remote presence and cursor state while other local sockets on that canvas are still open.

## Presence and cursor-chat broadcasts send collaborators' email addresses to every connection, including anonymous guests

medium · accepted · C-b67a68d999f7

`getLocalUsers` copies each connected user's `email` into the presence list. `broadcastPresence` sends that list to every socket on the canvas and `publishPresence` sends it to other replicas, with no regard to the receiver's access level. A guest gets in with only the public share token (`?shareToken=`) and receives VIEW access. Any authenticated user may connect to a public canvas without a share (`resolveCollaborationAccess` returns VIEW when `isPublic`). These low-trust principals then receive the email addresses of the owner and every EDIT, COMMENT or VIEW collaborator currently connected. Cursor-chat and reaction payloads also fall back to the sender's email as `userName` when the account has no display name. The public share HTTP route does not expose emails (a search of src/app/api/v1/share/[token]/route.ts found no `email`), so this channel discloses more than the HTTP API does.

## Authenticated sync connections bypass public-share tokens

high · accepted · C-3f81da7e713c

Sync authorization discards the supplied token whenever a session exists, then grants any authenticated non-recipient VIEW access solely because the canvas is public. Unlike the public HTTP endpoint, this path requires only the canvas ID, not possession of its current sharing token. Authorization refresh repeats the same fallback.

## A brief auth backend failure on reconnect is treated as lost access, so the client deletes its unsaved device copy

high · accepted · C-ec96d1a5611e

The client's onAuthenticationFailed retries only when the reason is exactly `memoria:unavailable`. Any other reason calls forbid(). forbid() clears the IndexedDB device copy, stops all cache writes, zeroes unsavedChanges and leaves the session permanently on the HTTP fallback. On the server, onAuthenticate maps only one case to a reason: authorizeSyncConnection returning null becomes `memoria:forbidden`. If authorizeSyncConnection throws, the error is not converted to `memoria:unavailable`. That happens when the Better Auth getSession call fails or prisma.canvas.findUnique fails, for example on a pool timeout, a failover or a dropped connection. onLoadDocument does this mapping for load failures, and its own comment says Hocuspocus reports such failures as authentication failures. onAuthenticate has no matching try/catch, so Hocuspocus sends its default permission-denied reason. The client then handles a brief database problem as a permanent revocation.

## When the login session has expired, reconnecting deletes the user's unsaved offline edits instead of keeping them for after re-login

medium · accepted · C-4783a2218739

When the session cookie has expired, been revoked or signed out elsewhere, authorizeSyncConnection treats the connection as a guest. For a private canvas it returns null and the server closes with `memoria:forbidden`. For a public canvas the guest gets read-only scope. Either way the client throws away the device copy. forbid() calls clearCache() and stops caching. On a read-only downgrade, onAuthenticated calls reset(), which also calls clearCache(). The protocol has no separate reason for 'not signed in' as opposed to 'no access to this canvas'. Edits the user made offline on their own canvas are deleted even though they could be saved once the user signs in again.

## Every reconnect with unsaved edits uploads the whole document, which the server's 4 MiB message cap can reject on every attempt

medium · accepted · C-2acfd01a320b

Whenever unsavedChanges > 0, onConnect sends Y.encodeStateAsUpdate(this.doc) as a single update message. That is the whole document, not just the edits the server lacks. It happens on every connect, including the plain reconnect after `memoria:unavailable` with no reload. The sync server caps incoming WebSocket frames (maxPayload) and engine updates (maxUpdateBytes) at 4 MiB. The document itself can grow past that through many small accepted updates. If the full state goes over the cap, ws closes the socket with no `memoria:*` reason. onClose ignores the close and the provider reconnects. onConnect then sends the same oversized state again, and this repeats indefinitely. Below the cap, each reconnect still makes the server decode and validate the whole document.

## A sync update that deletes and creates items is refused at the item limit, and the client then throws away all its unsaved edits

medium · accepted · C-3bc28576896e

projectDocumentChanges counts the new and restored items in an update and calls assertCanvasItemCapacity before it applies any deletions from the same update. The deletions only happen later in the loop. assertCanvasItemCapacity counts the live rows (deletedAt null), so rows the same update is about to delete are still counted. On a canvas at LAUNCH_LIMITS.itemsPerCanvas (2,000), an update that deletes N items and creates N items is treated as going over the limit. The HTTP commands route does it the other way round: it applies deletes first and checks capacity afterwards. The ApiError is turned into InvalidDocumentUpdateError. The server closes the connection with memoria:invalid-update, and the client's reset() drops its whole local document and clears the device copy.

## Shared admission limits do not recover missing leases

medium · accepted · C-dca7083b1de6

Connections admitted during a Redis failure have no shared membership. Existing memberships can also expire during a prolonged outage. After recovery, renewal uses ZADD XX, which cannot recreate either missing membership. Those live sockets remain absent from shared counts until they disconnect, so the outage's per-replica fallback persists after Redis recovers.

## Proxied collaboration upgrades all share the app server's loopback identity, so per-client admission limits become one global bucket

high · accepted · C-6fe716bb28f9

server.ts sends every /api/collaboration/* upgrade to the realtime process through proxySyncUpgrade. The proxy opens a new TCP connection, so the realtime process sees the app server (e.g. 127.0.0.1) as the socket peer. The real peer goes only into X-Forwarded-For. The realtime process derives client identity with deriveUpgradeClientId, which calls deriveClientIp. That function ignores X-Forwarded-For unless TRUSTED_PROXY_CIDRS is set and the peer is trusted. In the single-port setup this proxy exists for, TRUSTED_PROXY_CIDRS is typically unset, so every proxied user resolves to the same identity. The per-client limits are then shared by everyone: 60 upgrades/min for sync, 60/min for presence, and 30 concurrent presence connections.

## Sync server sets per-principal and per-client connection limits but never enforces them; only the upgrade rate and a process-wide document-connection count apply

medium · accepted · C-8743cf6559e2

`SharedConnectionAdmission` is built with `perCanvas`, `perPrincipal` and `perClient` all set to `MAX_CONNECTIONS` (5000), and its `admit`/`release` are never called. Only `consumeUpgrade` (60 upgrades per minute per IP) and `sweep` are used. The comment says 'documents limit themselves', but nothing in the server or engine limits connections per document or per principal. The global cap uses `hocuspocus.getConnectionsCount()`. That counts connections attached to documents, not raw WebSockets, and it is shared by all users. A single client can therefore keep adding sockets at 60 per minute with no concurrent ceiling. It can eventually exhaust the 5000-connection cap for everyone or, with sockets that never authenticate, hold file descriptors and memory without being counted.

## A 'restored' CanvasEvent in the stream makes every replay over its range fail with 400, so the client cursor can never pass it

high · accepted · C-98add6d0ef4a

The version-restore route writes a CanvasEvent with operation 'restored' into the same per-canvas stream the hook replays. The events route loads every row after the cursor and maps each one through toCommittedEventEnvelope. That function validates operation against z.enum(['created','updated','deleted']), so the ZodError makes errorResponse return 400 for any page that contains the restore event. On the client, the restore is only announced as a 'message' payload of type canvas-restore-required, with its cursor. Nothing in src handles that payload (it appears only in the producer), and useCollaboration never moves lastCursorRef past the restore sequence. The restore event takes up a sequence number, so the next item event after a restore always looks like a gap to every connected client. Replay from the old cursor then fails every time.

## Startup validation accepts SMTP_PASSWORD, but the email module reads only SMTP_PASS and sends an empty password

medium · accepted · C-225a1a1628ef

src/lib/env.ts treats SMTP_PASSWORD as an alias for SMTP_PASS (`SMTP_PASS: process.env.SMTP_PASS ?? process.env.SMTP_PASSWORD`). The SMTP check (`"SMTP_PASS"` in smtpFields) and the exported `env.SMTP_PASS` both see the alias. getEmailConfig() in src/lib/email/index.ts ignores the validated `env` object and reads `process.env["SMTP_PASS"] || ""` directly. env.ts copies the alias into a local `rawEnv` object and never writes it back to process.env, so an operator who sets only SMTP_PASSWORD passes startup validation while the SMTP transport gets an empty password. SMTPEmailProvider still sends auth because `config.auth.user` is set, so it authenticates with `pass: ""`. The server rejects the login with EAUTH, which smtp.ts treats as a permanent, non-retryable failure.

## The production placeholder check looks for 'minioadmin' and 'devpassword' but never runs on the database or object-storage credentials

medium · accepted · C-71a2530a975a

KNOWN_PLACEHOLDER_REGEX includes 'minioadmin' (MinIO's well-known default root credential) and 'devpassword', which are only plausible as storage or database credentials. The regex is only applied to the securitySecrets list, which covers AUTH_SECRET, INTERNAL_OPERATIONS_TOKEN, APP_BOOTSTRAP_TOKEN, MODEL_CREDENTIAL_ENCRYPTION_KEY, CRON_SECRET and BACKUP_MANIFEST_HMAC_KEY. S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, MINIO_ROOT_USER, MINIO_ROOT_PASSWORD, DATABASE_PASSWORD and SMTP_PASS are never checked, so default storage and database credentials pass production validation.

## errorResponse returns before the Sentry call for every ApiError, so explicit 500/503 errors never reach Sentry

medium · accepted · C-7bfa59f598f1

`errorResponse` checks `error instanceof ApiError` first and returns the problem response right away. `Sentry.captureException` only runs in the generic branch for errors that are not ApiErrors. So any server-side failure thrown as an ApiError subclass with a 5xx status (`InternalServerError`, `ServiceUnavailableError`) is logged but never sent to Sentry. The code base throws `InternalServerError` for real server bugs, such as a canvas item response failing its contract check in bounded-response.ts or a response not matching its contract in response.ts. A search of src/lib/api found no other `captureException` call that would make up for this.

## Server Sentry beforeSend drops every error containing ECONNREFUSED, hiding dependency outages

medium · accepted · C-85469713f6ab

The server `beforeSend` throws away any event whose first exception message contains `ECONNREFUSED`. That string is exactly what Node network clients (Redis/ioredis, SMTP, outbound fetch to AI providers or webhooks, the sync server proxy) report when a dependency is down. The 500 handler in errors.ts forwards these exceptions to Sentry, and the filter then discards them. The comment above it says "Capture unhandled promise rejections", which is misleading: the hook only filters.

## The MCP endpoint catches every error, returns raw internal error messages and never logs or reports them

medium · accepted · C-6a32c374ec02

The POST handler wraps handleMcpRequest in its own try/catch and turns every exception into a JSON-RPC error. Errors are never re-thrown. As a result, withApiHandler never logs them and errorResponse never redacts them or sends them to Sentry. createJsonRpcError copies `error.message` for any non-ApiError, including Prisma, argon2 and TypeError failures. The production redaction in errorResponse, which returns "An unexpected error occurred.", is bypassed. This includes failures inside resolveAgentRequestContext, which runs before authentication succeeds. One example: a JSON body of `null` makes `body.method` throw a TypeError, and its message is sent back to the client. ZodErrors from tool argument parsing also get code -32000 instead of -32602 (invalid params).

## runIdempotent stores 5xx/429 failure responses and replays them for 24h, so a retry can never recover from a transient error

medium · accepted · C-b9af79b7b762

When the wrapped handler throws, runIdempotent turns any error into a response with errorResponse and saves its status and body against the key. That includes unexpected 500s such as a DB timeout or lock wait failure, and transient 429/503s. A later request with the same key and body finds `responseCode` set and replays the saved failure until the 24h TTL runs out. The replay also drops the original headers: it rebuilds the response with only X-Idempotency-Hit, so `application/problem+json`, `x-request-id`, `Retry-After` and `Location` are lost.

## The comments API returns 401 for permission failures, so apiFetch hard-redirects signed-in users with view-only access to the login page

medium · accepted · C-8091fa991bb7

apiFetch treats every 401 as an expired session and sends the browser to /auth/login with `window.location.assign`. The comments POST and GET handlers throw UnauthorizedError, which is a 401, when a valid, signed-in user lacks permission. On POST, `hasShare` only counts COMMENT and EDIT shares, so a VIEW-share recipient hits `!isOwner && !hasShare` and gets a 401. CommentsPanel shows the comment box to any signed-in session, and use-comments posts through apiFetch. So a view-only collaborator who submits a comment is navigated away to the login page while their session is still valid. The later VIEW-role branch (lines 114-117) can never run, because VIEW shares were already excluded from hasShare.

## Reset and forgot password pages read `message` from error responses, but the server sends `detail`, so every server-side reason is lost

medium · accepted · C-ae985716a3ce

Both client pages build their error text from `errorData.message`. The server routes they call send failures through `errorResponse`, which returns a problem+json body. `ApiError.toProblemDetail` fills only `type`, `title`, `status`, `detail`, `instance` and extensions. It has no `message` field, so `errorData.message` is always undefined and the user always sees the fallback text. This matters most on the reset page. Its client schema checks only `min(8)`, while the server also runs `validatePasswordStrength` and rejects weak passwords with a BadRequestError that explains why and suggests fixes. The server also has separate messages for an expired token and a used token. The page throws all of that away and shows "Failed to reset password". The verify-email page in the same scope does read `detail`/`title`, so the inconsistency is local to these two pages.

## The connections list returns only the first 50 rows, but the client treats it as the full set, so newer connections disappear

medium · accepted · C-6f5c95e0fce3

GET /api/v1/canvases/:canvasId/connections now pages its results with parsePagination. The default limit is DEFAULT_PAGE_LIMIT (50) and the maximum is 100, ordered by createdAt ascending. The only client, useItemConnections, sends no limit or offset. Its ConnectionsResponse type has only `connections`, so it ignores `pagination.hasMore` and treats the first page as every connection on the canvas.

## Pool sizing via DATABASE_URL connection_limit/pool_timeout is documented but ignored by the PrismaPg/pg pool

medium · accepted · C-c888ba3cf78b

The module docs and the inline comment say the pool is sized by the connection_limit and pool_timeout query parameters, which "the pg pool reads directly". Those are Prisma query-engine parameters. node-postgres Pool takes max and connectionTimeoutMillis, and PrismaPg is built from the connection string alone. So the pool falls back to pg defaults: 10 connections, and an unlimited wait for a free connection. The operator's settings are silently dropped.

## Broadcasts do not bound slow clients' outbound queues

medium · accepted · C-ddc8fe3f9264

Broadcast helpers send whenever a socket is OPEN without checking queued outbound bytes or applying a slow-consumer limit. ws can continue buffering messages when the recipient cannot drain them. Incoming rate limits do not bound this accumulated fanout, and unsolicited pong frames can keep a deliberately slow recipient marked alive.

## One tab with a URL over 2048 characters makes the server reject the whole batch of up to 100 tabs, and the error does not say which tab

medium · accepted · C-43fc56b558e4

The client checks only the URL scheme (`isWebUrl`) and preselects every non-pinned web tab. It sends `tab.url` unchanged. The server rejects any URL longer than MAX_URL_LENGTH (2048) and validates the batch as one unit, so one long URL turns the whole batch into a 400. The client's readError shows only `errors[0].message` and drops the `field` (for example `links.37.url`) that the server includes. The user cannot tell which tab is the problem. Retrying sends the same selection and fails the same way.

## Unfurl API returns the third-party site's HTTP status as its own status

medium · accepted · C-06ee2ebdedb0

`safeFetchBuffer` gives back the remote server's `response.status` for non-OK responses, and for redirects that have no Location header. `fetchLinkPage` passes that number on, the unfurl route puts it straight into `new ApiError(page.status, ...)`, and `errorResponse` sends it as the HTTP status of Memoria's own API. So an upstream 401/403/404/429/5xx (or a 3xx without Location) shows up as Memoria's own auth, not-found, rate-limit or server-error response. A null-body status such as 304, or a status outside 200–599, makes `NextResponse.json` throw inside the error path. The client then gets a generic unhandled 500.

## Optimistic create writes `{items:[...]}` into the accessible infinite query, which can crash CanvasAccessiblePanel

medium · accepted · C-bd8f2f314742

On the HTTP route, `useCreateCanvasItem.onMutate` cancels and then runs `setQueriesData` on `canvasItemKeys.list(canvasId)`. Because of the key layout, that filter matches the accessible `useInfiniteQuery`, whose data has the shape `{pages, pageParams}`. The updater always returns a value. If the infinite query has no data yet (initial fetch cancelled by the `cancelQueries` call just before, or an earlier error), its data becomes `{ items: [optimisticItem] }` with no `pages`. CanvasAccessiblePanel then evaluates `query.data?.pages.flatMap(...)` and `query.data?.pages[0]`, and both throw a TypeError on undefined `pages`. When data does exist, the call still adds a stray `items` array to the infinite data.

## Creating an item can crash the canvas when the accessible list has not loaded yet

medium · accepted · C-e6f46c4b40a1

The accessible panel's infinite query uses a key that starts with `canvasItemKeys.list(canvasId)`, and its data has the shape `{pages, pageParams}`. When `useCreateCanvasItem` takes the HTTP route, its onMutate first calls `cancelQueries` and then `setQueriesData` on the same key prefix. That updater never checks the data's shape: it returns `({...old, items: old?.items ? ... : [optimisticItem]})`. If the accessible query is in the cache with no data yet (its first page is still loading, which the cancel resets to empty, or the first page failed), the updater writes `{items:[...]}` with no `pages`. `PaginatedAccessibleItems` then reads `query.data?.pages.flatMap(...)` and `query.data?.pages[0]`. TanStack's infinite observer also reads `pages.length` when it works out `hasNextPage`. Both throw a TypeError while rendering. The live-event merger (lines 464-466) handles the paged shape, which shows the shape is known, but the create updater does not.

## One failed reconnect handshake ends live collaboration for good, so backoff never really runs

high · accepted · C-49bc4a156197

`opened` is a local variable for each socket. collaborationCloseDisposition returns 'stop' whenever that socket never opened, and it does not consider whether this is a reconnect of a session that worked before. When the realtime process is restarting, the custom server's upgrade proxy answers 502 Bad Gateway. The browser then fires onclose without onopen. The first reconnect attempt (about 1 to 1.3 s after the drop) therefore sets shouldReconnectRef=false and shows the access-denied message. MAX_RECONNECT_ATTEMPTS=8 and the backoff are almost never reached. handleOnline also requires shouldReconnectRef to be true, so coming back online does not recover either.

## Every page load replays the canvas's whole event history from cursor 0

medium · accepted · C-d96527bec58e

lastCursorRef starts at 0n and is never set from the snapshot revision. On the first onopen the hook calls replayCommittedEvents(0n). The server applies no snapshot check for cursor 0 and returns every retained event for the canvas. The hook fetches up to 10 pages of 200 events in sequence and queues them all. CanvasBoard hydrates each touched item through getItemsByIds, even though the item list was just loaded. Canvases with more than 2000 events then also hit onSnapshotRequired and invalidate the list they just fetched. A per-canvas revision (MAX(sequence)) already exists server-side and could seed the cursor.

## Gap detection expects contiguous per-canvas cursors, but sequence is a global BIGSERIAL, so most live events trigger a replay request

medium · accepted · C-0efcc41f00bd

acceptCommittedEvent treats any live event with cursor > lastCursor + 1 as a gap and starts an HTTP replay. The cursor is CanvasEvent.sequence, a single BIGSERIAL with a global unique index shared by all canvases. Events on other canvases, and sequence values lost to rolled-back transactions, leave per-canvas holes even when nothing was missed. With concurrent activity across canvases, almost every live event deferred and followed by a GET /events request from every connected client.

## Slow regex in isMcpResource lets an anonymous user freeze the server via /api/oauth/token

high · accepted · C-efd27e76172b

isMcpResource removes trailing slashes with `resource.replace(/\/+$/, "")`. The pattern has no start anchor and ends in `+$`, the same shape as the known trim-newlines ReDoS (/[\r\n]+$/). When the input is a long run of '/' followed by one other character, the regex engine tries every start position, grabs the rest of the slashes, fails at `$`, and backs off one character at a time. The work grows with the square of the input length. The token endpoint sends the client-supplied `form.resource` straight into this function, and readOAuthForm reads the whole body with `request.text()` and no size cap. Dynamic client registration needs no login and defaults to token_endpoint_auth_method "none", so no client secret is stored. authenticateClient only checks a secret when a hash exists, so anyone can get a working client_id and reach the regex.

## Refresh-token reuse does not revoke the replacement token family

medium · accepted · C-260c48a78a92

Rotation revokes only the presented token row and issues an independent replacement. Presenting the old refresh token again merely returns invalid_grant; it does not revoke the replacement grant. If a thief refreshes first, the legitimate client's subsequent reuse does not terminate the thief's active access or refresh tokens, defeating rotation's replay-response protection.

## Refresh-token reuse does not revoke the compromised grant

medium · accepted · C-6b8b74b3df51

<quotes>
    return issueTokens(tx, record);
</quotes>
Rotation rejects reuse of an old refresh token but never revokes its replacement tokens. If an attacker refreshes a stolen token first, the legitimate client's subsequent reuse returns invalid_grant while the attacker's replacement pair remains valid. Thus the implemented rotation does not contain a detected compromise.

## Reusing an old refresh token or an already-used authorization code is refused but not treated as a breach

medium · accepted · C-d4c841b4d570

When a refresh token is used, refreshAccessToken marks that token row as revoked and creates a new pair. If someone later presents a revoked refresh token, the code just returns invalid_grant (the `record.revokedAt ||` check). It does not revoke the newer tokens that came from that grant or the agent profile. Authorization codes work the same way: a second use fails, but the tokens issued on the first use stay valid. RFC 9700 and OAuth 2.1 recommend rotation for public clients precisely so that this kind of reuse can be detected and the whole token family revoked. Here rotation happens but nothing acts on the reuse signal. Public clients with no secret are the default (`token_endpoint_auth_method` defaults to "none").

## Retention sweeps delete at most 500 rows per table per day, so trash, idempotency keys and thumbnail candidates pile up without limit

medium · accepted · C-68788ca28c38

Each retention handler runs one DELETE ... LIMIT 500 and returns, with no loop and no re-enqueue when the limit is reached. The maintenance cron queues each retention job with dedupeKey `${type}:${day}`. enqueueOutboxJob upserts on dedupeKey with an empty update, so each type runs at most once per UTC day however often the cron fires. The ceiling is therefore 500 expired trash items, 500 surplus manual versions, 500 idempotency keys older than 24h and 500 thumbnail candidates older than 1h per day, across all users.

## Completed outbox rows are never deleted, apart from version-history job types

medium · accepted · C-a6213e06d788

completeOutboxJob marks a row COMPLETED and keeps it. The only deletion I found in the snapshot removes COMPLETED rows of the two version-history job types. A row is enqueued for every committed canvas event (`canvas.event.publish:${event.id}`), every email, every enrichment, and so on. Deduplication relies on old rows staying around: the upsert with `update: {}` turns any later enqueue with the same key into a no-op. The schema has a `completedAt` index, which suggests pruning was planned. I could not find a general cleanup, and the handler for the cron-enqueued 'retention.maintenance' job is not in the snapshot.

## Late export failures can overwrite cancellation or completion

medium · accepted · C-a9bb1437d16a

The generic error transition checks only the export ID, not its current status or owning attempt. A storage/database failure arriving after cancellation overwrites CANCELLED with QUEUED or FAILED. A stale attempt can similarly overwrite a replacement attempt's COMPLETED state. The worker races the handler against abort rather than awaiting its termination, so late handler mutations are possible.

## The HTML sanitizer re-parses decoded text as HTML, so a crafted note can store any markup, which later reaches innerHTML

high · accepted · C-ea4772ab9c7d

sanitizeAllowedHtml collects every element with root.find("*") and replaces each disallowed element with `$(element).replaceWith($(element).text())`. `.text()` returns decoded text: entities are resolved, and the content of raw-text or RCDATA elements such as <textarea>, <title>, <noscript>, <xmp> and <iframe> comes back as raw markup. Cheerio's replaceWith() parses a string argument as HTML. The new nodes are not in the element list already collected, so their tags and attributes are never checked. Example: `hi <textarea><img src=x onerror=alert(1)></textarea>` or `<div>hi &lt;img src=x onerror=alert(1)&gt;</div>` comes out as `hi <img src="x" onerror="alert(1)">`. The legacy note path in normalizeNoteContent stores this output as the note's `text` (named `safeHtml`). The read-only canvas layer used by public share links and embeds passes `item.content.text` to the client stripHtmlTags, which assigns it to `innerHTML` of an element made with document.createElement. Images in such an element load even though it is never attached to the page. sanitizeComment uses the same function.

## Legacy note conversion loses formatting and corrupts escaped text

medium · accepted · C-10bf2f7c623a

Legacy HTML is converted into one unmarked text node rather than parsed into a rich-text document. This removes formatting, links and block boundaries. stripHtml also leaves HTML entities encoded, so text such as A &amp; B becomes literal entity text in the editor. The returned HTML and document therefore represent different content; subsequent versioned normalization uses the degraded document.

## Non-shared RichTextEditor sends raw ProseMirror JSON to normalizeNoteContent, which rejects it, so notes with blank lines, links, numbered lists or code blocks cannot be saved

high · accepted · C-fe03a6b17eda

When there is no shared fragment, the editor's onUpdate passes `editor.getJSON()` straight to `normalizeNoteContent`. That function only accepts Memoria's canonical shape. ProseMirror's toJSON leaves out `content` on empty nodes, so an empty paragraph serializes as `{type:"paragraph"}`. It also includes every attribute with its default value: a Tiptap link mark carries target, rel, class and (in v3) title, an orderedList carries start and type, and a codeBlock carries language. validateNode fails with "Block content must be an array." when `content` is missing, and with "Unexpected block attributes." for any attrs except heading.level. validateMark allows only `href` on links. The collaborative path does convert this shape: readNoteFragment accepts and strips exactly these attributes (href/target/rel/class/title, start/type, language) before it normalizes. RichTextEditor has no such adapter. Its catch block hides the failure and emits the raw document. The dialog's submit then calls normalizeNoteContent(data.content) again, which throws.

## Strict note attributes conflict with editor-generated ordered lists

medium · accepted · C-d879ce5f6a50

The standalone editor uses StarterKit ordered lists and submits its getJSON() document directly. TipTap ordered-list JSON normally includes its start attribute, but the validator rejects every attribute on non-heading blocks. The onUpdate catch preserves the rejected document without adapting it, and submit normalization rejects it again. This likely makes the supplied numbered-list control produce unsavable drafts.

## The non-shared editor uses StarterKit defaults (underline, horizontalRule, a built-in link) that the note validator rejects, and registers Link twice

medium · accepted · C-d2c7cc46067a

The shared schema module states that StarterKit must run without underline or horizontal rules, and disables `underline`, `horizontalRule` and StarterKit's own `link` so that the editor can only produce what the validator accepts. Those option names exist only in Tiptap v3 StarterKit, which confirms the project is on v3. The non-shared branch of RichTextEditor configures StarterKit with heading levels only. Underline (Ctrl+U), horizontal rule (the `---` input rule) and StarterKit's bundled Link therefore stay on, and a second `Link.configure(...)` is added on top. The validator's MARK_TYPES has no `underline` and BLOCK_TYPES has no `horizontalRule`, so these produce content that normalizeNoteContent rejects. Registering Link twice also triggers Tiptap's duplicate-extension warning, and which link configuration takes effect (openOnClick, rel) is not defined.

## Comparing documents with JSON.stringify when keys are in a different order makes the editor reset its content on every keystroke once a note has formatted text

medium · accepted · C-4b3998054133

In non-shared mode, onUpdate emits `normalizeNoteContent(...)`. Its document is rebuilt by validateNode, which writes text nodes as `{type, text, marks}`. ProseMirror's Node.toJSON writes them as `{type, marks, text}`. The parent form stores that value and passes it back as `content`. The effect then compares `JSON.stringify(editor.getJSON())` with `JSON.stringify(nextDocument)`, and the two differ in key order whenever any text in the document has a mark (bold, italic, strike, code). So the effect calls `editor.commands.setContent(...)` after every keystroke. Replacing the whole document maps the selection to the end of the document. Empty paragraphs differ the same way: EMPTY_TIPTAP_DOCUMENT has `content: []`, while ProseMirror leaves `content` out.

## writeNoteFragment's fallback flattens a note into one paragraph and runs words from separate blocks together

medium · accepted · C-58234efb5c1b

When a stored note is valid under Memoria's note format but not under TipTap's schema, writeNoteFragment falls back to plainTextNode. The comment says this is meant to "keep the words". plainTextNode collects every text node and joins them with an empty string into one paragraph. Words in separate paragraphs, list items or headings run together ("Buy milk" + "Call mom" → "Buy milkCall mom"), and hard breaks and all structure are dropped. note-format accepts several shapes TipTap rejects: an empty bulletList/orderedList (it only checks that the children it has are listItems), a listItem whose first child is not a paragraph, a top-level listItem, and an empty blockquote. Such notes arrive through the HTTP API or agents. fillItemMap writes the flattened version into the collaborative document. The next text edit projects it back onto the row, so the damage becomes permanent.

## A job-state persistence failure terminates the worker loop

medium · accepted · C-26c3e86fe353

The failure-state database update can reject inside processJob's catch block. That rejection escapes Promise.all and terminates runOutboxWorker; unlike claim failures, it has no recovery loop. A brief database failure while recording one job's outcome therefore stops subsequent polling.

## The worker claims nothing new until every job in the current batch finishes, so one slow job leaves the other slots idle

medium · accepted · C-525e2d8ea26a

Each loop iteration claims up to `concurrency` jobs and then runs `await Promise.all(jobs.map(processJob))` before it claims again. When one job in the batch is long (for example an account export, which the per-type timeouts are designed to allow), the slots freed by the faster jobs stay empty. Pending jobs wait for the slowest job in the batch, which is up to its full deadline.

## Jobs whose lease expired are claimed again with no maxAttempts limit, so a job that crashes the worker retries forever

medium · accepted · C-f1d2bc5da267

claimOutboxJobs picks up any RUNNING job whose lease has expired and adds one to `attempts`. It never compares attempts with maxAttempts. A job only becomes DEAD inside failOutboxJob, and that runs only when the handler throws inside a live worker. Two paths never reach failOutboxJob: the process dies during the handler (OOM, SIGKILL, container eviction), or the worker gives up after losing its lease (the early return at worker.ts 157-162). In both cases the job stays RUNNING and is claimed again after the lease runs out. Attempts keep climbing past maxAttempts and the job never goes DEAD.

## A repeat delivery that finds a recent RUNNING export returns success, so the outbox job completes and the export stays RUNNING forever

medium · accepted · C-cc00965fc524

When a delivery of `account-export.build` finds the export RUNNING with a `startedAt` newer than `max(2 × accountExportTimeoutMs, 60s)` (20 minutes by default), it returns normally. The outbox worker counts any resolved handler as success and calls `completeOutboxJob`, which marks the job COMPLETED. The outbox only hands out a job again when it is PENDING or when a RUNNING job's lease has expired. Once the job is COMPLETED, nothing delivers it again, so the comment's promise that a killed process 'is recoverable once its timeout window is stale' never comes true. In practice, repeat deliveries come long before that window ends. One case is lease expiry after a worker crash or deploy, which takes about one lease (longer than the handler deadline). The other is `failOutboxJob` rescheduling after a handler timeout, with a 1–2 s backoff. In both cases the repeat delivery acknowledges the job while the export row stays RUNNING. `accountExportTimeoutMs` is used only for this staleness check. It is not tied to the worker's handler deadline or lease, so nothing enforces the window's assumption.

## Short-lived concurrency or budget-store errors permanently skip AI link enrichment, and the outbox runs 4 jobs at once against a per-user limit of 2

medium · accepted · C-3bd8600ed593

`skipReason` turns every `AiBudgetError` and `AiBudgetStoreError` into "budget". That includes AI_CONCURRENCY_BUDGET, which `throwBudget` raises with retryAfter=1 second, and the 503 thrown while the budget store is down. The link-enrichment outbox handler treats any non-OK result except "provider-error" as final. It skips the embedding and sets the enrichment to status DONE with aiSkipReason "budget", so the job is never retried. The outbox worker claims and runs up to 4 jobs at once by default, while each user may hold only 2 AI slots. When a user saves several links together, the third and later enrichments are rejected for concurrency and then lose AI title, tags, summary and near-duplicate detection for good.

## Upload-note storage reads survive worker cancellation

medium · accepted · C-7fe276b6a031

readOriginal checks cancellation only before awaiting the next chunk. Neither the pending storage request nor reader.read is connected to the abort signal, and releaseLock does not cancel the stream. The worker races the handler against cancellation, so a timed-out attempt can remain blocked in storage I/O after the worker has moved on.

## Row-to-document reconciliation replaces long collaborative notes with an empty paragraph

high · accepted · C-bc265f43bf7d

The two directions of the note conversion apply the 50,000-character limit to different inputs. readNoteFragment, which reads a client's document into a row, passes only `{ formatVersion: 1, document }` to normalizeNoteContent, so only the document JSON is measured. The accepted VersionedNoteContent then gets `plainText` and the rendered HTML `text` added to it, and projection stores that whole object in CanvasItem.content. The reverse path, noteDocumentFromContent, sends the stored object back through normalizeNoteContent. That function measures `JSON.stringify(input)` across all fields. A stored note whose document JSON is under 50,000 but whose total with plainText and HTML is over 50,000 therefore throws on the way back. noteDocumentFromContent catches every error and returns an empty paragraph. fillItemMap sees that the empty document differs from the current fragment and writes it into the note with writeNoteFragment. The engine's projection records canvas events but never advances CanvasDocument.eventSequence. So the periodic reconcile (`sequence > current` → `engine.catchUp`) reconciles the server's own projected edits through this path. The note text is wiped in the replica, written to the update log and applied to the live document, and onCommitted spreads it to other replicas. Any other normalization failure, such as a legacy note over MAX_NOTE_TEXT_LENGTH, hits the same silent empty fallback, both here and during lazy migration (createDocumentFromRows).

## Converting a legacy HTML note keeps HTML entities in the plain text and runs paragraphs together

medium · accepted · C-ed00d90cb4d6

The legacy path computes plainText = stripHtml(safeHtml). safeHtml is cheerio's serialized HTML, so `&`, `<`, `>` and nbsp come back as `&amp;`, `&lt;`, `&gt;` and `&nbsp;`. stripHtml only removes tags with a regex and never decodes entities, and it inserts no separator between blocks. plainText is then used both as the stored plainText and as the only text node of the new document. As a result, `{text:"<p>Tom & Jerry</p><p>Next</p>"}` becomes plain text `Tom &amp; JerryNext`. When the document is rendered later, renderNode escapes it again (`&amp;amp;`). The formatting kept in `text` is also missing from `document`, which is what the editor loads.

## Plain note text is reparsed as HTML

medium · accepted · C-e5c213a63a65

Normalization correctly preserves literal text in plainText, but list and search consumers pass that plain text through an HTML parser. A note containing the literal string '<b>literal</b>' loses its tags in descriptions and search indexing; a note consisting of a literal HTML tag can appear empty. Entity-like text is also decoded again.

## When a stored note fails normalization, the dialog stays submittable with stale or default values and can overwrite its tags

medium · accepted · C-631135df172f

The load effect calls `normalizeNoteContent(item.content)` without `allowEmpty`. If that throws, it only sets an error and never calls `reset()` with this item's values. Collaborative editing can legitimately leave an empty note in storage (`storedNoteContentSchema` allows empty), so this is an expected case. The form keeps whatever it already held: the defaults (empty content, `tags: []`), or, because `handleClose` calls `reset()`, the previously edited note's content and tags. Save Changes stays enabled, and onSubmit sends `data.tags` and `data.content` from that stale form. The error text says the note 'cannot be edited', yet nothing stops the save.

## Trash restore and archive undo bring items back without the per-canvas item cap check

medium · accepted · C-e8ab79c4544a

assertCanvasItemCapacity counts only live items (`deletedAt: null`), so items in the trash do not count toward LAUNCH_LIMITS.itemsPerCanvas. Two code paths set `deletedAt` back to null and never call assertCanvasItemCapacity. The first is the trash restore PATCH. The second is revertArchivedItem, which runs when an archive change set is undone. The reference list for assertCanvasItemCapacity confirms that neither path calls it. A user can fill a canvas to the cap, delete or archive the items, create new items up to the cap again, and then restore the old ones. Each round adds more live items, so the count has no upper bound.

## Archive undo can restore a canvas beyond its item limit

medium · accepted · C-0746e0ae0b2d

<quotes>
    await assertCanvasItemCapacity(tx, canvasId, positions.length);
</quotes>
The capacity policy counts live items, so archiving frees capacity that other creation paths can consume. Undo makes archived items live again without checking that policy. Consequently, refilling a canvas after an archive and then undoing the archive exceeds the enforced item limit.

## Ask refuses to archive images, frames and arrows because the move-only type check also runs for archive

medium · accepted · C-376c141b7eed

In proposeAskCommand, only `make_pile` returns early. After that, `assertMovable(items)` runs for every other command type, `archive` included. MOVABLE_TYPES leaves out IMAGE, FRAME and ARROW, so an Ask archive command that names any of those items is rejected with a message about moves. Archiving does not need that restriction: executeAskCommandSuggestion hands archive straight to archiveItems, and archiveItems does not filter by item type.

## Ask move reads items before taking the canvas locks and never re-reads, so it can act on stale canvasId and deletedAt

medium · accepted · C-168110995353

executeAskCommandSuggestion loads the items without a lock (loadOwnedItems). It then derives the set of canvases to lock from that unlocked read, and after locking it reuses the same snapshot. The snapshot supplies the source canvas for the 'deleted' collaboration event and the `before` record that undo relies on. The update filters only on `id`, not on `deletedAt`. Under READ COMMITTED, a concurrent move or trash of the same item between the read and the lock is never noticed. The sibling archiveItems re-reads under the locks for exactly this reason.

## Thumbnail installation can overwrite a newer revision

medium · accepted · C-1448c8144f13

<quotes>
          thumbnailKey: storageKey,
          thumbnailRevision: candidate.revision,
</quotes>
The transaction checks the event revision before locking the canvas row, then updates the thumbnail unconditionally. A mutation can commit after the check. A newer thumbnail can also install before the older transaction resumes, allowing the older worker to downgrade thumbnailRevision and schedule deletion of the newer thumbnail.

## Recap archiving can remove links opened or edited after its stale check

medium · accepted · C-ddc22b68cff9

Staleness is checked outside the archive transaction. The locked reread verifies only ownership and deletion state, and the eventual update is unconditional by item ID. A link opened or edited between these operations is therefore archived even though it no longer satisfies the stale predicate.

## Recap archive mutations and their undo linkage commit separately

medium · accepted · C-82105ea27ebd

archiveItems commits its own transaction before the separate recap update persists the resulting change-set ID. A crash or database failure between these commits leaves the bookmarks archived but the recap without its durable undo linkage. The recap reader relies on that linkage to recognize the archive.

## Hash-routed pages can be closed without being saved

medium · accepted · C-e67ec51a7a88

Duplicate matching removes URL fragments, but fragments can identify distinct application pages. If https://app.example/#/document/A is already saved, selecting https://app.example/#/document/B can produce a skipped-duplicate response. The extension counts that response as confirmation and closes B even though its URL was never saved.

## Concurrent clip batches can bypass skipDuplicates

medium · accepted · C-fb31e149f779

Duplicate detection and the insertion list are computed before acquiring the Inbox mutation lock. The earlier advisory lock is specific to the idempotency key. Two requests with different keys can both observe that a URL is absent, then insert it sequentially using their already-computed lists despite skipDuplicates being enabled.

## SSRF validation accepts the IPv6 unspecified address

high · accepted · C-7960a5e41beb

The IPv6 branch does not reject :: and ultimately returns false for it. An attacker-controlled hostname resolving to :: therefore passes DNS validation and supplies that address to the connection code. On runtime/network configurations where connecting to :: reaches the local machine, this bypasses the intended localhost restriction. Actual exploitation requires verification against the deployed Node IPv6 connection behavior.

## isPrivateIp lets through the IPv6 unspecified address "::" and several special-purpose ranges, so DNS-pinned SSRF checks can be bypassed

high · accepted · C-c6cb395ae6b2

The blocklist is incomplete. For IPv6 it catches only ::1, fe80:, fc/fd and ::ffff:-mapped addresses. `::` (in6addr_any) returns false, and on Linux a connect() to `::` reaches the local host, as 0.0.0.0 does. Also missing: IPv4 100.64.0.0/10 (CGNAT, Tailscale, Alibaba Cloud metadata at 100.100.100.200), 192.0.0.0/24 and 198.18.0.0/15; and IPv6 NAT64 64:ff9b::/96, 6to4 2002::/16, site-local fec0::/10 and multicast ff00::/8. validateUrlForSsrfWithDns accepts any hostname whose records all pass isPrivateIp and pins records[0]. An attacker who controls DNS can therefore publish AAAA `::` and the pinned request goes to loopback.

## Outbound fetches have only a socket idle timeout and no overall deadline; the webhook AbortController is never wired in

medium · accepted · C-7ca4e83d27f4

pinnedHttpRequest passes `timeout` into http.request options. That sets a socket inactivity timeout: it fires only when no bytes arrive for the interval. A server that drips one byte every few seconds keeps the request open until maxSize (1–2 MB) is reached, which can take days. A whole-request deadline exists only if the caller passes a signal. The unfurl route (fetchLinkPage(url) with no signal) and the image proxy (safeFetchBuffer with no signal) do not. deliverWebhook creates an AbortController with a setTimeout to abort it, but never passes controller.signal to pinnedHttpRequest, so its "timed out" path is dead code.

## Upload asset status changes are unconditional, which allows double quota release, DELETING being overwritten by ACTIVE, orphaned objects and assets stuck in DELETING

medium · accepted · C-8f3b23ceebfa

activateUploadAsset sets ACTIVE whatever the current status is. enqueueUploadDeletion sets DELETING from any status, including PENDING, FAILED and DELETED. findAsset in the uploads DELETE route does not filter by status. enqueueOutboxJob upserts on dedupeKey with an empty update, so a second request for the same asset never creates a new job. This leads to three faults. (a) A FAILED asset, whose quota failUploadReservation already released, can be moved to DELETING; a fresh `upload.delete` job then decrements the quota a second time. (b) A deletion that lands while an upload is PENDING (reservation committed, object write in progress) is overwritten by the later activateUploadAsset. The handler's DELETING-guarded update then misses, or in the canvas-cascade case activate throws, so the object written to storage is orphaned. (c) Deleting an already-DELETED asset moves it back to DELETING, but the deduplicated upsert queues no job, so it stays DELETING forever.

## Deleting a failed upload debits quota twice

medium · accepted · C-563f53b7a4a2

failUploadReservation releases a failed upload's quota. enqueueUploadDeletion subsequently accepts that FAILED asset and overwrites its status with DELETING, losing the fact that it is already uncharged. The deletion worker then attempts a second quota debit. The owner-only DELETE endpoint does not exclude failed assets.

## Deleting a canvas never gives back the upload quota for its files, because the asset rows are cascade-deleted before the delete job runs

high · accepted · C-01849bc494ad

enqueueUploadDeletion marks the asset DELETING and queues an `upload.delete` job. It leaves all quota accounting to that job. The canvas DELETE route calls it for every asset and then hard-deletes the canvas in the same transaction. UploadAsset.canvasId has ON DELETE CASCADE, so the asset rows are gone when the transaction commits. When the outbox handler runs, its conditional `updateMany` on `id` + `status: DELETING` matches 0 rows and returns early. The `uploadQuota` decrement is skipped. The storage object is deleted, but the user's assetCount and totalBytes stay charged.

## Activation failures leave stored uploads without cleanup

medium · accepted · C-ec2ce3e0946b

The catch covers both the storage write and database activation. If the object write succeeds but activation fails, failUploadReservation marks the asset FAILED and releases quota without deleting the object or scheduling cleanup. The ACTIVE-only read endpoint then makes the retained object inaccessible.

## Failed asset activation leaves successfully written objects behind

medium · accepted · C-e33be7080ad2

The catch covers both the S3 write and the subsequent database activation. If PUT succeeds but activation fails before committing, failUploadReservation marks the asset FAILED and releases quota without deleting the already-written object or enqueueing compensating cleanup. The request fails while the private blob remains stored.

## Thumbnail cleanup loses its retry state before deletion is durable

medium · accepted · C-88474048e35b

<quotes>
    if (!candidate) return;
</quotes>
The installation transaction deletes the candidate before the old object's deletion job is enqueued in a separate transaction. A crash or enqueue failure in between permanently loses the oldKey: retry exits because the candidate is gone. The stale-candidate branch similarly removes the candidate before directly deleting its uploaded object, so a failed deletion cannot be recovered by retrying the store job.

## An unfurl that finishes after the URL was edited saves the old page's metadata on the new bookmark

medium · accepted · C-932df03723c5

`handleUnfurl` always stores the response with `setMetadata(unfurledData)`. It never checks that the field still holds the URL it fetched, and it does not cancel the request when the URL changes. The input's onChange clears `metadata`, but the request still in flight sets it again afterwards. Because `metadata` is now non-null, the effect never unfurls the new URL. On submit, `data.url` (the new URL) is saved with the old URL's title, description, favicon, preview image and site name.

## Any website can save an attacker-chosen link to a signed-in user's Inbox by navigating them to the share-target page

medium · accepted · C-f08bff36fa29

The share-target page is a GET page, and its query parameters (`url`, `title`, `text`) can come from any source. For a signed-in user it creates a share id and redirects. The client component then sends the save POST on mount, with no confirmation from the user. Nothing checks where the navigation came from: there is no `Sec-Fetch-Site: none` check, no Origin check and no confirm button. The page cannot tell a real OS share-sheet launch from a cross-site navigation such as `location = 'https://memoria/share-target?url=https://evil/phish&title=Reset your password'`. Session cookies are sent on top-level GET navigations, so the save runs. The follow-up POST is same-origin, so cookie SameSite rules do not stop it either.

## Duplicate detection suppresses distinct fragment-routed pages

medium · accepted · C-a465d2cd213f

Normalization unconditionally removes the fragment. Distinct pages in hash-routed applications, such as https://example.com/#/one and https://example.com/#/two, therefore have identical duplicate keys. Candidate re-normalization cannot distinguish them, and the clip endpoint returns the existing item without creating the requested bookmark unless allowDuplicate is supplied.

## Single-link clip endpoint stores bookmark content without the standard bookmark schema (no URL scheme check, sanitization or length caps)

medium · accepted · C-fa3993fca45b

POST /api/v1/extensions/clip validates input with clipSchema only. That schema has `url: z.string().url()`, which accepts any WHATWG URL including javascript: and data: schemes, and `title`/`selection` strings with no length limit. The route then writes `{ url, title, description: selection }` straight into CanvasItem.content. Every other write path runs content through parseCanvasItemContent / bookmarkContentSchema, which checks the scheme, runs sanitizeUrl, caps title at 500 and description at 2000 characters, and caps total content at 256 KB. The batch clip endpoint uses httpUrlSchema (http and https only) and parseCanvasItemContent; the single-clip endpoint does neither.

## The CSP nonce never reaches Next.js, so framework scripts are not nonced and 'strict-dynamic' blocks them in production

high · accepted · C-a42ea36a35f7

The proxy puts the nonce only into a custom `x-nonce` request header. The Content-Security-Policy header goes only on the response. Next.js App Router finds the nonce it adds to its own `<script>` tags (bootstrap chunks and the inline `self.__next_f.push` flight-data scripts) by parsing the `Content-Security-Policy` request header. No code in the snapshot sets that request header: a repo-wide search found the string only at csp.ts line 100, the response header. The root layout passes `x-nonce` to its theme script and to Emotion, which covers only app-authored tags. Framework scripts get no nonce. In production the policy is `script-src 'self' 'nonce-…' 'strict-dynamic'`, and under 'strict-dynamic' browsers ignore 'self', so every script without a nonce is refused.

## When an unfurl fails, the bookmark dialog retries it in an endless loop that floods /api/v1/unfurl

high · accepted · C-94e876907fd8

The auto-unfurl effect lists `unfurling` as a dependency. Its guard is `open && debouncedUrl && !errors.url && !metadata && !unfurling`. When the request fails, `handleUnfurl` sets an error but leaves `metadata` null, then sets `unfurling` back to false in `finally`. That change re-runs the effect, and every guard passes again because `metadata` is still null. `errors.url` is no help: the form uses react-hook-form's default `onSubmit` mode, so it stays unset until the user submits. The effect then calls `handleUnfurl(debouncedUrl)` again. This repeats as long as the dialog is open and the URL does not change. Nothing limits the retries or adds backoff, and the server only caches successful unfurls.

## Browser Sentry config (sentry.client.config.ts) is never loaded, so client-side errors are never reported

medium · accepted · C-a0252cfbe213

Next.js does not load `sentry.client.config.ts` by itself. The Sentry build plugin (`withSentryConfig`) injects it into the client bundle, or newer SDKs load it from an `instrumentation-client.ts` file. Here `next.config.mjs` is wrapped only with the bundle analyzer. A snapshot-wide search found no import of `sentry.client.config` and no `instrumentation-client` file. The server config is imported by hand from `src/instrumentation.ts`, but nothing does the same for the client config. The only `Sentry.init` calls are in the three config files, and no client component (error.tsx, global-error.tsx) calls `captureException`. So the browser SDK, its `beforeSend` filter and the replay integration never run. Meanwhile the CSP still opens `connect-src` to the `NEXT_PUBLIC_SENTRY_DSN` ingest host, which shows browser telemetry was meant to work.

## Type guards require optional fields, so valid TEXT, ARROW and FRAME items are silently not rendered

medium · accepted · C-f64cc83a019b

`isTextContent` requires `fontSize`. `isArrowContent` requires `startItemId` or `startPoint`. `isFrameContent` requires `backgroundColor` or `title`. The server content schemas make all of these fields optional. Both canvas renderers check `item.type === X && isXContent(content)` and return null when the guard fails. Their own render code already handles the missing fields (`fontSize || 16`, `startPoint || { x: 0, y: 0 }`), which shows the guards are stricter than the data model. Content that passes validation, such as `{text:"hi"}` for TEXT, `{endItemId, label}` or `{stroke}` for ARROW, or `{}` for FRAME, is stored but never drawn.

## SSRF check rejects legitimate domains starting with "fc", "fd", "10.", "127." and similar

medium · accepted · C-2692015b5e52

In isPrivateOrLocalHost, IP literals already return early through net.isIP. Everything after that point runs only on DNS hostnames. It still applies textual IP patterns and IPv6 prefix tests to those names: `startsWith("fc")`/`startsWith("fd")` block fda.gov, fdic.gov, fcc.gov, fc2.com and fdroid sites. The `/^10\./` and `/^127\./` regexes block names such as 10.com or 127.example.org. The DNS-pinned check that follows is the real protection; these string checks only cause false rejections.

## Redirected pages resolve metadata against the original URL

medium · accepted · C-5d699077579c

The fetch follows redirects but does not return the final response URL. Its metadata consumer consequently passes the original request URL as the base for the redirected HTML. Relative images, favicons and canonical links are resolved against the wrong host or directory.

## One malformed X-Forwarded-For entry anywhere in the header makes the client look like the shared proxy

medium · accepted · C-5c26a3e379a1

When the peer is a trusted proxy, deriveClientIp parses every X-Forwarded-For entry before it walks the chain. If any entry fails to parse, it returns the peer address, which is the trusted proxy. The entries left of the trust boundary come from the client, so a client can send `X-Forwarded-For: x` and be identified as the proxy. Legitimate clients get the same result when an upstream proxy writes a non-IP entry such as `unknown` (Squid with forwarded_for off) or an IPv4 address with a port such as `1.2.3.4:5678`. normalizeIp only strips ports from bracketed IPv6. The derived value is the only client key used by the Redis rate limiter and by the account-lockout pair key.

## When the two-factor step is rate-limited (429), the form says the code is invalid, and its lockout case can never match

medium · accepted · C-63015cea7973

secondFactorErrorMessage chooses a message only from error.code. Anything it does not recognise falls through to "That code is not valid". The proxy rate-limits every POST under /api/auth/two-factor/. When it does, it returns an RFC 7807 body with status 429 and no `code` field, so the verify-totp and verify-backup-code calls show a rate-limited user the invalid-code message. Unlike the password step (line 124), this path never checks status 429. The `ACCOUNT_TEMPORARILY_LOCKED` case is also dead. The server only defines `ACCOUNT_LOCKED`, and the lockout hook runs only on /sign-in/email, never on the two-factor endpoints.

## Request logs expose share and embed bearer tokens

medium · accepted · C-862dd738381f

The proxy logs complete pathnames at info level before handling requests. Share and embed credentials occupy pathname segments, so neither secret-field redaction nor the Bearer/key-value string patterns remove them. The reader endpoints use those tokens to grant canvas access, making the logged values reusable access credentials rather than harmless identifiers.

## Request logging exposes embed bearer tokens

medium · accepted · C-780a78e28d19

The embed route uses its path token to authorize access, while the proxy logs the complete pathname at info level. The inspected sanitizer recognizes secret field names and credential assignments, but does not redact token-bearing path segments. URL-safe embed tokens therefore appear in request logs. The token-generation implementation could not be inspected before the external-read budget expired.

## Dashboard thumbnail images count against the per-IP canvases rate limit, so loading the grid can block opening canvases

medium · accepted · C-a563918fe1d1

Each CanvasCard loads its thumbnail from `/api/v1/canvases/{id}/thumbnail?v=…`. In the proxy that path matches the `/api/v1/canvases` prefix, so it goes through canvasesRateLimit, which defaults to 50 per minute per IP. Only `/api/v1/uploads/{id}` GETs get the separate 'assets' read budget. A page of the dashboard is 24 canvases, so one page with thumbnails costs about 25 requests and two pages cost about 50. The `?v=` revision changes when a thumbnail is regenerated, which defeats the 24-hour private cache. After a couple of 'Load more' clicks on a cold cache, later thumbnails, opening a canvas (`GET /api/v1/canvases/{id}`), the list refetch and deletes all receive 429 until the window resets.

## The password-change and account-deletion routes check the current password but are not in the strict auth rate limit

medium · accepted · C-a6c69a0f757e

shouldApplyStrictAuthRateLimit is meant to limit credential-changing operations, and Better Auth's own limiter is disabled. /api/v1/users/change-password and /api/v1/users/account both run an Argon2 password check, but neither is in SENSITIVE_V1_AUTH_ROUTES. The function also only matches POST, so a DELETE-based account deletion could never match. Neither route uses the account-lockout store. These checks therefore get only the general per-session API budget, with no lockout or progressive delay.

## A clip batch fails if any link has no title and a URL longer than 500 characters

medium · accepted · C-afac9eab1225

clipBatchSchema accepts link URLs up to MAX_URL_LENGTH (2048) and leaves the title optional. saveClipBatch builds each bookmark with `title: link.title || link.url` and runs it through parseCanvasItemContent. bookmarkContentSchema caps the title at 500 characters. So any link with no title and a URL over 500 characters throws a ZodError inside the batch transaction, and the whole batch is rejected.

## Early rate-limit 429 responses bypass CORS headers and request ID attachment

high · accepted · C-0ce95a8e755f

When any rate limiter in `src/proxy.ts` triggers, the generated 429 `rateLimitResponse` is returned directly. However, `applyCors(request, response)` and `response.headers.set("x-request-id", requestId)` are only called on line 211 and line 214 on `NextResponse.next()`. As a result, all 429 rate-limited responses are returned without CORS headers (`Access-Control-Allow-Origin`, `Vary: Origin`, etc.) and without the `x-request-id` distributed tracing header.

## Rate limit 429 response bypasses application security headers and CSP

medium · accepted · C-55f768ff6bb3

When rate limits are exceeded, rateLimitExceeded returns a NextResponse.json object containing only standard rate limit headers (Retry-After, X-RateLimit-*). The proxy/middleware short-circuits and immediately returns this response without executing applySecurityHeaders or applyCSP. As a result, all HTTP 429 responses are transmitted without critical security headers such as X-Content-Type-Options: nosniff, X-Frame-Options: DENY, Strict-Transport-Security (HSTS), and Content-Security-Policy.

## Auth limit of 5 requests per 15 minutes per IP is shared by every credential, verification, passkey and 2FA step

medium · accepted · C-384d325cdf6a

AUTH_RATE_LIMIT_MAX_REQUESTS defaults to 5 per 15 minutes. It feeds a single limiter keyed only by client IP with one prefix, "auth". The proxy applies that limiter to every POST on register, forgot-password, reset-password, send-verification, verify-email, sign-in/email, passkey verify-authentication, passkey verify-registration and all /api/auth/two-factor/* routes. All of these steps draw on one 5-request budget per IP. The general API limits in the same file get a separate 1500-per-IP ceiling that is explicitly for "shared NAT / office networks". The auth limit has no such ceiling and no per-account bucket, so many users behind one NAT share 5 auth actions per 15 minutes. The per-account brute-force defence already exists in account-lockout.ts, so this low per-IP cap adds little protection and a lot of collateral lockout.

## Browser CSP reports use the same 20/min per-IP bucket as the OAuth and setup endpoints

medium · accepted · C-95ea178d5635

`/api/csp-report`, `/api/setup*` and `/api/oauth*` all go through the single `sensitiveEndpointRateLimit` limiter: one key prefix, keyed by client IP, 20 requests per minute. Browsers post CSP reports automatically whenever the policy is violated. The policy's `style-src` has no 'unsafe-inline', and the root layout server-renders an inline `style` attribute on `<html>`. Nonces do not apply to style attributes, so a full page load is expected to produce at least one violation report, and more if script violations occur. Report traffic from users' browsers therefore uses up the budget for OAuth authorize, token and revoke calls from the same IP.

## Per-user canvas and item rate limits are eclipsed by smaller IP-level limits

medium · accepted · C-a1eea259f8b9

canvasesRateLimit configures an IP limit of 50 req/min, whereas canvasesUserRateLimit configures a per-user limit of 100 req/min (CANVASES_USER_RATE_LIMIT_MAX_REQUESTS). Similarly, itemsRateLimit configures an IP limit of 200 req/min, while itemsUserRateLimit configures 400 req/min (ITEMS_USER_RATE_LIMIT_MAX_REQUESTS). In proxy.ts, the IP rate limiter is checked first via '(await canvasesRateLimit(request)) ?? (await canvasesUserRateLimit(request))'. Because the IP limits (50 and 200) are strictly smaller than the per-user limits (100 and 400) and evaluated first for all callers, a user can never utilize their full 100 or 400 requests/min budget, rendering the per-user rate limiters dead code and throttling legitimate multi-user IP environments prematurely.

## Bulk delete sends every DELETE at once and hits the 50/min per-IP canvases rate limit, so large deletes partly fail and the dashboard reload gets a 429

medium · accepted · C-8444cb9c2722

handleBulkDelete starts one `fetch('/api/v1/canvases/${id}', {method:'DELETE'})` for every selected id at the same time through Promise.allSettled. There is no limit on how many run at once and no backoff. The proxy sends every /api/v1/canvases* request through canvasesRateLimit, which defaults to 50 requests per minute per IP, and then through canvasesUserRateLimit at 100 per minute. The same budget is already being spent by the dashboard's list GETs and its thumbnail GETs. Once the selection, or 'Select all loaded' after a few 'Load more' clicks, goes past what is left of the budget, the rest of the DELETEs come back as 429. Then `queryClient.invalidateQueries({ queryKey: canvasKeys.all })` refetches the list into the same exhausted budget. The global retry policy does not retry 4xx, so the canvas grid shows 'Failed to load canvases'. The code reads the server's reason (`err.detail`) and throws it, but never shows it. The user only gets '…, N failed' or 'Failed to delete selected canvases'. The call uses raw `fetch`, not `apiFetch`, so a 401 from an expired session is not redirected to login either.
