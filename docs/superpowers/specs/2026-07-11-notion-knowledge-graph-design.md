# Notion Knowledge Graph Design

## Goal

Add a lightweight Obsidian-style knowledge graph to NotionNext. The graph represents relationships between published Notion articles and is available from a global side drawer across most themes.

The graph uses both of these relationship sources:

- Notion page mentions in article content (`@page`).
- All Relation properties in the article database.

Both sources produce the same undirected edge type. Duplicate relationships are merged.

## Product Scope

- Support approximately 50 to 1,000 published articles.
- Include published articles only. Drafts, hidden pages, deleted pages, and external Notion pages are excluded.
- Open from a persistent graph icon available across most themes.
- Default to a local graph centered on the current article with one or two relationship levels.
- Allow switching to the complete graph and returning to the current article.
- Support canvas pan, zoom, node dragging, title hover, and article navigation.
- Do not include search, filtering, node pinning, or advanced graph controls in the first release.
- Treat all relationships as undirected and visually identical.

## Architecture

The system uses request-triggered stale-while-revalidate updates. It does not require a scheduled service or a site rebuild.

1. The visitor opens the knowledge graph drawer.
2. The graph API reads the latest public graph from EdgeOne Blob storage.
3. If the internal refresh state is newer than ten minutes, the API returns the graph without refreshing.
4. If the internal refresh state is stale, the API still returns the existing graph immediately and starts a background refresh.
5. An immutable ten-minute refresh-window claim allows one edge location to start the refresh for that window. Request workers never delete or release claims.
6. A Cloud Function fetches the current published article list, compares `lastEditedDate`, and reparses only changed articles.
7. The function rebuilds the deduplicated graph, writes a unique immutable graph version, then advances a private graph pointer only after that version write succeeds.

The first request on an empty store starts initial generation. The drawer displays a loading state and retries until the first graph is available.

### Runtime Responsibilities

- **Graph API:** Returns the existing graph quickly and decides whether a refresh is due.
- **Cloud Function:** Performs Notion fetching, block parsing, relation extraction, and graph assembly.
- **EdgeOne Blob:** Stores immutable public graph versions, a private graph pointer and refresh state, per-page extraction snapshots, and immutable refresh-window claims.
- **CDN/browser cache:** Reduces repeated graph reads while keeping the drawer responsive.

The heavier update work belongs in a Cloud Function because Edge Functions have a short CPU budget. Blob is available to both Edge and Cloud Functions and supports strong reads and conditional create operations.

## Blob Layout

Use a dedicated Blob store named `notionnext-knowledge-graph` by default.

```text
graph/versions/<id>.json             Immutable public nodes and edges only
state/graph-pointer.json             Private pointer to the current version
state/refresh.json                   Private last successful refresh state
state/refresh-claims/<window>.json   Private immutable ten-minute claim
pages/<page-id>.json                 Private per-page extraction snapshot
```

Each `graph/versions/<id>.json` object contains only:

```json
{
  "nodes": [],
  "edges": []
}
```

It does not expose generation time, schema version, Notion tokens, raw article content, Relation property names, drafts, or error details. Refresh timestamps remain in the private state object.

The API reads `state/graph-pointer.json` with strong consistency, then resolves its immutable graph version. A refresh first writes `graph/versions/<id>.json` with `onlyIfNew: true`; only a successful version write may advance the pointer. If the pointer request has an ambiguous result, it can refer only to a fully written version.

Refresh work uses a deterministic key for each ten-minute window and creates it with `onlyIfNew: true`. Request workers never delete claims, so concurrent callers in the same window have one winner while the next window has a new key. Failed refreshes do not block a later window.

## Extraction Model

Each published article produces one public node:

```json
{
  "id": "notion-page-id",
  "title": "Article title",
  "slug": "article-slug",
  "icon": "optional icon"
}
```

Each edge contains two page IDs:

```json
{
  "source": "article-a",
  "target": "article-b"
}
```

### Extraction Rules

- Scan Notion block data for page mentions in article content.
- Read every Relation property present on an article database page.
- Normalize both sources into the same undirected edge representation.
- Sort the two page IDs before creating the edge key so A-to-B and B-to-A collapse into one edge.
- Keep an edge only when both endpoints are currently published articles.
- Ignore self-links, drafts, hidden pages, deleted pages, and pages outside the published article set.
- Reparse an article when its `lastEditedDate` changes.
- Update node metadata without reparsing unchanged article content when only safe list metadata can be updated directly.
- Remove a node and its edges when an article is unpublished or deleted.
- If one article fails to parse, retain its previous relationship snapshot and continue processing the other articles.

