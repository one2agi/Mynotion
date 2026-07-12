/** @jest-environment node */

import { expect, test } from '@jest/globals'
import path from 'node:path'
import { build } from 'esbuild'

test('bundles only server-compatible knowledge graph inputs', async () => {
  const result = await build({
    absWorkingDir: process.cwd(),
    bundle: true,
    entryPoints: [
      path.join(process.cwd(), 'cloud-functions/api/knowledge-graph.ts')
    ],
    external: ['@edgeone/pages-blob'],
    format: 'esm',
    logLevel: 'silent',
    metafile: true,
    platform: 'node',
    target: 'node22',
    tsconfig: path.join(process.cwd(), 'tsconfig.json'),
    write: false
  })

  const inputs = Object.keys(result.metafile.inputs).map(input =>
    input.replaceAll('\\', '/')
  )
  const forbiddenInputs = [
    'lib/cache/cache_manager.js',
    'lib/db/SiteDataApi.js',
    'lib/db/notion/getPostBlocks.js',
    'lib/global.js',
    'lib/utils/index.js',
    'themes/theme.js'
  ]

  for (const forbiddenInput of forbiddenInputs) {
    expect(inputs).not.toContain(forbiddenInput)
  }
  expect(inputs.some(input => /(^|\/)react(?:\/|$)/.test(input))).toBe(false)
})
