# Deployment

How a Memoria release reaches the shared k3s cluster. Cluster files (the four
Deployments, the migration Job, secrets, ingress) live in the private `infra`
repository under `apps/memoria/`; its README, "How a release lands", is the
other half of this page. Hosting choices are in the owner's handbook
(`projects/memoria.md`).

## What runs

One image, four processes, plus a migration Job per release:

| Process   | Command                                  | Replicas            |
| --------- | ---------------------------------------- | ------------------- |
| web       | `node scripts/start-server.mjs`          | 1 (more when used)  |
| sync      | `node scripts/start-sync-server.mjs`     | 1 (see ARCHITECTURE) |
| worker    | `node scripts/start-outbox-worker.mjs`   | 1, `Recreate`       |
| scheduler | `node scripts/scheduler.mjs`             | 1, `Recreate`       |
| migrate   | `pnpm db:migrate` (Job, before the pods) | once per release    |

## Settings that differ per environment

| Setting             | Staging              | Production                                  |
| ------------------- | -------------------- | ------------------------------------------- |
| `DEPLOYMENT_STAGE`  | `staging`            | unset (`production`)                        |
| `EMAIL_PROVIDER`    | optional             | required: `smtp`, `sendgrid` or `resend`    |
| `REGISTRATION_MODE` | `closed`             | `invite`; the owner issues invites          |
| `PASSKEYS_ENABLED`  | `false` until the final domain | `false` until the final domain   |
| `TRUSTED_PROXY_CIDRS` | the ingress CIDR   | the ingress CIDR                            |

Without a mail provider (staging), sharing a canvas shows the owner an
invitation link to copy. `node scripts/validate-env.mjs` (or starting the app) refuses
anything else that production needs.

## Database logins

The migration Job connects as the database owner (`memoria`). The web, sync,
worker and scheduler processes connect as `memoria_app`, which can read and
write rows but cannot create, change or drop tables. The cluster must create
`memoria_app` before the first release that carries the
`runtime_role_grants` migration; if it was created later, run
`pnpm db:grant-runtime-role` once as the owner. A setup without that role
(development, the small self-host set-up) keeps using one login.

## Release

1. Commit and push the change to `main` after `pnpm gate` passes (and the
   `build`, `integration`, `e2e` stages the change calls for, see AGENTS.md).
2. From a clean checkout of that commit run `pnpm release` (dry run: `pnpm
   audit`, image build, Trivy). A high or critical finding stops it.
3. With the owner's go-ahead run `pnpm release --push`. It prints
   `Released commit <sha> as ghcr.io/servesyourice/memoria@sha256:<digest>`.
4. In `infra`, put the digest and the full commit into
   `apps/memoria/staging/release/kustomization.yaml` and commit
   `memoria staging: <sha[:12]>`. On the first release also remove
   `suspend: true` from `apps/memoria/flux.yaml`.
5. Flux runs the migration Job, then rolls the Deployments
   (`maxUnavailable: 0`). A failed migration leaves the old release running.
6. Check staging: `pnpm smoke` with `AUTH_URL` set to the staging host and
   `OPERATIONS_BASE_URL=http://127.0.0.1:3000` through
   `kubectl -n memoria-staging port-forward deploy/memoria 3000` (the ingress
   hides `/api/ready` on purpose). Open a canvas in two browsers and edit.
7. Promote by copying the two values to
   `apps/memoria/production/release/kustomization.yaml`.

## Database changes: expand, then contract

During a rollout the old and new release run side by side, and the migration
has already run. So every migration must work with the release before it.
`pnpm check-migrations` (part of `pnpm gate`) enforces this.

- **Expand (any release):** add tables, nullable columns, columns with a
  default, indexes. The old release ignores them.
- **Contract (a later release):** drop or rename a column or table, change a
  type, make a column required. Do it only after a release that no longer
  reads or writes the old shape is live everywhere, and mark the migration
  with a line `-- contract: <which release stopped using it>`.
- **Renaming, step by step:** add the new column, write both, backfill
  (a job that is safe to run twice), read the new one, stop writing the old
  one; release; then drop the old column in a marked contract migration.

## Rollback

Revert the release commit in `infra`; Flux rolls back the pods. The schema is
not rolled back, which the expand/contract rule makes safe. A bad contract
migration is the one case that needs a restore.

## Restore

`docs/operations/backup-recovery.md` covers backups, the isolated restore
drill and incident recovery; `infra` `docs/recovery.md` covers the cluster's
database backups. Prove a restore before real data arrives.
