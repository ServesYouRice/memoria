# Connect AI apps to Memoria

Memoria has one connection point for AI assistants and agents:

```
https://<your-memoria-address>/api/agent/v1/mcp
```

It speaks MCP (the standard plug assistants use to work inside other apps)
and asks the app to sign in with your Memoria account. You choose which boards
the app may use. By default it can read, save to your Inbox, comment and
suggest changes. Suggestions wait for your approval in **Settings → Agent
control center**, where you can also undo any change or turn an app's access
off.

## Before you start

- `AUTH_URL` must be the public `https://` address people use to open Memoria.
  Sign-in links are built from it.
- Cloud assistants (Claude, ChatGPT, Gemini) connect from their own servers,
  so your Memoria must be reachable from the internet over `https`. Agents on
  your own computer or network (OpenClaw, Hermes) only need to reach it.
- Make sure you have a board named **Inbox**. New accounts get one.

## Claude

1. Open Claude → Settings → Connectors → Add custom connector.
2. Paste the address above and choose Connect.
3. Sign in to Memoria, pick the boards, and choose Allow access.

## ChatGPT

Full MCP connectors with write actions are in ChatGPT's developer mode, which
OpenAI currently limits to some plans.

1. Settings → Apps → Advanced → Developer mode, then Create app.
2. Paste the address above, choose OAuth, and connect.
3. Sign in to Memoria and allow access.

## OpenClaw

```bash
openclaw mcp add memoria --url https://<your-memoria-address>/api/agent/v1/mcp --transport streamable-http
```

Then set `"auth": "oauth"` on the `memoria` entry under `mcp.servers` in
`~/.openclaw/openclaw.json`, and sign in:

```bash
openclaw mcp login memoria
```

Set `transport` explicitly; without it OpenClaw assumes the older SSE
transport. Start a new session to see the tools (`memoria__inbox_save` and
friends).

## Hermes Agent

Add this to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  memoria:
    url: "https://<your-memoria-address>/api/agent/v1/mcp"
    auth: oauth
```

Then sign in:

```bash
hermes mcp login memoria
```

## Teach your agent when to use Memoria

Install the instruction-only skill in
[`integrations/skills/memoria/SKILL.md`](../../integrations/skills/memoria/SKILL.md).
It tells the agent to save links you share, search when you ask what you
saved, and suggest piles when you ask it to tidy up. It contains no scripts.

- OpenClaw: copy the `memoria` folder into `~/.agents/skills/` (or your
  workspace `skills/` folder).
- Hermes: copy the `memoria` folder into `~/.hermes/skills/`.

## What a connected app can do

| Tool | What it does | Needs your approval? |
| --- | --- | --- |
| `inbox_save` | Saves a link or note to your Inbox | No |
| `items_search`, `items_get`, `items_list` | Finds and reads items on allowed boards | No |
| `inbox_sort` | Groups loose Inbox items into piles | Yes, nothing moves until you approve |
| `piles_propose` | Suggests piles the app chose itself | Yes |
| `piles_apply` | Sorts into piles right away | Only works if you allowed direct changes |
| `actions_approve_suggestion` | Approves a suggestion | Never available to apps |

Saved text is sent to apps labeled as data, not instructions, so a web page
you saved cannot tell your assistant what to do.

## Older integration tokens

Agents that already use a `mat_` integration token keep working: send it as
`Authorization: Bearer mat_…` to the same address.
