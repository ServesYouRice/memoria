# Runtime support

Memoria supports Node.js 24 LTS for its custom Node/WebSocket production
topology. CI and both production-image stages pin 24.20.0; `package.json`
rejects other major lines so local installs cannot silently test a different
runtime contract. Upgrade the CI pin, both Docker stages, engine range, and the
runtime contract test together after the next LTS line has passed the full
unit, integration, browser, build, and smoke gates.
