Title: Autosave Delta Updates and Optimistic Concurrency
Date: 2025-11-09
Status: Accepted
Owners: CodexCLI

Decision
- Send debounced deltas for item move/resize in 250–500ms windows.
- Require `version` match on updates; reject stale writes and refetch.

Consequences
- Lower write amplification; prevents clobbering across tabs.

References
- SENATE.md §3.10 Autosave & Concurrency (Accepted)
