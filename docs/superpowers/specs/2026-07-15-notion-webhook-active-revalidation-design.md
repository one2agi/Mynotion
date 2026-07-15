# Notion Webhook Active Revalidation Design

**Date:** 2026-07-15

**Status:** Approved design; implementation not started

## Goal

Make Notion content changes visible to the first real visitor without waiting
for that visitor to trigger ISR. Updates should normally reach production
within one to two minutes while preserving the existing five-minute ISR,
Cloudflare Worker/direct Notion transport, retries, Redis cache, and stale-data
fallback.

The feature covers all public-content changes:

- body edits;
- title, summary, slug, category, tag, and publication-property edits;
- page creation, deletion, restoration, and movement;
- publishing and unpublishing.

Blog comments remain a separate, dynamically loaded subsystem.

## Constraints

- The production topology remains one Next.js container and one Redis container
  on the Tencent VPS.
- Notion content reads continue to use the existing Worker-first transport,
  direct Notion fallback, retry policy, and Redis fallback.
- Existing public ISR remains at five minutes as the final safety net.
- A failed refresh must never overwrite a successful cache with empty data.
- An unpublished, drafted, or deleted article must not remain public through a
  stale-content fallback.
- The implementation must reuse the existing on-demand revalidation and
  knowledge-graph refresh logic instead of creating parallel systems.
- Webhook secrets must not enter Git, Docker image layers, request logs, or
  application logs.

## Selected Approach

Use an official Notion Connection webhook as the primary change signal. The
public webhook handler verifies the request and records dirty page IDs in
Redis, then returns immediately. A VPS systemd timer calls the existing
`/api/revalidate` endpoint once per minute to consume the dirty set.

The one-minute timer only checks local Redis. It does not poll Notion when the
dirty set is empty.

```text
Notion Connection
        |
        | signed webhook
        v
POST /api/notion-webhook
        |
        | verify raw body + enqueue page ID
        v
Redis notion:refresh:dirty
        |
        | systemd timer, once per minute
        v
POST /api/revalidate { "dirty": true }
        |
        | one fresh metadata read + route diff
        v
Existing ISR + existing knowledge-graph refresh
```

## Reused Capabilities

The implementation must reuse these existing contracts:

- `pages/api/revalidate.js` for token authentication, path normalization, and
  `res.revalidate()` calls;
- `getPageBlockCacheKey(pageId, lastEditedDate)` for versioned article-body
  cache keys;
- `refreshKnowledgeGraph()` for graph locking, `lastEditedDate` comparison,
  incremental block fetching, publication, and stale graph fallback;
- `fetchGlobalAllData()` and the current retry/cache chain for site metadata;
- the Worker/direct Notion transport and its 60-second circuit breaker;
- Redis seven-day fallback and empty-value rejection.

The Webhook feature must not implement a second article cache, graph snapshot,
transport retry layer, or on-demand revalidation endpoint.

## Components

### 1. Notion webhook receiver

Add `POST /api/notion-webhook` with the Next.js body parser disabled so the
exact raw request bytes remain available for signature verification.

Subscribe only to these official page events:

- `page.content_updated`;
- `page.properties_updated`;
- `page.created`;
- `page.deleted`;
- `page.undeleted`;
- `page.moved`.

Do not subscribe to native Notion comment events or database/data-source schema
events.

For normal events the handler must:

1. read the raw body with a strict size limit;
2. validate `X-Notion-Signature` using HMAC-SHA256 and a constant-time
   comparison;
3. validate the supported event type and a normalized page ID;
4. add or update the page ID in the Redis dirty sorted set;
5. return HTTP 200 only after Redis confirms the write.

Invalid signatures return 401. Unsupported events return 200 with an ignored
result so Notion does not retry irrelevant events. A Redis write failure
returns 503 so Notion can retry delivery.

### 2. One-time subscription verification

When Notion creates a subscription it sends a one-time
`verification_token`. During explicit setup mode only, the webhook endpoint
writes that token to a mode-600 temporary file inside the app container and
does not print it to application logs. The deployment helper reads it through
`docker exec`; no new host volume is required.

A deployment helper performs the controlled setup sequence:

1. enable setup mode for the webhook endpoint;
2. create the Notion subscription;
3. retrieve the temporary token through SSH and `docker exec`;
4. store it as `NOTION_WEBHOOK_VERIFICATION_TOKEN` in
   `/opt/notionnext/.env.production`;
