# Knowledge Graph Pointer And Pan Inertia Design

## Goal

Make node dragging reliable across zoom levels and make background panning feel lightly inertial without adding persistent animation or user-facing settings.

## Fixed Interaction Contract

- The invisible node pointer area covers the full rendered node radius plus 4 screen pixels of tolerance.
- The tolerance remains 4 screen pixels at every zoom level.
- Pointer contact anywhere inside that area can begin node dragging.
- Node dragging never starts canvas inertia.
- Background panning samples recent pointer velocity while the primary button is held.
- Releasing during a quick pan continues movement briefly in the release direction.
- Holding still for 300 ms before release clears velocity and produces no inertia.
- Inertia lasts at most 240 ms and cannot move farther than 120 screen pixels.
- A new pointer press, wheel gesture, node drag, inactive canvas, or component unmount cancels inertia immediately.
- Reduced-motion preference disables inertia but keeps the improved node hit area.
- These values are internal constants and are not exposed in graph settings.

## Architecture

Use the force-graph `nodePointerAreaPaint` callback to paint an invisible hit circle that matches the custom Canvas node rendering. Keep the library's existing node drag and background pan behavior. Add a small pointer-session velocity tracker around the Canvas container; after a qualifying background release, project the release velocity over a fixed 160 ms window and animate the viewport center along one cubic ease-out trajectory with `requestAnimationFrame`.

The inertia animation operates only after release, uses the current zoom to convert screen movement to graph coordinates, and caps the projected displacement before starting the fixed-duration trajectory. It does not reheat the force simulation.

## Verification

Automated tests must cover exact visual-radius hits, zoom-independent 4 px tolerance, node drag suppression, quick-release inertia, stationary-before-release cancellation, displacement and duration bounds, cancellation inputs, reduced motion, and cleanup on unmount. Existing click suppression, selection, zoom, drag, and renderer tests must continue to pass.
