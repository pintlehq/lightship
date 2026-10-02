import { expect, test, type Page } from '@playwright/test'
import type { PtyEvent, PtyOptions } from '../src/shared/ipc-types'
import { openApp, sidebar } from './helpers'

async function expectTerminalFits(page: Page) {
  const terminal = page.locator('.xterm:visible')
  await expect(terminal.locator('.xterm-rows')).toContainText('prompt>')
  await expect(terminal.locator('.xterm-cursor')).toHaveCount(1)
  await expect
    .poll(() =>
      terminal.evaluate((element) => {
        const host = element.parentElement
        const screen = element.querySelector('.xterm-screen')
        const cursor = element.querySelector('.xterm-cursor')
        const lastRow = element.querySelector('.xterm-rows > div:last-child')
        const footer = document.querySelector('footer')
        if (!host || !screen || !cursor || !lastRow || !footer) return false
        const bounds = host.getBoundingClientRect()
        const footerTop = footer.getBoundingClientRect().top
        return [screen, cursor, lastRow].every((node) => {
          const rect = node.getBoundingClientRect()
          return (
            rect.height > 0 &&
            rect.top >= bounds.top &&
            rect.bottom <= bounds.bottom &&
            rect.bottom <= footerTop - 8 &&
            rect.right <= bounds.right
          )
        })
      })
    )
    .toBe(true)
}

async function resizePanel(page: Page, height: number) {
  const handle = page.locator('main .cursor-row-resize')
  const bounds = await handle.boundingBox()
  if (!bounds) throw new Error('Terminal resize handle is not visible')
  const current = await handle.evaluate(
    (element) => element.parentElement!.getBoundingClientRect().height
  )
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + bounds.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + current - height, { steps: 5 })
  await page.mouse.up()
  await expect
    .poll(() => handle.evaluate((element) => element.parentElement!.getBoundingClientRect().height))
    .toBe(height)
}

for (const theme of ['light', 'dark']) {
  test(`${theme}: terminal rows stay above the footer through resizing and tab switches`, async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.addInitScript((theme) => {
      localStorage.setItem('lightship-theme', theme)
      let starts = 0
      Object.defineProperty(window, 'api', {
        value: {
          clusters: {
            list: async () => [
              { id: 'e2e', name: 'e2e-cluster', context: 'e2e', server: 'https://e2e.local' }
            ]
          },
          cluster: {
            openTerminal: (
              _id: string,
              _options: PtyOptions,
              onEvent: (event: PtyEvent) => void
            ) => {
              document.documentElement.dataset.terminalStarts = String(++starts)
              onEvent({
                type: 'data',
                data: Array.from({ length: 100 }, (_, i) => `line ${i}\r\n`).join('') + 'prompt> '
              })
              return {
                write: (data: string) => onEvent({ type: 'data', data }),
                resize: () => {},
                kill: async () => {}
              }
            }
          },
          uiState: { getDetailTabs: async () => ({}) },
          activity: { list: async () => [] },
          window: { onCloseTab: () => () => {} }
        }
      })
    }, theme)
    await openApp(page)
    await page.evaluate(() => document.fonts.ready)
    const newTerminal = async () => {
      await sidebar(page).getByText('e2e-cluster', { exact: true }).click({ button: 'right' })
      await page.getByText('New terminal', { exact: true }).click()
    }
    await newTerminal()
    await expectTerminalFits(page)
    await resizePanel(page, 140)
    await expectTerminalFits(page)
    await resizePanel(page, 360)
    await expectTerminalFits(page)

    await newTerminal()
    await expectTerminalFits(page)
    const starts = await page.locator('html').getAttribute('data-terminal-starts')
    await page.setViewportSize({ width: 960, height: 650 })
    await expectTerminalFits(page)
    await page.locator('[data-tab-id^="term-"]').first().click()
    await expectTerminalFits(page)
    await page.keyboard.type('echo hello')
    await expect(page.locator('.xterm:visible .xterm-rows')).toContainText('prompt> echo hello')
    await page.locator('[data-tab-id^="term-"]').last().click()
    await expectTerminalFits(page)
    await expect(page.locator('html')).toHaveAttribute('data-terminal-starts', starts ?? '')
  })
}
