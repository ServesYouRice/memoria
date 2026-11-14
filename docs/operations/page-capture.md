# Page capture (optional)

A deployment can keep a picture and a PDF of each saved link, so the page can
be seen as it looked on the day it was saved. People open them from
**Read saved copy** on the bookmark. It is off by default and nothing extra
runs unless you turn it on; the standard and the small set-up do not include
it.

## Turning it on

1. Set `PAGE_CAPTURE=true` for the stack (`.env`). The normal outbox worker
   then queues one `link.capture` job for each link it enriches. Links saved
   before the switch are not captured.
2. Start the capture worker, which is its own process and image with a
   headless browser (Chromium from Alpine):

   ```bash
   COMPOSE_PROFILES=capture docker compose up -d --build capture-worker
   ```

   Without it the jobs wait in the outbox. With `PAGE_CAPTURE` unset or
   `false` the worker refuses to start, queued jobs are dropped unread, and no
   new ones are queued.

The worker takes one page at a time (`CAPTURE_CONCURRENCY`), and the compose
service caps it at 1 GiB of memory (`CAPTURE_MEMORY_LIMIT`), 512 MiB of
`/tmp` and shared memory, 512 processes and no capabilities. The browser's own
sandbox cannot start in that container, so `CAPTURE_BROWSER_NO_SANDBOX=true`
turns it off and the container limits stand in for it.

## The browser cannot reach internal addresses

The saved address is checked first (the same SSRF check every server-side
fetch uses) and a private or internal address is refused before any browser
starts. The browser itself has no network of its own:

- it is started with every connection sent to a local proxy
  (`src/lib/capture/egress-proxy.ts`, loopback only) and its own name lookups
  are switched off, so nothing reaches the network except through the proxy;
- the proxy resolves each name itself, refuses private, loopback, link-local
  and other internal addresses (IPv4 and IPv6), and dials the exact address it
  checked, which also closes the DNS-rebinding gap;
- this holds for the page, for redirects, and for everything the page loads
  (scripts, frames, images, WebSocket). Loopback names are sent through the
  proxy too, where they are refused;
- only ports 80 and 443 are allowed; WebRTC and QUIC, which would skip the
  proxy, are switched off; service workers and downloads are blocked, and
  only `http`, `https`, `data` and `blob` addresses may load.

## Limits

| Limit | Value |
| --- | --- |
| Time for one capture | 75 s (page load 30 s, then up to 5 s to settle); the job's deadline is 120 s |
| Requests the page may make | 250; 24 connections open at once |
| Download for one capture | 40 MiB in total, then every connection is cut |
| Picture | JPEG of the top 12,000 px at 1280 px wide, up to 3 MiB (else dropped) |
| PDF | up to 8 MiB (else dropped) |
| Per account | at most half of the upload quota (`LAUNCH_LIMITS`: 250 files, 50 MiB) |

The values live in `RESOURCE_BUDGETS.pageCapture`. A page over a limit, or at
a refused address, is not retried and keeps no capture; a page that failed to
load is tried up to three times.

## Storage, quota, export and deletion

The picture and PDF are ordinary uploads (`UploadAsset`, object key
`captures/<id>/...`) in the same object storage, owned by the canvas owner:

- they count toward the person's upload quota, and captures stop once the
  account has used half of it, so they never crowd out the person's own
  uploads;
- they are included in the account export like every other upload;
- they are deleted with the canvas and with the account. When a link is
  deleted for good (trash retention, or a replaced address), the `retention.trash`
  run queues deletion of its files and releases their quota. A reservation a
  crashed capture left behind is cleaned up after a day;
- the files are served only through
  `/api/v1/canvas-items/{itemId}/page-capture/{image|pdf}`, which checks that
  the person may view the canvas.

## Running it twice

A job is keyed by link and address, its files are named by an id fixed when the
job was queued, and the job does nothing when a capture of the current address
exists. A retry after a crash reuses a finished file or resumes a reservation
instead of charging again.
