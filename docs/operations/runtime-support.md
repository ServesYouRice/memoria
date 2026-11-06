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
