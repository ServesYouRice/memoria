@AGENTS.md

## Checks in Claude web sessions

- In Claude web sessions, `.claude/hooks/session-start.sh` installs the pinned Node and pnpm, the packages and the Prisma client, and starts a private PostgreSQL 18 on port 5441.
- Run `.claude/hooks/check.sh` before every push and pull request. It runs `pnpm gate fast build audit` and the Redis ACL tests against a local redis-server.
- It leaves out `pnpm gate integration`: Prisma refuses `migrate reset` from an agent without the user's consent. It also leaves out `container`, `e2e` and `perf`, which need a Docker daemon that Claude web sessions lack. Run those on the dev machine for changes that call for them (AGENTS.md).
- Pushes and pull requests are blocked until it passes on the exact code being pushed.
- Never bypass, skip or weaken checks to get past this gate.
- If a check cannot run, tell the user.
