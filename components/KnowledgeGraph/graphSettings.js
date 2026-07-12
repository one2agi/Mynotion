export const GRAPH_SETTINGS_STORAGE_KEY =
  'notionnext:knowledge-graph:settings:v1'

export const GRAPH_SETTINGS_DEFAULTS = Object.freeze({
  depth: 2,
  labelMode: 'auto',
  labelOpacity: 0.72,
  nodeSize: 5,
  linkWidth: 1,
  centerStrength: 0.35,
  repelStrength: 80,
  linkStrength: 0.25,
  linkDistance: 70
})

export const GRAPH_SETTINGS_RANGES = Object.freeze({
  depth: [1, 2],
  labelOpacity: [0.2, 1],
  nodeSize: [3, 9],
  linkWidth: [0.5, 3],
  centerStrength: [0, 1],
  repelStrength: [20, 200],
  linkStrength: [0.05, 1],
  linkDistance: [30, 160]
})

const GRAPH_SETTINGS_VERSION = 1
const GRAPH_LABEL_MODES = new Set(['auto', 'always', 'never'])

const getStorage = () =>
  typeof localStorage === 'undefined' ? null : localStorage

const parseFiniteNumber = (value, fallback) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  return fallback
}

const clamp = (value, [minimum, maximum]) =>
  Math.min(maximum, Math.max(minimum, value))

const normalizeNumber = (value, key) =>
  clamp(
    parseFiniteNumber(value, GRAPH_SETTINGS_DEFAULTS[key]),
    GRAPH_SETTINGS_RANGES[key]
  )

export const normalizeGraphSettings = settings => {
  const input = settings && typeof settings === 'object' ? settings : {}

  return {
    depth: Math.trunc(normalizeNumber(input.depth, 'depth')),
    labelMode: GRAPH_LABEL_MODES.has(input.labelMode)
      ? input.labelMode
      : GRAPH_SETTINGS_DEFAULTS.labelMode,
    labelOpacity: normalizeNumber(input.labelOpacity, 'labelOpacity'),
    nodeSize: normalizeNumber(input.nodeSize, 'nodeSize'),
    linkWidth: normalizeNumber(input.linkWidth, 'linkWidth'),
    centerStrength: normalizeNumber(input.centerStrength, 'centerStrength'),
    repelStrength: normalizeNumber(input.repelStrength, 'repelStrength'),
    linkStrength: normalizeNumber(input.linkStrength, 'linkStrength'),
    linkDistance: normalizeNumber(input.linkDistance, 'linkDistance')
  }
}

const defaultGraphSettings = () => ({ ...GRAPH_SETTINGS_DEFAULTS })

export const loadGraphSettings = () => {
  const storage = getStorage()
  if (!storage) return defaultGraphSettings()

  try {
    const raw = storage.getItem(GRAPH_SETTINGS_STORAGE_KEY)
    if (!raw) return defaultGraphSettings()

    const payload = JSON.parse(raw)
    if (payload?.version !== GRAPH_SETTINGS_VERSION) {
      return defaultGraphSettings()
    }

    return normalizeGraphSettings(payload.settings)
  } catch {
    return defaultGraphSettings()
  }
}

export const saveGraphSettings = settings => {
  const normalized = normalizeGraphSettings(settings)
  const storage = getStorage()
  if (!storage) return defaultGraphSettings()

  try {
    storage.setItem(
      GRAPH_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        version: GRAPH_SETTINGS_VERSION,
        settings: normalized
      })
    )
    return normalized
  } catch {
    return defaultGraphSettings()
  }
}

export const resetGraphSettings = () => {
  const storage = getStorage()
  if (!storage) return defaultGraphSettings()

  try {
    storage.removeItem(GRAPH_SETTINGS_STORAGE_KEY)
  } catch {
    return defaultGraphSettings()
  }

  return defaultGraphSettings()
}
