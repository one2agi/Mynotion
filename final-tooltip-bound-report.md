# Final Tooltip Bound Report

Date: 2026-07-12

## Scope

Bound the knowledge-graph tooltip so long titles remain readable inside the
canvas container without changing the existing horizontal pointer clamp.

## Behavior

- The tooltip keeps its existing maximum width and now scrolls when content
  exceeds its bounds.
- Its maximum height is calculated from the pointer to the nearest vertical
  container edge, leaving the existing 8px padding clear.
- A pointer in the top half places the tooltip below the pointer; otherwise it
  places it above the pointer.
- Leaving the tooltip container clears the active tooltip.

## TDD Evidence

The new long hostile-title regression test was run before the implementation
and failed because the tooltip had no `maxHeight`. After the minimal behavior
change, the same test passed. The test confirms literal React text rendering,
no injected image element, bounded vertical space, below-pointer placement,
and the existing horizontal clamp class. A companion test verifies container
`onPointerLeave` clears the tooltip.

## Verification

- Knowledge-graph component suites: 35 tests passed.
- TypeScript check: passed.
- Target-file Prettier check: passed.
- Git diff whitespace check: passed.