5. let the operator paste the same value into Notion's verification form;
6. delete the temporary file, disable setup mode, and recreate only the app
   container. Container recreation also removes any abandoned setup file.

The setup token is never committed or included in the Docker image.

### 3. Redis dirty set

Use one sorted set:

```text
key:    notion:refresh:dirty
member: normalized Notion page ID
score:  latest webhook event timestamp in milliseconds
```

Use `ZADD GT` semantics. Repeated delivery of the same event does not add a
second job, and a newer event for the same page only advances its score. No
separate seven-day webhook-event-ID store is required.

The consumer selects items whose latest event has been quiet for at least 60
seconds. This debounces frequent typing and property edits into one refresh.

Items are removed only after all required refresh work for that page succeeds.
A failed item remains in the set for the next timer run.

### 4. Route metadata snapshot

Store one small Redis record per published page containing only route-affecting
metadata:

- stable page ID;
- slug and canonical href;
- publication status and page type;
- `lastEditedDate`;
- category names;
- tag names;
- last successfully processed webhook timestamp.

This snapshot exists only to compare old and new routes, preserve old-slug
redirects, and distinguish a true fresh read from an unchanged stale fallback.
It does not contain article bodies and does not duplicate the knowledge-graph
snapshot.

Freshness is determined by comparison with the prior successful snapshot, not
by requiring `lastEditedDate` to be greater than the webhook delivery
timestamp. Webhook delivery naturally occurs after the underlying edit.

### 5. Dirty-set consumption through the existing revalidation endpoint

Extend `POST /api/revalidate` with an authenticated `{ "dirty": true }`
operation. Existing single-path, multi-path, and full operations remain
compatible.

Before reading the new directory, delete only the short-lived cache entries
for the relevant `site_*` and `global_data_*` keys. Do not delete
`fallback:*` keys.

The consumer then performs one metadata read through the existing Notion
transport and compares it with the route snapshots. If the read falls back to
old data and no expected metadata change can be confirmed, the job stays
queued.

An event for a page that has never belonged to the blog database is
acknowledged and removed after the fresh directory confirms it is irrelevant.
This prevents a dedicated Connection from accumulating unrelated page events
if its access is expanded later.

The systemd timer calls this operation over `127.0.0.1:3030` with the existing
revalidation bearer token. A single named systemd service is used so a still
running invocation is not started a second time.

## Refresh Rules

The route set is derived from both the old snapshot and the latest metadata.

| Change | Required action |
| --- | --- |
| Body only | Revalidate the canonical article; refresh the knowledge graph |
| Title or summary | Revalidate the article, home, archive, and search landing |
| Category or tags | Revalidate the article plus affected old/new category and tag routes and their known pagination |
| Slug | Save an old-to-new permanent redirect and revalidate both paths plus listing pages |
| Newly published | Revalidate the new article and all affected list/pagination routes; refresh the graph |
| Drafted, unpublished, or deleted | Remove from lists and graph; revalidate the article to 404; never expose stale body content |
| Restored | Treat as newly published using the current metadata |

When publication membership changes, known home, archive, category, tag, and
pagination routes are derived from the current site metadata and revalidated.

The `/search` landing page is actively refreshed. Arbitrary historical
`/search/<keyword>` routes cannot be enumerated, so they retain the existing
five-minute ISR fallback.

## Old-slug redirects

When a stable page ID changes from one slug to another, save an old-path to
new-path mapping in Redis. Article `getStaticProps` resolution checks this map
only after normal slug and UUID resolution fail, and returns a permanent Next.js
redirect to the latest canonical path.

Redirect chains are flattened to the newest canonical path. A redirect must
never override an active page that later claims the old slug. Redirect records
remain available for external links and search engines.

## Unpublished-content safety

Availability fallback and publication authorization are separate concerns.
Redis stale article bodies may be used only while the latest successful route
snapshot still marks the page as public.

Once fresh metadata confirms Draft, unpublished, deleted, or a non-public page
type:

- remove the public route snapshot;
- remove the page from public lists and the graph;
- revalidate the old public path to `notFound`;
- do not serve the seven-day article fallback for that public route.

Comment rows are retained privately when an article is removed.

## Comment boundary

Blog comments remain dynamic and outside article ISR:

- the browser loads them from `/api/notion-comments` when the comment area
  becomes visible;
- a successful submission reloads the comment list immediately;
- comments are keyed by stable article page ID, so a slug change does not split
  the thread;
