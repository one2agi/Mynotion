# Vercel Single-Project Build Design

## Goal

Make one Vercel project build `main` successfully and serve the site at
`https://www.jichang.world`, with `https://jichang.world` permanently
redirecting to the `www` host.

## Confirmed causes

- Two Vercel projects are connected to the same GitHub repository and
  production branch, so every push triggers two full Notion-backed builds.
- The project serving `www.jichang.world` already has the complete production
  environment configuration. The other project has only `NOTION_PAGE_ID`.
- `BUILD_MODE=true` activates the limiter, but its timing and request counters
  live only in process memory. The file lock serializes requests without
  sharing rate state.
- Failed requests do not update `lastRequestTime` or `requestCount`, so a 429 is
  retried in milliseconds and amplifies the throttle response.
- The `vitepress-chat` patch warning is non-fatal; the install script continues
  into `next build`. It is not the build failure.

## Selected architecture

### Vercel project ownership

- Keep the project that currently owns `www.jichang.world` and all production
  environment variables.
- Disconnect the second project from Git before pushing another code change.
- Do not copy or expose sensitive environment variable values.
- After a successful production build, move `jichang.world` to the retained
  project and configure a permanent redirect to `www.jichang.world`.
- Remove the obsolete project only after the custom domains and production
  deployment have been verified.

### Build request control

- Keep full prerendering. Do not switch article pages to first-request
  generation.
- Persist rate state next to the existing build lock so all workers in one
  build share the last-attempt timestamp and fixed-window request count.
- Reserve a rate slot before executing the request. Successful and failed
  attempts therefore consume the same quota and cannot retry immediately.
- Configure the Vercel build for a conservative maximum of 20 Notion requests
  per minute with a 3000 ms minimum interval.
- Keep Notion failures fatal to the build. Do not serialize empty fallback data
  merely to make deployment appear successful.

## Verification

- TDD proves that a failed request is followed by the configured interval and
  that separate limiter instances sharing one state path cannot burst.
- Existing Notion transport and Vercel build-contract tests remain green.
- Push once after the duplicate Git connection is disabled and monitor the
  retained project's real Vercel logs until the deployment is READY.
- Verify `www.jichang.world` returns the new deployment, emits the `www`
  canonical URL, and serves `robots.txt`.
- Verify the apex host redirects permanently to the same path and query on
  `www.jichang.world`.

## Failure handling

- If the retained project still receives 429 after the conservative limit,
  retain the single-project topology and lower the rate without re-enabling
  the duplicate project.
- If domain transfer fails, leave the existing `www` production domain in place
  and do not delete the old project until the apex domain is safely reassigned.
