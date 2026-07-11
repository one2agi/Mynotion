/**
 * Converts Notion's hyphenated UUID representation to the graph's canonical ID.
 * This module intentionally has no Node-only dependencies so both browser and
 * server graph code use the same identity rule.
 */
export const normalizePageId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null

  const id = value.replace(/-/g, '').toLowerCase()
  return /^[0-9a-f]{32}$/.test(id) ? id : null
}
