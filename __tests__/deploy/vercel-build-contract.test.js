const { execFileSync } = require('child_process')
const {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} = require('fs')
const { tmpdir } = require('os')
const path = require('path')

describe('Vercel build contract', () => {
  test('enables build mode before running the Next.js production build', () => {
    const projectRoot = path.resolve(__dirname, '../..')
    const { buildCommand } = require('../../vercel.json')
    const probeDir = mkdtempSync(path.join(tmpdir(), 'vercel-build-contract-'))
    const probeOutput = path.join(probeDir, 'result.txt')
    const fakeNext = path.join(probeDir, 'next')

    writeFileSync(
      fakeNext,
      '#!/bin/sh\nprintf \'%s\\n%s\\n%s\\n%s\\n\' "$BUILD_MODE" "$NOTION_BUILD_RATE_MAX_PER_MINUTE" "$NOTION_BUILD_RATE_MIN_INTERVAL_MS" "$*" > "$VERCEL_BUILD_PROBE"\n'
    )
    chmodSync(fakeNext, 0o755)

    try {
      execFileSync('/bin/sh', ['-c', buildCommand], {
        cwd: projectRoot,
        env: {
          ...process.env,
          PATH: `${probeDir}:${process.env.PATH}`,
          VERCEL_BUILD_PROBE: probeOutput
        }
      })

      const [
        buildMode,
        notionRateMaxPerMinute,
        notionRateMinIntervalMs,
        nextArguments
      ] = readFileSync(probeOutput, 'utf8').trimEnd().split('\n')

      expect({
        buildMode,
        notionRateMaxPerMinute,
        notionRateMinIntervalMs,
        nextArguments
      }).toEqual({
        buildMode: 'true',
        notionRateMaxPerMinute: '20',
        notionRateMinIntervalMs: '3000',
        nextArguments: 'build'
      })
    } finally {
      rmSync(probeDir, { recursive: true, force: true })
    }
  })
})
