# EdgeOne Knowledge Graph Bundle Fix Design

## Problem

The Next.js application build succeeds, but EdgeOne fails while bundling
`cloud-functions/api/knowledge-graph.ts`. The function imports
`fetchGlobalAllData` from `lib/db/SiteDataApi.js`. That module's dependency
graph reaches React and theme files containing JSX in `.js` files. EdgeOne's
function esbuild loader parses those files as plain JavaScript and rejects the
JSX syntax.

## Decision

Add a dedicated server-only Notion data source for the knowledge graph. The
cloud function will use this source instead of `SiteDataApi`. The source will
return only the metadata required by graph refresh:

- canonical page ID
- title and slug
- resolved article href
- page icon when available
- type and publication status
- last edited timestamp
- raw database properties, including Relation values
- normalized database schema

The source must not import React, theme modules, `lib/global.js`, the
`lib/utils/index.js` barrel, or `SiteDataApi`.

## Data Flow

1. The cloud function reads each configured Notion database using the existing
   low-level Notion block fetcher.
2. The server-only source identifies the selected collection and page IDs,
   normalizes the schema, and maps database page properties to the graph's
   minimal metadata contract.
3. `refreshKnowledgeGraph` selects published `Post` pages and compares their
   edit timestamps with stored snapshots.
4. Only changed pages have their full block maps fetched.
5. Existing extraction combines Relation values from page properties with
   page mentions found in the full block maps.
6. Existing graph building, EdgeOne Blob publication, caching, and frontend
   behavior remain unchanged.

## Association Compatibility

Both approved association sources remain enabled and indistinguishable:

- Database Relation properties are retained as raw Notion property values and
  interpreted using the normalized schema.
- Inline `@page` mentions are still extracted from changed article block maps.

The final edge list continues to deduplicate both sources into ordinary,
undirected graph edges.

## Failure Behavior

- A missing database, collection, schema, or page list is an explicit refresh
  failure; the prior published graph remains available.
- A malformed or unpublished page is excluded without exposing draft data.
- A changed page whose block fetch fails keeps its prior snapshot, matching the
  existing stale-safe behavior.
- Multi-language database aggregation remains fail-closed: one failed locale
  prevents publication of a partially refreshed graph.

## Testing

1. Add source-level tests using sanitized real Notion record-map fixtures for
   page metadata and Relation property shapes.
2. Add an import-boundary regression test proving the cloud function no longer
   references `SiteDataApi` and its production dependency graph excludes the
   known JSX-bearing frontend modules.
3. Preserve existing extraction tests for real Relation and page-mention
   fixtures.
4. Run the targeted tests red before implementation and green afterward.
5. Run the complete Jest suite, TypeScript check, lint, and Next.js production
   build.
6. Run the actual EdgeOne function build or equivalent EdgeOne CLI packaging
   command and confirm the three JSX loader errors are absent.

## Scope

This fix changes only the knowledge graph's server-side source boundary. It
does not change graph UI, graph semantics, refresh intervals, Blob keys,
Notion database fields, themes, or unrelated `SiteDataApi` consumers.
