import {
  clampLauncherPosition,
  isLauncherDrag,
  loadLauncherPosition,
  saveLauncherPosition
} from '@/components/KnowledgeGraph/launcherPosition'

beforeEach(() => {
  localStorage.clear()
})

test('clamps launcher position inside viewport padding', () => {
  expect(
    clampLauncherPosition(
      { x: 999, y: -20 },
      { width: 320, height: 640 },
      { width: 44, height: 44 }
    )
  ).toEqual({ x: 264, y: 12 })
})

test('treats movement under five pixels as a click', () => {
  expect(isLauncherDrag({ x: 10, y: 10 }, { x: 13, y: 12 })).toBe(false)
  expect(isLauncherDrag({ x: 10, y: 10 }, { x: 20, y: 10 })).toBe(true)
})

test('persists a launcher position and clamps it when loading', () => {
  saveLauncherPosition({ x: 500, y: 80 })

  expect(
    loadLauncherPosition(
      { width: 320, height: 640 },
      { width: 44, height: 44 },
      { x: 264, y: 584 }
    )
  ).toEqual({ x: 264, y: 80 })
  expect(fetch).not.toHaveBeenCalled()
})

test('uses a clamped fallback for malformed persisted positions', () => {
  localStorage.setItem(
    'notionnext:knowledge-graph:launcher-position:v1',
    JSON.stringify({ x: 'invalid', y: null })
  )

  expect(
    loadLauncherPosition(
      { width: 320, height: 640 },
      { width: 44, height: 44 },
      { x: 999, y: -20 }
    )
  ).toEqual({ x: 264, y: 12 })
})
