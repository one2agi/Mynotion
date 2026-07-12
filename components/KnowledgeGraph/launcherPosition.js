export const LAUNCHER_STORAGE_KEY =
  'notionnext:knowledge-graph:launcher-position:v1'
export const LAUNCHER_PADDING = 12
export const LAUNCHER_DRAG_THRESHOLD = 5

const finiteCoordinate = value =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const getStorage = () => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export const clampLauncherPosition = (
  position,
  viewport,
  launcher,
  padding = LAUNCHER_PADDING
) => {
  const maxX = Math.max(
    padding,
    (viewport?.width || 0) - launcher.width - padding
  )
  const maxY = Math.max(
    padding,
    (viewport?.height || 0) - launcher.height - padding
  )

  return {
    x: Math.min(maxX, Math.max(padding, position.x)),
    y: Math.min(maxY, Math.max(padding, position.y))
  }
}

export const isLauncherDrag = (start, end) =>
  Math.hypot(end.x - start.x, end.y - start.y) >= LAUNCHER_DRAG_THRESHOLD

export const loadLauncherPosition = (viewport, launcher, fallback) => {
  let position = fallback
  const storage = getStorage()

  if (storage) {
    try {
      const parsed = JSON.parse(storage.getItem(LAUNCHER_STORAGE_KEY))
      if (
        finiteCoordinate(parsed?.x) !== null &&
        finiteCoordinate(parsed?.y) !== null
      ) {
        position = parsed
      }
    } catch {
      position = fallback
    }
  }

  return clampLauncherPosition(position, viewport, launcher)
}

export const saveLauncherPosition = position => {
  const storage = getStorage()
  if (!storage) return false

  try {
    storage.setItem(LAUNCHER_STORAGE_KEY, JSON.stringify(position))
    return true
  } catch {
    return false
  }
}
