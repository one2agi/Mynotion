const fs = require('fs')
const path = require('path')

const read = file => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')
const themeFiles = ['starter', 'proxio', 'gitbook', 'magzine'].flatMap(theme => [
  `themes/${theme}/index.js`,
  `themes/${theme}/components/Header.js`
])
const forbidden = [
  ['@clerk', '/'].join(''),
  'LayoutSignIn',
  'LayoutSignUp',
  'LayoutDashboard',
  'DashboardButton',
  'DashboardBody',
  'DashboardHeader'
]

describe('themes do not expose retired account UI', () => {
  test.each(themeFiles)('%s is account-free', file => {
    const source = read(file)
    for (const token of forbidden) {
      expect(source).not.toContain(token)
    }
  })

  test('starter generic CTA defaults do not point to retired routes', () => {
    const config = read('themes/starter/config.js')
    expect(config).not.toContain("'/sign-in'")
    expect(config).not.toContain("'/sign-up'")

    const header = read('themes/starter/components/Header.js')
    expect(header).toContain('STARTER_NAV_BUTTON_1_TEXT')
    expect(header).toContain('STARTER_NAV_BUTTON_1_URL')
    expect(header).toContain('STARTER_NAV_BUTTON_2_TEXT')
    expect(header).toContain('STARTER_NAV_BUTTON_2_URL')
  })

  test('the app shell, global state, and TechGrow are account-free', () => {
    for (const file of ['pages/_app.js', 'lib/global.js']) {
      const source = read(file)
      expect(source).not.toContain(['@clerk', '/'].join(''))
      expect(source).not.toMatch(/ClerkProvider|useUser|isSignedIn/)
    }

    const techGrow = read('components/TechGrow.js')
    expect(techGrow).not.toMatch(/isSignedIn|isLoaded/)
    expect(techGrow).toMatch(/isBrowser\s*&&\s*blogId/)
    expect(techGrow).toMatch(/if\s*\(lock\)/)
  })

  test.each([
    'DashboardBody.js',
    'DashboardButton.js',
    'DashboardHeader.js',
    'DashboardItemAffliate.js',
    'DashboardItemBalance.js',
    'DashboardItemHome.js',
    'DashboardItemMembership.js',
    'DashboardItemOrder.js',
    'DashboardMenuList.js',
    'DashboardSignOutButton.js',
    'DashboardUser.js'
  ])('demo dashboard component %s is removed', file => {
    expect(
      fs.existsSync(
        path.resolve(process.cwd(), 'components/ui/dashboard', file)
      )
    ).toBe(false)
  })
})
