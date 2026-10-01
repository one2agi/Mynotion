const fs = require('node:fs')
const path = require('node:path')

/**
 * 扫描指定目录下的子目录，获取所有可用主题名
 * @param {string} themesDir
 * @returns {string[]}
 */
function scanAllThemes(themesDir) {
  if (!fs.existsSync(themesDir)) return []
  return fs
    .readdirSync(themesDir)
    .filter(file => {
      if (file.startsWith('.')) return false
      try {
        const fullPath = path.join(themesDir, file)
        return fs.statSync(fullPath).isDirectory()
      } catch {
        return false
      }
    })
    .sort()
}

/**
 * 解析本次构建允许包含的主题列表
 *
 * 优先级规则：
 * 1. 显式环境变量 BUILD_THEMES（支持逗号分隔，如 "heo,starter"；若为 "all" 或 "*" 则全量构建，大小写不敏感）
 * 2. 运行时全量换肤检测（themeSwitchEnabled 为 true，或环境变量开启）：直接返回全量主题，确保换肤功能完整
 * 3. 显式指定单主题 NEXT_PUBLIC_THEME：仅当显式设置了环境变量 NEXT_PUBLIC_THEME 时，自动收敛为该主题
 * 4. 默认兜底：返回全部可用主题，保证 100% 向后兼容（在 Notion 数据库随时切换主题不受影响）
 *
 * @param {object} [options]
 * @param {string} [options.themesDir]
 * @param {string[]} [options.allThemes]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {boolean|string} [options.themeSwitchEnabled]
 * @returns {{ allowedThemes: string[], allThemes: string[], isFiltered: boolean }}
 */
function resolveAllowedThemes({
  themesDir = path.resolve(__dirname, '../../themes'),
  allThemes = null,
  env = process.env,
  themeSwitchEnabled = false
} = {}) {
  const availableThemes = allThemes || scanAllThemes(themesDir)
  const rawBuildThemes = (env.BUILD_THEMES || '').trim()

  // 1. 显式指定 BUILD_THEMES 白名单
  if (rawBuildThemes) {
    if (rawBuildThemes === '*' || rawBuildThemes.toLowerCase() === 'all') {
      return {
        allowedThemes: availableThemes,
        allThemes: availableThemes,
        isFiltered: false
      }
    }
    const requested = rawBuildThemes
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(Boolean)
    const matched = requested.filter(t => availableThemes.includes(t))
    if (matched.length > 0) {
      const uniqueMatched = Array.from(new Set(matched))
      return {
        allowedThemes: uniqueMatched,
        allThemes: availableThemes,
        isFiltered: uniqueMatched.length < availableThemes.length
      }
    }
    console.warn(
      `[ThemeFilter] BUILD_THEMES="${rawBuildThemes}" did not match any existing themes. Falling back to all themes.`
    )
    return {
      allowedThemes: availableThemes,
      allThemes: availableThemes,
      isFiltered: false
    }
  }

  // 2. 检查是否开启了运行时全量换肤（兼容代码配置与环境变量）
  const isThemeSwitchEnabled =
    themeSwitchEnabled === true ||
    themeSwitchEnabled === 'true' ||
    env.NEXT_PUBLIC_THEME_SWITCH === 'true' ||
    env.THEME_SWITCH === 'true'

  if (isThemeSwitchEnabled) {
    return {
      allowedThemes: availableThemes,
      allThemes: availableThemes,
      isFiltered: false
    }
  }

  // 3. 仅当显式设置了 NEXT_PUBLIC_THEME 环境变量时，收敛为单主题
  // （不要使用默认 BLOG.THEME 兜底触发收敛，确保零环境变量部署时保留 Notion 数据库配置主题能力）
  const explicitEnvTheme = (env.NEXT_PUBLIC_THEME || '').trim().toLowerCase()
  if (explicitEnvTheme && availableThemes.includes(explicitEnvTheme)) {
    return {
      allowedThemes: [explicitEnvTheme],
      allThemes: availableThemes,
      isFiltered: availableThemes.length > 1
    }
  }

  // 4. 默认兜底：返回全部可用主题
  return {
    allowedThemes: availableThemes,
    allThemes: availableThemes,
    isFiltered: false
  }
}

/**
 * 为 Tailwind CSS 生成 content 扫描路径
 * 当主题被过滤时，仅扫描选定主题目录，避免 Tailwind 扫描几万行未使用主题代码
 * @param {object} options
 * @param {string[]} options.allowedThemes
 * @param {string[]} options.allThemes
 * @param {string} [options.baseThemesDir]
 * @returns {string[]}
 */
function getTailwindThemeContentPaths({
  allowedThemes,
  allThemes,
  baseThemesDir = './themes'
}) {
  if (
    !allowedThemes ||
    allowedThemes.length === 0 ||
    (allThemes && allowedThemes.length === allThemes.length)
  ) {
    return [`${baseThemesDir}/**/*.{js,jsx,ts,tsx}`]
  }

  return [
    `${baseThemesDir}/*.{js,jsx,ts,tsx}`, // 根目录 theme.js 等文件
    ...allowedThemes.map(t => `${baseThemesDir}/${t}/**/*.{js,jsx,ts,tsx}`)
  ]
}

module.exports = {
  scanAllThemes,
  resolveAllowedThemes,
  getTailwindThemeContentPaths
}
