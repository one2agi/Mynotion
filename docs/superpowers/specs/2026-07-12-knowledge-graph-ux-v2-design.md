# Knowledge Graph UX V2 Design

## Goal

Improve the NotionNext knowledge graph as a calm, lightweight 2D exploration
tool for 50-1000 published pages. The work must fix false relationships before
changing presentation, preserve EdgeOne's low-resource operating model, and
remain local until the user explicitly requests deployment.

## Confirmed Product Decisions

- The graph is a flat 2D canvas. It must not use 3D perspective, rotation, or
  depth effects.
- Relation properties and inline Notion page mentions remain visually
  indistinguishable. Both render as ordinary lines without arrows.
- Direction is retained internally so a local graph can show only links made
  by the selected page.
- A node click selects and focuses the node. Navigation happens only through
  an explicit Open article action.
- The desktop drawer occupies approximately one third of the viewport.
- The launcher can be dragged and remembers its local browser position.
- Renderer preferences are client-only. They must not add API calls or EdgeOne
  storage writes.
- No production deployment, remote push, or merge is part of this work.

## 1. Relationship Correctness

### Root cause

notion-client getPage returns a record map that can contain blocks belonging
to linked pages. The current mention extractor scans every block in that map,
so page mentions from attached records are incorrectly attributed to the page
being refreshed.

This was reproduced with:

B 站 Notion 人生管理系统 + AI 赋能视频：0 粉精准定位与流量破局指南

The current public graph reports four neighbors. A page-scoped scan shows that
the valid neighbors are only:

- 认知革命
- 设计理念：知行合一的精髓与哲学

Terms of Use — WeRead2Notion and Privacy Policy — WeRead2Notion are false
positives.

### Extraction boundary

For a requested page:

1. Include the requested page block itself.
2. Include a block only when following its parent_id chain reaches the
   requested page.
3. Exclude attached records whose parent chain belongs to another page.
4. Read Relation values only from the requested database page's properties.
5. Read inline page mentions only from the requested page and its descendants.
6. Remove self-links and normalize Notion IDs before deduplication.

Relation and mention links are merged into one outbound target set. Their
source type is not exposed.

### Direction without visual arrows

Each visual edge keeps deterministic unordered endpoints for rendering and an
origins array containing the page IDs that actively link across that edge.
Mutual links use one visual line with both page IDs in origins.

The full graph renders every edge. A local graph traverses only an edge whose
origins contains the currently expanded node. Existing payloads without
origins use the old undirected behavior as a compatibility fallback.

## 2. Calm 2D Motion

The existing react-force-graph-2d renderer remains in place. No graph engine
or 3D dependency is added.

Default motion behavior:

- Start from a modest simulation energy.
- Use stronger velocity damping than the current implementation.
- Settle and pause after a bounded cooldown.
- Restart briefly only after a graph or force-setting change.
- During node drag, follow the pointer directly with mild neighboring motion.
- On release, settle quickly without an elastic overshoot.
- Keep zoom within a restrained minimum and maximum.
- When prefers-reduced-motion is active, minimize settling animation and
  disable decorative transitions.

The renderer must not continuously animate after the graph has stabilized.

## 3. Lightweight Graph Settings

Obsidian separates graph controls into Display and Forces. The same mental
model is retained with fewer controls and conservative ranges. Reference:
[Obsidian Graph View](https://help.obsidian.md/plugins/graph).

### Display

- Local depth: 1 or 2
- Label mode: Auto, Always, or Hidden
- Label opacity
- Node size
- Link thickness

### Forces

- Center force
- Repel force
- Link force
- Link distance

### Settings behavior

- The controls live in a collapsible settings section inside the drawer.
- Values update the current graph with a short debounced simulation restart.
- Values are persisted under one versioned localStorage key.
- Invalid or stale persisted values are clamped to supported ranges.
- Reset restores the product defaults.
- Auto labels show selected and hovered labels at any zoom, then reveal
  additional labels only above a zoom threshold.

No setting changes graph API data, Blob state, Notion data, or EdgeOne
configuration.

## 4. Launcher and Drawer

### Launcher

- Drag with pointer events and a small movement threshold.
- Clamp the button inside the viewport safe area.
- A movement below the threshold remains a click.
- Persist the final position locally and clamp it again after resize.
- Keep the existing keyboard-accessible click behavior.

### Drawer

- Desktop width: clamp(360px, 33.333vw, 520px).
- Mobile width: full viewport width.
- The drawer remains docked to the right for predictable reading and does not
  float around with the launcher.
- The canvas resizes through the existing ResizeObserver.
- Controls, canvas, and node details are separate unframed regions; no nested
  cards are introduced.

## 5. Node Focus and Related Pages

Single-clicking a node:

1. Selects and gently recenters it.
2. Highlights the selected node, its outbound edges, and outbound neighbors.
3. Reduces opacity for unrelated nodes and edges.
4. Opens a compact details region with the page title and outbound related
   page list.

Clicking a related page name changes the graph focus. An explicit Open article
button navigates to the canonical allLinkPages URL. Clicking canvas background
clears selection. Dragging a node must never navigate.

The details region has an accessible list fallback, so related pages remain
usable without precise canvas pointer control.

## 6. Performance Budget

- Keep Canvas 2D and the existing dynamically loaded graph bundle.
- Do not add a graph dependency.
- Do not add backend requests for renderer preferences.
- Pause animation after cooldown and while the drawer is closed.
- Memoize display data and adjacency indexes.
- Avoid drawing all labels by default.
- Debounce force-setting changes before reheating the simulation.
- Validate behavior with fixtures representing 50, 500, and 1000 nodes.

The graph API and refresh interval remain unchanged except for corrected link
extraction and compact direction metadata.

## 7. Component Boundaries

### Data worker

Owns page-scoped extraction, direction metadata, graph construction, local
neighborhood semantics, and regression tests.

### Renderer worker

Owns canvas drawing, force configuration, reduced-motion behavior, focus
styling, zoom bounds, and scale/performance tests.

### UI worker

Owns the draggable launcher, drawer sizing, settings controls, preference
storage, node detail list, and interaction tests.

The workers must use disjoint write sets where possible. Integration changes
that cross boundaries are reviewed and applied after each worker result.

## 8. Testing and Acceptance

### Data acceptance

- The reproduced Bilibili article has exactly two valid outbound neighbors.
- Attached linked-page records cannot create false mentions.
- Relation and inline mentions deduplicate.
- Mutual links render once and preserve both origins.
- Local depth traversal follows outbound direction.
- Full graph still includes every valid visual edge.

### Interaction acceptance

- Dragging a node is smooth and never navigates.
- Selecting a node highlights only its outbound neighborhood.
- Related pages are listed and can receive focus.
- Open article uses the canonical resolved URL.
- Launcher dragging is bounded, click-safe, persistent, and keyboard-safe.
- Drawer is one-third width on desktop and full width on mobile.
- Settings persist, clamp, reset, and do not make network requests.

### Performance acceptance

- 50-, 500-, and 1000-node fixtures render a nonblank graph.
- The simulation pauses after stabilization.
- Closing the drawer pauses work.
- No overlap or text overflow appears at desktop and mobile viewports.

### Verification

- Focused Jest suites for each boundary.
- Full pnpm test, pnpm type-check, and pnpm lint.
- Production pnpm build.
- Local EdgeOne makers dev API verification.
- Browser screenshots and interaction checks at desktop and mobile sizes.
