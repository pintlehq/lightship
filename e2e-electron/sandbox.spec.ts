import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const executable = resolve('dist/mac-arm64/Lightship.app/Contents/MacOS/Lightship')

test('packaged sandbox exposes only the curated bridge and delivers subscriptions', async () => {
  expect(process.platform).toBe('darwin')
  expect(process.arch).toBe('arm64')
  expect(existsSync(executable), 'Run pnpm build:unpack first').toBe(true)

  const preload = readFileSync(resolve('out/preload/index.js'), 'utf8')
  const requires = [...preload.matchAll(/\brequire\(["']([^"']+)["']\)/g)].map((match) => match[1])
  expect(requires).toEqual(['electron'])

  const root = mkdtempSync(join(tmpdir(), 'lightship-electron-smoke-'))
  const home = join(root, 'home')
  const profile = join(root, 'profile')
  mkdirSync(home)
  mkdirSync(profile)
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({
      executablePath: executable,
      args: [`--user-data-dir=${profile}`],
      chromiumSandbox: true,
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: join(home, '.config'),
        LIGHTSHIP_SMOKE_USER_DATA: profile
      }
    })
    const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
    expect(userData).toBe(profile)
    const sessionData = await app.evaluate(({ app: electronApp }) =>
      electronApp.getPath('sessionData')
    )
    expect(sessionData).toBe(profile)

    const page = await app.firstWindow()
    await expect(page.locator('#root')).toBeVisible()
    expect(
      await page.evaluate(() => ({
        api: typeof window.api,
        genericIpc: 'electron' in window,
        nodeProcess: 'process' in window,
        nodeRequire: 'require' in window
      }))
    ).toEqual({ api: 'object', genericIpc: false, nodeProcess: false, nodeRequire: false })
    await expect(page.evaluate(() => window.api.clusters.list())).resolves.toEqual([])
    await expect(
      page.evaluate(() => window.api.window.openExternal('http://localhost:80@example.org'))
    ).rejects.toThrow('Refusing to open unapproved URL')

    await page.evaluate(() => {
      const handle = window.api.cluster.openTerminal(
        'missing-cluster',
        { cols: 80, rows: 24 },
        (event) => {
          if (event.type === 'error') {
            void handle.kill().then(
              () => {
                document.body.dataset.smokeTerminal = 'stopped'
              },
              () => {
                document.body.dataset.smokeTerminal = 'stop-error'
              }
            )
          }
        }
      )
    })
    await expect(page.locator('body')).toHaveAttribute('data-smoke-terminal', 'stopped')
  } finally {
    await app?.close()
    rmSync(root, { recursive: true, force: true })
  }
})
