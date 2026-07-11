# Final Knowledge Graph Boundary Fix Report

## Scope

Resolved the final two knowledge graph review findings without changing graph
storage, refresh scheduling, or public API payloads.

- Frontend current-page UUIDs now use the same canonical rule as the backend:
  remove hyphens, lowercase, and require a 32-character hexadecimal ID.
- Server refresh configuration now enforces the product minimum of 10 minutes.

## Implementation

- Added `lib/knowledge-graph/normalizePageId.ts`, a dependency-free helper that
  both browser and server graph code can import safely.
- Kept `normalizePageId` re-exported from `extract.ts` so existing backend
  callers retain their current interface.
- Updated the frontend graph view to use the shared canonical helper for UUIDs
  while retaining non-UUID IDs unchanged for existing local graph behavior.
- Changed server parsing so non-finite values and values below 10 (including
  `0` and `2`) resolve to 10; finite values at or above 10 remain valid.
- Clarified the minimum in `.env.example`.

## TDD Evidence

Before implementation, the targeted test run failed in the two expected ways:

- An uppercase, hyphenated UUID did not match the canonical graph node, so the
  drawer showed all three nodes instead of the current article neighborhood.
- `KNOWLEDGE_GRAPH_REFRESH_MINUTES=2` resolved to `2` instead of `10`.

After the minimal implementation, the same targeted suite passed 39 tests.

## Final Verification

- Focused knowledge graph suite: 10 suites, 93 tests passed.
- `pnpm type-check` passed.
- Prettier passed for all changed code, test, and report files.
- `git diff --check` passed.

## Boundary Review

- The shared normalizer has no Node APIs or server imports, so it is safe in
  the frontend bundle.
- The unchanged fallback for non-UUID frontend IDs preserves existing local
  graph behavior; real Notion page IDs follow the shared backend canonical rule.
- Ten minutes is both the default and the enforced floor, keeping immutable
  refresh claims aligned with their fixed ten-minute windows.
