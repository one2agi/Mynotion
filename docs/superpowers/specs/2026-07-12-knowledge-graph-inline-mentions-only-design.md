# Knowledge Graph Inline Mentions Only Design

## Goal

Make every public graph edge understandable from article content. The public
knowledge graph will use only explicit Notion page mentions in the article
body. Database relation properties, including `相关引用`, will not create public
edges.

## Relationship Contract

- A published article body containing a Notion `@页面` mention of another
  published article creates one ordinary graph edge between the two pages.
- Edges are visually undirected. If A mentions B, B mentions A, or both pages
  mention each other, the graph contains exactly one A-B edge.
- Database relation properties do not create edges.
- Ordinary hyperlinks, including links to another article on the same site, do
  not create edges.
- Mentions to unpublished pages or pages outside the published article set are
  ignored because no public graph node exists for the target.
- Self-mentions do not create edges.

## Data Flow

1. The graph refresh obtains the published article list as it does today.
2. For each changed article, the refresh fetches its Notion block record map.
3. The extractor walks only blocks belonging to that article and collects
   Notion page-mention decorations from body content.
4. The refresh stores only those normalized mention targets in the page
   snapshot. It does not merge relation-property values into the snapshot.
5. The graph builder filters targets against published nodes, canonicalizes the
   two endpoint IDs, and deduplicates reciprocal mentions into one edge.
6. A new cache namespace invalidates snapshots generated under the previous
   relation-plus-mention contract.

## Scope Of Change

- Remove relation-property extraction from the public graph refresh path.
- Keep the general-purpose relation extraction helper only if another caller
  still needs it; otherwise remove it and its relation-specific tests.
- Remove graph-refresh behavior and tests that merge current relation values
  into unchanged snapshots.
- Do not remove or modify the Notion database's `相关引用` property. It remains
  available for private authoring and database organization.
- Do not add edge types, arrows, legends, filters, or additional UI controls.
  All retained edges use the existing ordinary-line presentation.

## Refresh And Failure Behavior

The existing incremental refresh behavior remains unchanged for body content:
unchanged pages reuse their stored mention snapshot, changed pages fetch fresh
blocks, and a failed page fetch falls back to its prior snapshot. Changing only
`相关引用` must not change the graph. Changing a body `@页面` mention is reflected
when the article's block edit timestamp is observed by a later graph refresh.

## Verification

Automated tests will prove:

- A body mention from A to B creates one edge.
- Reciprocal body mentions still create only one edge.
- A relation-property value without a body mention creates no edge.
- A relation-property value plus a different body mention creates only the
  body-mention edge.
- Ordinary internal hyperlinks do not create edges.
- Foreign-page blocks and self-mentions remain excluded.
- Legacy relation-aware snapshots are ignored after the cache namespace bump.

Focused knowledge-graph tests, TypeScript checking, formatting, and scoped lint
must pass before local browser verification. Local verification will confirm
that the design article shows only edges justified by its body mentions.