Multiple language databases use each article's resolved public URL. Translation counterparts are not linked automatically; they appear as related only when Notion contains an explicit mention or Relation.

## Frontend Experience

The feature mounts in NotionNext's shared global plugin layer rather than inside one theme. Most themes receive the same graph drawer automatically. Themes with unusual controls use the shared floating launcher as a fallback, with configurable vertical placement to avoid collisions.

### Desktop

- Show a fixed graph icon button on the right edge with a tooltip.
- Open a right-side drawer approximately 420 pixels wide without reflowing article content.
- Provide compact controls for local/full mode, return to current article, and close.

### Mobile

- Use a near-full-screen drawer with a clear close control.
- Default to local mode to limit rendering work.
- Preserve touch pan and pinch zoom behavior.

### Graph Behavior

- On an article page, start with the current article and its configured one- or two-level neighborhood.
- On a non-article page, start with the complete graph.
- Highlight the current article using the site's accent color.
- Render all other nodes and edges with restrained neutral colors.
- Show the full title on hover and navigate to the article when a node is activated.
- Follow the site's current light or dark mode.
- Show an empty relationship state without inventing edges when an article has no connections.

## Performance Controls

- Load the graph component and rendering library dynamically on first drawer open.
- Do not request graph data during normal article page loading.
- Use Canvas 2D rendering rather than one DOM element per node.
- Send only local nodes to the renderer in local mode.
- Pause force simulation and rendering activity when the drawer is closed.
- Stop or cool down layout calculations after the graph stabilizes.
- Do not load article cover images into graph nodes.
- Keep the public JSON compact enough for the 1,000-node target and serve it with compression and cache headers.
- Provide a global `KNOWLEDGE_GRAPH_ENABLE` switch. Disabled mode must add no graph request or runtime library cost.

## Configuration

```text
KNOWLEDGE_GRAPH_ENABLE
KNOWLEDGE_GRAPH_REFRESH_MINUTES=10
KNOWLEDGE_GRAPH_DEPTH=2
KNOWLEDGE_GRAPH_STORE=notionnext-knowledge-graph
```

All Relation properties are included in the first release. A Relation property allowlist is intentionally deferred until a real exclusion need exists.

## Failure Handling

- Return the previous graph when Notion is temporarily unavailable.
- Preserve the previous page snapshot when one article cannot be parsed.
- Show a contained unavailable state when Blob cannot be read; the article page remains functional.
- Retry initial graph loading while first-time generation is running.
- Keep the previous graph pointer when a new version write fails; a later refresh window may retry.
- Contain frontend chunk or renderer failures inside the drawer so navigation and article rendering continue working.
- Log server-side update failures without exposing internal details through the public graph API.

## Testing Strategy

Notion and EdgeOne Blob are external APIs, so tests must be grounded in observed behavior.

1. Capture sanitized fixtures from a real Notion database containing both a page mention and a Relation property.
2. Write extraction tests that fail before implementation, then verify they pass after implementation.
3. Cover edge deduplication, undirected normalization, self-link removal, draft filtering, unpublishing, deletion, and per-page failure fallback.
4. Verify Blob strong pointer reads, conditional refresh-window claims, immutable version publication order, and pointer resolution against the real EdgeOne Blob service, not only mocks.
5. Test graph payload and rendering behavior with 50, 500, and 1,000-node fixtures.
6. Verify the drawer on desktop and mobile, including dark mode, collision-free controls, loading and empty states, and node navigation.
7. After deployment, create a real Notion relationship, wait until the graph becomes stale, open the drawer, and confirm that the production graph updates after the background refresh.

## Acceptance Criteria

- Opening an existing graph does not wait for a Notion request.
- Normal article visits do not load the graph renderer or graph JSON.
- When the graph is accessed after ten minutes of staleness, a background refresh is attempted.
- Duplicate page mentions and Relation values produce one undirected edge.
- Public graph data contains published article nodes and valid edges only.
- A graph failure never prevents the website or article content from loading.
- The local graph remains responsive on mobile, and the complete graph remains usable at 1,000 nodes on mainstream desktop browsers.
- Switching among most NotionNext themes retains access to the shared graph drawer.

## Deferred Scope

- Search, category filtering, tag filtering, node pinning, and advanced graph editing.
- Distinct visual styles for page mentions and Relation properties.
- Automatic links between translated versions of an article.
- Guaranteed background updates when the graph receives no visitors.
- Per-theme custom drawer implementations for every NotionNext theme.
