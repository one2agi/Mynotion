import {
  GRAPH_SETTINGS_DEFAULTS,
  loadGraphSettings,
  normalizeGraphSettings,
  resetGraphSettings,
  saveGraphSettings
} from '@/components/KnowledgeGraph/graphSettings'

beforeEach(() => {
  localStorage.clear()
})

test('clamps persisted graph settings and rejects unknown label modes', () => {
  expect(
    normalizeGraphSettings({
      depth: 99,
      labelMode: 'invalid',
      nodeSize: -1,
      linkDistance: 999
    })
  ).toMatchObject({
    depth: 2,
    labelMode: 'auto',
    nodeSize: 3,
    linkDistance: 160
  })
})

test('round-trips one versioned localStorage payload', () => {
  saveGraphSettings({ ...GRAPH_SETTINGS_DEFAULTS, nodeSize: 7 })

  expect(loadGraphSettings().nodeSize).toBe(7)
  expect(fetch).not.toHaveBeenCalled()
})

test('loads defaults for malformed or unknown-version storage payloads', () => {
  localStorage.setItem('notionnext:knowledge-graph:settings:v1', '{not-json')
  expect(loadGraphSettings()).toEqual(GRAPH_SETTINGS_DEFAULTS)

  localStorage.setItem(
    'notionnext:knowledge-graph:settings:v1',
    JSON.stringify({ version: 2, settings: { nodeSize: 9 } })
  )
  expect(loadGraphSettings()).toEqual(GRAPH_SETTINGS_DEFAULTS)
})

test('resets local settings and returns the defaults', () => {
  saveGraphSettings({ ...GRAPH_SETTINGS_DEFAULTS, nodeSize: 9 })
  const removeItemSpy = jest.spyOn(Storage.prototype, 'removeItem')

  expect(resetGraphSettings()).toEqual(GRAPH_SETTINGS_DEFAULTS)
  expect(removeItemSpy).toHaveBeenCalledWith(
    'notionnext:knowledge-graph:settings:v1'
  )
  expect(loadGraphSettings()).toEqual(GRAPH_SETTINGS_DEFAULTS)
})

test('returns defaults when localStorage operations throw', () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('storage unavailable')
  })
  expect(loadGraphSettings()).toEqual(GRAPH_SETTINGS_DEFAULTS)

  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('storage unavailable')
  })
  expect(saveGraphSettings({ nodeSize: 7 })).toEqual(GRAPH_SETTINGS_DEFAULTS)

  jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('storage unavailable')
  })
  expect(resetGraphSettings()).toEqual(GRAPH_SETTINGS_DEFAULTS)
})
