# Runtime support

Memoria supports Node.js 26 LTS for its custom Node/WebSocket production
topology. The local gate (`scripts/gate.mjs`) and both production-image stages pin 26.13.0; `package.json`
rejects other major lines so local installs cannot silently test a different
runtime contract. Upgrade the gate pin, both Docker stages, engine range, and the
runtime contract test together after the next LTS line has passed the full
unit, integration, browser, build, and smoke gates.

## Client identity behind a proxy

Rate limits, account lockout and WebSocket connection caps key on the client
address from `src/lib/network/client-ip.ts`. `X-Forwarded-For` is honoured only
when the TCP peer is inside `TRUSTED_PROXY_CIDRS`; with an empty value every
request appears to come from the proxy.

- **Collaboration sockets proxied by the app:** in single-port setups the app
  server forwards `/api/collaboration/*` upgrades to the realtime process
  over a new TCP connection, so the realtime process sees the app as the
  peer. Set the same `COLLABORATION_PROXY_SECRET` (32+ characters) on the app
  and the sync/realtime process: the app then sends the client address it
  derived (with the rules above) in a signed `x-memoria-upgrade-client-ip`
  header, valid for one minute, and the realtime process uses it for
  per-client limits. Any copy a caller sends is removed, and an unsigned or
  stale header is ignored. Without the secret the app logs a warning at
  startup and proxied sockets keep today's behaviour (the app's address,
  unless `TRUSTED_PROXY_CIDRS` covers it). Sockets a gateway routes straight
  to the realtime process are unaffected.
- **Bundled stack:** `pnpm setup --selfhost` writes
  `TRUSTED_PROXY_CIDRS=172.29.47.0/28`, the `edge` network pinned in
  `docker-compose.yml`. Besides the app and sync services, only the Caddy
  gateway is attached to it, so no other peer can be trusted by accident. `app`,
  `sync` and `outbox-worker` receive the value. `pnpm doctor` warns when the
  app is behind a proxy and the value is empty.
- **k3s (note for the `infra` repo):** set `TRUSTED_PROXY_CIDRS` on the app,
  sync and worker Deployments to the CIDR the ingress controller pods connect
  from: the pod CIDR of the ingress namespace (k3s default `10.42.0.0/16`;
  use a narrower range if the CNI allows). Confirm with
  `kubectl get pods -n <ingress-ns> -o wide`. The ingress must append the real
  client to `X-Forwarded-For` (Traefik: `forwardedHeaders.trustedIPs` when it
  sits behind another load balancer). Never trust the whole node or service
  network.
