/** @jest-environment node */

const fs = require('fs')
const path = require('path')

const read = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('one2agi domain ownership contracts', () => {
  test('www proxies root and infrastructure but permanently redirects content', () => {
    const nginx = read('deploy/nginx/www.one2agi.com.conf')
    expect(nginx).toMatch(
      /location = \/\s*\{[\s\S]*proxy_pass http:\/\/notionnext_app;/
    )
    expect(nginx).toMatch(
      /location \^~ \/api\/[\s\S]*proxy_pass http:\/\/notionnext_app;/
    )
    expect(nginx).toMatch(
      /location \^~ \/_next\/[\s\S]*proxy_pass http:\/\/notionnext_app;/
    )
    expect(nginx).toContain('return 308 https://way.one2agi.com$request_uri;')
  })

  test('way remains a normal full-site reverse proxy', () => {
    const nginx = read('deploy/nginx/way.one2agi.com.conf')
    expect(nginx).not.toContain('return 308 https://www.one2agi.com')
    expect(nginx).toMatch(
      /location \/\s*\{[\s\S]*proxy_pass http:\/\/notionnext_way;/
    )
  })

  test('compose builds explicit roles with correct canonical and shared refresh wiring', () => {
    const compose = read('docker-compose.yml')
    expect(compose).toMatch(/app:[\s\S]*NEXT_PUBLIC_SITE_ROLE: landing/)
    expect(compose).toMatch(
      /app:[\s\S]*NEXT_PUBLIC_LINK: \$\{NEXT_PUBLIC_LINK:-https:\/\/www\.one2agi\.com\}/
    )
    expect(compose).toMatch(
      /app:[\s\S]*NEXT_PUBLIC_CONTENT_SITE_URL: \$\{WAY_SITE_URL:-https:\/\/way\.one2agi\.com\}/
    )
    expect(compose).toMatch(/way:[\s\S]*NEXT_PUBLIC_SITE_ROLE: content/)
    expect(compose).toMatch(
      /way:[\s\S]*NEXT_PUBLIC_LINK: \$\{WAY_SITE_URL:-https:\/\/way\.one2agi\.com\}/
    )
    expect(compose).toContain(
      'LANDING_REVALIDATION_URL=http://app:3000/api/revalidate'
    )
    expect(compose).toContain('notion-cache:/app/.next/cache')
    expect(compose).toContain('notion-cache-way:/app/.next/cache')
    expect(compose).toMatch(
      /app:[\s\S]*NODE_OPTIONS=--max-old-space-size=768[\s\S]*memory: 1G/
    )
    expect(compose).toMatch(
      /way:[\s\S]*NODE_OPTIONS=--max-old-space-size=1536[\s\S]*memory: 1800M/
    )
  })

  test('Docker build exposes role and canonical variables to Next.js', () => {
    const dockerfile = read('Dockerfile')
    for (const variable of [
      'NEXT_PUBLIC_LINK',
      'NEXT_PUBLIC_SITE_ROLE',
      'NEXT_PUBLIC_CONTENT_SITE_URL'
    ]) {
      expect(dockerfile).toContain(`ARG ${variable}`)
      expect(dockerfile).toMatch(new RegExp(`ENV ${variable}=\\$${variable}`))
    }
  })

  test('coordinated deploy builds and ships both role images', () => {
    const deploy = read('deploy/scripts/deploy.sh')
    expect(deploy).toContain(
      'docker compose --env-file .env.production build --no-cache app way'
    )
    expect(deploy).toContain(
      'sudo --preserve-env=IMAGE_TAG docker compose --env-file .env.production up -d'
    )
    expect(deploy).toContain('notionnext-way:$IMAGE_TAG')
    expect(deploy).toContain('cleanup_repository notionnext')
    expect(deploy).toContain('cleanup_repository notionnext-way')
    expect(deploy).toContain('http://127.0.0.1:3030/')
    expect(deploy).toContain('http://127.0.0.1:3031/')
  })
})
