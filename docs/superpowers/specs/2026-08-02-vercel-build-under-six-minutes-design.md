# Vercel Build Under Six Minutes Design

## Goal

Keep the production Vercel build stable without Notion 429 bursts and reduce
the measured end-to-end deployment build from 8 minutes 54 seconds to no more
than 6 minutes under the current 36-page workload.

## Evidence

- The successful deployment made 120 Notion requests.
- Compilation and page-data setup took about 2 minutes.
- A 3000 ms global interval stretched Notion-backed page generation to about
  6 minutes and the full build to 8 minutes 54 seconds.
- The failed unlimited build issued many requests in the same second. The
  failure mode was burst concurrency, not a sustained rate below one request
  per second.

## Selected design

- Preserve the shared cross-worker limiter and count failed attempts.
- Preserve full prerendering and fatal handling of real Notion failures.
- Change the production build limit to a 1200 ms minimum interval and a
  50-request fixed-window maximum.
- Do not add a new cache layer or change page data semantics.

At 120 requests, the interval change removes about 216 seconds from the
observed build. The measured 8:54 build therefore projects to about 5:18,
leaving roughly 40 seconds below the 6-minute target for normal variation.

## Verification

- Update the executable Vercel build-contract test first and observe it fail
  against the old 20/3000 configuration.
- Change only `vercel.json`, then verify the contract and existing limiter and
  Notion API tests.
- Push once to `main`, monitor the real production deployment, and require:
  `READY`, zero 429 log entries, and elapsed build time no greater than 6
  minutes.
- If the real deployment exceeds 6 minutes, use its measured request phase to
  tune the same two parameters again; do not remove serialization.
