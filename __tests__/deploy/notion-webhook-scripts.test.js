const fs = require('node:fs')
const path = require('node:path')

const read = file => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')

const scripts = [
  'deploy/scripts/run-notion-refresh.sh',
  'deploy/scripts/configure-notion-webhook-vps.sh'
]

describe('Notion webhook VPS deployment assets', () => {
  test.each(scripts)(
    '%s uses strict shell mode without trace logging',
    file => {
      const source = read(file)

      expect(source).toMatch(/^set -euo pipefail$/m)
      expect(source).not.toMatch(/set -x/)
    }
  )

  test('runner keeps bearer credentials out of process arguments', () => {
    const source = read('deploy/scripts/run-notion-refresh.sh')

    expect(source).toContain('/opt/notionnext/.env.production')
    expect(source).toContain('REVALIDATION_TOKEN')
    expect(source).toMatch(/Authorization: Bearer %s/)
    expect(source).toContain('url = "http://127.0.0.1:3030/api/revalidate"')
    expect(source).toContain('data = "{\\\\"dirty\\\\":true}"')
    expect(source).toMatch(/curl[\s\\]*--silent[\s\S]*--config -/)
    expect(source).not.toMatch(/curl[^\n]*Authorization:/)
    expect(source).not.toMatch(/curl[^\n]*\$REVALIDATION_TOKEN/)
    expect(source).toContain('flock --nonblock')
    expect(source).toContain('/run/notionnext-notion-refresh')
    expect(source).not.toContain('/run/lock/notionnext-notion-refresh.lock')
  })

  test.each(scripts)('%s rejects unsafe environment-file references', file => {
    const source = read(file)

    expect(source).toContain('[ -L "$ENV_FILE" ]')
    expect(source).toContain('stat -c %u:%g "$ENV_FILE"')
    expect(source).toContain('stat -c %a "$ENV_FILE"')
  })

  test('systemd runs a bounded non-overlapping job every minute', () => {
    const service = read('deploy/systemd/notionnext-notion-refresh.service')
    const timer = read('deploy/systemd/notionnext-notion-refresh.timer')

    expect(service).toMatch(/^Type=oneshot$/m)
    expect(service).toMatch(/^TimeoutStartSec=250$/m)
    expect(service).toMatch(/^RuntimeDirectory=notionnext-notion-refresh$/m)
    expect(service).toMatch(/^RuntimeDirectoryMode=0700$/m)
    expect(service).toMatch(
      /^ExecStart=\/usr\/local\/sbin\/run-notion-refresh$/m
    )
    expect(timer).toMatch(/^OnCalendar=\*-\*-\* \*:\*:00$/m)
    expect(timer).toMatch(/^Persistent=true$/m)
    expect(timer).toMatch(/^Unit=notionnext-notion-refresh\.service$/m)
  })

  test('configurator exposes only the six approved modes', () => {
    const source = read('deploy/scripts/configure-notion-webhook-vps.sh')

    for (const mode of [
      'install',
      'begin-setup',
      'show-token',
      'finish',
      'status',
      'disable'
    ]) {
      expect(source).toMatch(
        new RegExp(`^ {2}${mode.replace('-', '\\-')}\\)$`, 'm')
      )
    }
    expect(source).toContain('Unknown mode:')
  })

  test('setup and finish protect tokens and update only the app container', () => {
    const source = read('deploy/scripts/configure-notion-webhook-vps.sh')

    expect(source).toContain('/tmp/notion-webhook-verification-token')
    expect(source).toMatch(/chmod 600 "\$TOKEN_FILE"/)
    expect(source).toMatch(/chmod 600 "\$ENV_TMP"/)
    expect(source).toContain('mv -f "$ENV_TMP" "$ENV_FILE"')
    expect(
      source.match(
        /docker compose --env-file "\$ENV_FILE" up -d --no-deps --force-recreate app/g
      ) || []
    ).toHaveLength(2)
    expect(source).toContain('NOTION_WEBHOOK_SETUP_MODE=true')
    expect(source).toContain('NOTION_WEBHOOK_VERIFICATION_TOKEN')
    expect(source).toMatch(
      /docker exec notionnext-app[\s\S]*rm -f[\s\S]*notion-webhook-verification-token/
    )
    expect(source).toContain('data = "{\\\\"bootstrap\\\\":true}"')
    expect(source).toContain('Bootstrap did not return ok=true')
    expect(source).toMatch(
      /systemctl enable --now notionnext-notion-refresh\.timer/
    )
  })

  test('show-token is the only mode that can print the captured token', () => {
    const source = read('deploy/scripts/configure-notion-webhook-vps.sh')

    expect(source).toContain(
      'WARNING: the next line is the one-time Notion verification token.'
    )
    expect(source.match(/cat "\$TOKEN_PATH"/g)).toHaveLength(1)
  })

  test('disable stops scheduling without touching Docker or Redis data', () => {
    const source = read('deploy/scripts/configure-notion-webhook-vps.sh')
    const disable = source.match(/disable_scheduler\(\) \{[\s\S]*?^\}/m)[0]

    expect(disable).toContain(
      'systemctl disable --now notionnext-notion-refresh.timer'
    )
    expect(disable).not.toMatch(/systemctl disable[^\n]*\|\| true/)
    expect(disable).not.toMatch(/systemctl stop[^\n]*\|\| true/)
    expect(disable).not.toMatch(/docker compose down/)
    expect(disable).not.toMatch(/redis-cli|FLUSH|down -v|volume rm/i)
  })

  test('private environment examples and repeatable test command are documented', () => {
    const env = read('.env.example')
    const pkg = JSON.parse(read('package.json'))
    const docs = read('deploy/docs/NOTION-WEBHOOK.md')

    expect(env).toContain('# NOTION_WEBHOOK_VERIFICATION_TOKEN=')
    expect(env).toContain('# NOTION_WEBHOOK_SETUP_MODE=false')
    expect(env).not.toContain('NEXT_PUBLIC_NOTION_WEBHOOK')
    expect(pkg.scripts['test:notion-webhook']).toContain(
      '__tests__/deploy/notion-webhook-scripts.test.js'
    )
    expect(docs).toContain('https://www.one2agi.com/api/notion-webhook')
    for (const event of [
      'page.content_updated',
      'page.properties_updated',
      'page.created',
      'page.deleted',
      'page.undeleted',
      'page.moved'
    ]) {
      expect(docs).toContain(event)
    }
  })
})
