/** @jest-environment node */

import path from 'node:path'
import { build } from 'esbuild'

test('bundles the knowledge graph Cloud Function with EdgeOne-compatible loaders', async () => {
  await expect(
    build({
      absWorkingDir: process.cwd(),
      bundle: true,
      entryPoints: [
        path.join(process.cwd(), 'cloud-functions/api/knowledge-graph.ts')
      ],
      external: ['@edgeone/pages-blob'],
      format: 'esm',
      logLevel: 'silent',
      platform: 'node',
      target: 'node22',
      tsconfig: path.join(process.cwd(), 'tsconfig.json'),
      write: false
    })
  ).resolves.toBeDefined()
})