- comment creation, reply, or moderation does not enqueue article
  revalidation;
- native Notion `comment.*` webhook events are not subscribed;
- removed articles keep their comment data for restoration or audit, but the
  comments are no longer publicly reachable through the article.

Live updates inside an already-open comment panel are out of scope. A page or
comment-panel reload retrieves the latest comments.

## Failure Handling

- Invalid or missing webhook signature: return 401 and do not enqueue.
- Unsupported, structurally valid event: acknowledge and ignore.
- Redis enqueue failure: return 503 so Notion can retry.
- Notion metadata or article fetch failure: retain the dirty item.
- Partial route revalidation failure: retain that page's dirty item and report
  per-path results without deleting successful cache data.
- Worker channel failure: existing direct fallback applies.
- Worker and direct Notion failure: existing Redis/stale fallback keeps the
  last public version available, except for pages already confirmed private.
- Timer or webhook suspension: existing five-minute ISR remains operational.
- A malformed or empty Notion response never replaces the last successful
  cache or route snapshot.

## Observability

Log only operational metadata:

- event type and normalized page ID;
- enqueue result;
- number of quiet dirty items consumed;
- paths requested, succeeded, and failed;
- elapsed milliseconds and selected Notion transport channel;
- queue depth after processing.

Never log request bodies, verification tokens, HMAC signatures, Notion tokens,
or article/comment content. systemd journal is the primary execution history.

## Deployment

1. Deploy code and the webhook setup helper using the existing local-build VPS
   workflow.
2. Create a dedicated official Notion Connection with read access to the blog
   database.
3. Create and verify the webhook subscription through the controlled token
   setup flow.
4. Subscribe to the six selected page event types.
5. Install and enable a systemd service and one-minute timer that call the
   authenticated dirty operation on localhost.
6. Run real event acceptance tests before declaring the feature active.

The public webhook URL is:

```text
https://www.one2agi.com/api/notion-webhook
```

## Testing Strategy

### Real external fixtures first

Before writing behavioral mocks, capture and redact real payloads from the
official subscription:

- verification request;
- `page.content_updated`;
- `page.properties_updated`;
- `page.created`;
- `page.deleted` and `page.undeleted`.

Fixtures preserve payload structure and headers but replace workspace, user,
page, subscription, integration, token, and signature values.

### Automated tests

- raw-body HMAC success and failure;
- body-size and method restrictions;
- unsupported event acknowledgement;
- Redis enqueue success/failure;
- `ZADD GT` deduplication and 60-second quiet window;
- short-cache invalidation without fallback deletion;
- route snapshot comparison;
- body, property, category, tag, slug, publication, deletion, and restoration
  route plans;
- permanent redirect lookup and chain flattening;
- active slug taking precedence over an old redirect;
- unpublished page refusing stale body fallback;
- partial failure retaining the dirty item;
- existing revalidation operations remaining backward compatible;
- existing graph refresh, comment submission/reply/moderation, transport, and
  cache regression suites.

### Production acceptance

Use a dedicated published test article and verify with real Notion operations:

1. body edit appears without a real visitor triggering ISR;
2. title and summary update list pages;
3. slug change makes the new URL current and the old URL permanently redirect;
4. category and tag changes update both old and new listings;
5. Draft/unpublish removes the article and returns 404 without stale leakage;
6. restore republishes the article;
7. inline `@page` relationship edits update the graph;
8. comment publish/reply/moderation works without article revalidation;
9. each accepted change becomes visible within one to two minutes;
10. disabling the Worker proves direct fallback, and pausing the webhook/timer
    proves five-minute ISR still operates.

## Rollback

Rollback does not require deleting content caches:

1. pause the Notion webhook subscription;
2. disable the systemd timer;
3. leave or remove the dirty Redis set;
4. optionally remove webhook environment variables and recreate only the app
   container.

Existing five-minute ISR, Worker/direct transport, Redis cache, knowledge
graph, and dynamic comments continue to operate.

## Non-goals

- Native Notion page comments on the public blog.
- WebSocket or live-push updates to already-open browser tabs.
- A second task queue service or permanent scheduler container.
- Replacing Redis, ISR, the Notion transport, or the graph store.
- Enumerating every historical arbitrary search keyword route.
- Rebuilding or redeploying the Docker image after each content edit.

## Official Notion References

- <https://developers.notion.com/reference/webhooks>
- <https://developers.notion.com/reference/webhooks-events-delivery>
