const fs = require('node:fs')
const path = require('node:path')

const read = file =>
  fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')

describe('Notion Worker deployment scripts', () => {
  test('Worker deployment keeps credentials in environment and stdin', () => {
    const source = read('deploy/scripts/deploy-notion-worker.sh')

    expect(source).toMatch(/^set -euo pipefail$/m)
    expect(source).not.toMatch(/set -x/)
    expect(source).toMatch(/^export CI=1$/m)
    expect(source).toContain('CLOUDFLARE_API_TOKEN')
    expect(source).toContain('CLOUDFLARE_ACCOUNT_ID')
    expect(source).toContain('NOTION_API_PROXY_TOKEN')
    expect(source).toContain('wrangler@4.110.0')
    expect(source).toMatch(
      /printf ['"]%s['"] "\$NOTION_API_PROXY_TOKEN"[\s\S]*secret put NOTION_PROXY_TOKEN/
    )
    expect(source).not.toMatch(/--(?:token|api-token)[= ]/)
    expect(source).toContain('/health')
    expect(source).toMatch(/for attempt in \$\(seq 1 12\)/)
    expect(source).toContain('sleep 5')
    expect(source.match(/curl --noproxy '\*'/g)).toHaveLength(2)
  })

  test('VPS configuration transfers secrets on stdin and supports rollback', () => {
    const source = read('deploy/scripts/configure-notion-proxy-vps.sh')

    expect(source).toMatch(/^set -euo pipefail$/m)
    expect(source).not.toMatch(/set -x/)
    expect(source).toContain('NOTION_API_PROXY_URL')
    expect(source).toContain('NOTION_API_PROXY_TOKEN')
    expect(source).toMatch(/ssh [^\n]+< "\$FRAGMENT"/)
    expect(source).toContain('--disable')
    expect(source).toContain('NOTION_API_PROXY_')
    expect(source).toContain('docker compose up -d --no-deps --force-recreate app way')
    expect(source).toContain('http://127.0.0.1:3030/api/health')
    expect(source).toContain('http://127.0.0.1:3031/api/health')
    expect(source).toContain('notionnext-app notionnext-way')
  })

  test('coordinated deploy fails when Notion Worker proxy is missing from runtime', () => {
    const source = read('deploy/scripts/deploy.sh')

    expect(source).toContain('assert_notion_proxy_runtime_ready')
    expect(source).toContain('NOTION_API_PROXY_URL')
    expect(source).toContain('NOTION_API_PROXY_TOKEN')
    expect(source).toContain('notion proxy env: ok')
    expect(source).toContain('notion proxy 容器环境: ok')
    expect(source).toContain('/health')
  })

  test('package scripts expose repeatable Worker operations', () => {
    const pkg = JSON.parse(read('package.json'))

    expect(pkg.scripts['test:notion-worker']).toContain(
      '__tests__/cloudflare/notion-api-proxy.test.js'
    )
    expect(pkg.scripts['deploy:notion-worker']).toBe(
      'bash deploy/scripts/deploy-notion-worker.sh'
    )
  })

  test('Worker uses the account-owned custom domain instead of workers.dev', () => {
    const config = JSON.parse(
      read('cloudflare/notion-api-proxy/wrangler.jsonc')
    )
    const source = read('deploy/scripts/deploy-notion-worker.sh')

    expect(config.routes).toEqual([
      { pattern: 'notion-api.faiz-world.com', custom_domain: true }
    ])
    expect(source).toContain(
      'https://notion-api.faiz-world.com/api/v3'
    )
  })
})
