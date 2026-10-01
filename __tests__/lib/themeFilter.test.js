const {
  resolveAllowedThemes,
  getTailwindThemeContentPaths
} = require('../../lib/build/themeFilter')

describe('lib/build/themeFilter', () => {
  const mockAllThemes = ['heo', 'hexo', 'matery', 'simple', 'starter']

  describe('resolveAllowedThemes', () => {
    it('returns all themes when no environment variables or overrides are provided (100% backward compatible)', () => {
      const res = resolveAllowedThemes({
        allThemes: mockAllThemes,
        env: {}
      })
      expect(res.allowedThemes).toEqual(mockAllThemes)
      expect(res.isFiltered).toBe(false)
    })

    it('returns all themes when BUILD_THEMES is "all" or "*"', () => {
      const resAll = resolveAllowedThemes({
        allThemes: mockAllThemes,
        env: { BUILD_THEMES: 'all' }
      })
      expect(resAll.allowedThemes).toEqual(mockAllThemes)
      expect(resAll.isFiltered).toBe(false)

      const resStar = resolveAllowedThemes({
        allThemes: mockAllThemes,
        env: { BUILD_THEMES: '*' }
      })
      expect(resStar.allowedThemes).toEqual(mockAllThemes)
      expect(resStar.isFiltered).toBe(false)
    })

    it('filters themes according to comma-separated BUILD_THEMES with case insensitivity', () => {
      const res = resolveAllowedThemes({
        allThemes: mockAllThemes,
        env: { BUILD_THEMES: 'Heo, STARTER, nonexistent' }
      })
      expect(res.allowedThemes).toEqual(['heo', 'starter'])
      expect(res.isFiltered).toBe(true)
    })

    it('deduplicates themes in BUILD_THEMES', () => {
      const res = resolveAllowedThemes({
        allThemes: mockAllThemes,
        env: { BUILD_THEMES: 'heo, HEO, heo' }
      })
      expect(res.allowedThemes).toEqual(['heo'])
      expect(res.isFiltered).toBe(true)
    })

    it('falls back to all themes if BUILD_THEMES has no matches', () => {
      const res = resolveAllowedThemes({
        allThemes: mockAllThemes,
        env: { BUILD_THEMES: 'foo, bar' }
      })
      expect(res.allowedThemes).toEqual(mockAllThemes)
      expect(res.isFiltered).toBe(false)
    })

    it('automatically restricts to NEXT_PUBLIC_THEME when explicitly set and switcher is disabled', () => {
      const res = resolveAllowedThemes({
        allThemes: mockAllThemes,
        env: { NEXT_PUBLIC_THEME: 'Starter' }
      })
      expect(res.allowedThemes).toEqual(['starter'])
      expect(res.isFiltered).toBe(true)
    })

    it('does not filter if NEXT_PUBLIC_THEME_SWITCH is true', () => {
      const res = resolveAllowedThemes({
        allThemes: mockAllThemes,
        env: { NEXT_PUBLIC_THEME: 'starter', NEXT_PUBLIC_THEME_SWITCH: 'true' }
      })
      expect(res.allowedThemes).toEqual(mockAllThemes)
      expect(res.isFiltered).toBe(false)
    })

    it('does not filter if themeSwitchEnabled (from widget.config.js) is true', () => {
      const res = resolveAllowedThemes({
        allThemes: mockAllThemes,
        env: { NEXT_PUBLIC_THEME: 'starter' },
        themeSwitchEnabled: true
      })
      expect(res.allowedThemes).toEqual(mockAllThemes)
      expect(res.isFiltered).toBe(false)
    })

    it('explicit BUILD_THEMES takes precedence over NEXT_PUBLIC_THEME', () => {
      const res = resolveAllowedThemes({
        allThemes: mockAllThemes,
        env: { BUILD_THEMES: 'heo,starter', NEXT_PUBLIC_THEME: 'simple' }
      })
      expect(res.allowedThemes).toEqual(['heo', 'starter'])
      expect(res.isFiltered).toBe(true)
    })
  })

  describe('getTailwindThemeContentPaths', () => {
    it('returns full themes glob when not filtered', () => {
      const paths = getTailwindThemeContentPaths({
        allowedThemes: mockAllThemes,
        allThemes: mockAllThemes
      })
      expect(paths).toEqual(['./themes/**/*.{js,jsx,ts,tsx}'])
    })

    it('returns scoped paths when themes are filtered', () => {
      const paths = getTailwindThemeContentPaths({
        allowedThemes: ['heo', 'starter'],
        allThemes: mockAllThemes
      })
      expect(paths).toEqual([
        './themes/*.{js,jsx,ts,tsx}',
        './themes/heo/**/*.{js,jsx,ts,tsx}',
        './themes/starter/**/*.{js,jsx,ts,tsx}'
      ])
    })
  })
})
