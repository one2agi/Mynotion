#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const chunksDir = path.join(root, '.next', 'static', 'chunks')
const reportDir = path.join(root, '.perf')
const reportPath = path.join(reportDir, 'bundle-budget.json')
const failOnBudget = process.env.PERF_BUDGET_FAIL === 'true'

const budgets = {
  appChunkKb: Number(process.env.PERF_BUDGET_APP_CHUNK_KB || 350),
  mainChunkKb: Number(process.env.PERF_BUDGET_MAIN_CHUNK_KB || 300),
  themeChunkKb: Number(process.env.PERF_BUDGET_THEME_CHUNK_KB || 500),
  asyncChunkKb: Number(process.env.PERF_BUDGET_ASYNC_CHUNK_KB || 450)
}

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

function sizeKb(file) {
  return Math.round((fs.statSync(file).size / 1024) * 10) / 10
}

function classify(file) {
  const rel = path.relative(chunksDir, file).replace(/\\/g, '/')
  const name = path.basename(file)
  if (rel === 'pages/_app.js') return { type: 'appChunk', budgetKb: budgets.appChunkKb }
  if (name === 'main.js') return { type: 'mainChunk', budgetKb: budgets.mainChunkKb }
  if (name.startsWith('themes_') && name.endsWith('_index_js.js')) {
    return { type: 'themeChunk', budgetKb: budgets.themeChunkKb }
  }
  return { type: 'asyncChunk', budgetKb: budgets.asyncChunkKb }
}

function main() {
  if (!fs.existsSync(chunksDir)) {
    throw new Error('Missing .next/static/chunks. Run `npm run build` first.')
  }

  const files = walk(chunksDir).filter(file => file.endsWith('.js'))
  const results = files.map(file => {
    const { type, budgetKb } = classify(file)
    const kb = sizeKb(file)
    return {
      file: path.relative(root, file).replace(/\\/g, '/'),
      type,
      kb,
      budgetKb,
      overBudget: kb > budgetKb
    }
  })

  const overBudget = results
    .filter(item => item.overBudget)
    .sort((a, b) => b.kb - a.kb)

  fs.mkdirSync(reportDir, { recursive: true })
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        budgets,
        overBudget,
        largestChunks: [...results].sort((a, b) => b.kb - a.kb).slice(0, 40)
      },
      null,
      2
    )
  )

  console.log(`Bundle budget report: ${path.relative(root, reportPath)}`)
  if (overBudget.length > 0) {
    console.log('Largest budget overruns:')
    for (const item of overBudget.slice(0, 10)) {
      console.log(`- ${item.file}: ${item.kb}KB > ${item.budgetKb}KB (${item.type})`)
    }
    if (failOnBudget) process.exit(1)
  } else {
    console.log('All checked chunks are within budget.')
  }
}

try {
  main()
} catch (err) {
  console.error(err.message || err)
  process.exit(1)
}
