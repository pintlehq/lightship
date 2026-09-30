import { expect, test, type Locator } from '@playwright/test'
import type { Pod } from '../src/shared/ipc-types'
import { navTo, openApp, openPalette, sidebar } from './helpers'

function luminance(color: string): number {
  const channels = color
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number)
  if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${color}`)
  const linear = channels.map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

function contrast(text: string, background: string): number {
  const values = [luminance(text), luminance(background)].sort((a, b) => a - b)
  return (values[1] + 0.05) / (values[0] + 0.05)
}

async function colorOf(element: Locator, pseudo?: string): Promise<string> {
  return element.evaluate((node, pseudo) => getComputedStyle(node, pseudo).color, pseudo)
}

async function effectiveBackground(element: Locator): Promise<string> {
  return element.evaluate((node) => {
    let current: Element | null = node
    while (current) {
      const color = getComputedStyle(current).backgroundColor
      if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color
      current = current.parentElement
    }
    throw new Error('Expected an opaque background')
  })
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} gray text`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1700, height: 900 })
      await page.addInitScript((theme) => {
        localStorage.setItem('lightship-theme', theme)
        const pods: Pod[] = [
          {
            name: 'checkout-worker-completed',
            ns: 'checkout',
            status: 'Succeeded',
            ready: '0/1',
            restarts: 0,
            cpu: '—',
            mem: '—',
            node: 'worker-node-01',
            age: '11d',
            ip: '10.0.0.1',
            containers: [{ name: 'app', ready: false, state: 'Completed' }]
          },
          {
            name: 'checkout-api-running',
            ns: 'checkout',
            status: 'Running',
            ready: '1/1',
            restarts: 0,
            cpu: '12m',
            mem: '64Mi',
            node: 'worker-node-02',
            age: '2h',
            ip: '10.0.0.2',
            containers: [{ name: 'app', ready: true, state: 'Running' }]
          }
        ]
        Object.defineProperty(window, 'api', {
          value: {
            clusters: {
              list: async () => [
                {
                  id: 'e2e',
                  name: 'e2e-cluster',
                  context: 'e2e',
                  server: 'https://e2e.local',
                  env: 'dev'
                }
              ],
              test: async () => ({ ok: true })
            },
            cluster: {
              overview: async () => ({ nodes: 2, nodesReady: 2, pods: 2, namespaces: 1 }),
              pods: async () => pods,
              listResource: async (_id: string, kind: string) =>
                kind === 'namespaces'
                  ? [{ uid: 'checkout', name: 'checkout', age: '11d', columns: {} }]
                  : [],
              watch: () => () => {},
              events: async () => []
            },
            uiState: { getDetailTabs: async () => ({}), setDetailTab: async () => {} },
            activity: { list: async () => [] },
            window: { onCloseTab: () => () => {} }
          }
        })
      }, theme)
      await openApp(page)
      await navTo(page, 'Pods')
      await expect(page.getByText('checkout-worker-completed', { exact: true })).toBeVisible()
    })

    test('gray tokens and rendered table text meet contrast targets on every surface', async ({
      page
    }, testInfo) => {
      const palette = await page.locator('html').evaluate((node) => {
        const styles = getComputedStyle(node)
        const value = (token: string) =>
          `rgb(${styles.getPropertyValue(`--${token}`).trim().split(/\s+/).join(', ')})`
        return {
          text: ['muted-foreground', 'dim', 'faint'].map((token) => ({
            token,
            color: value(token)
          })),
          surfaces: [
            'background',
            'chrome',
            'card',
            'elevated',
            'muted',
            'popover',
            'hover',
            'active'
          ].map((token) => ({ token, color: value(token) }))
        }
      })
      for (const text of palette.text) {
        for (const surface of palette.surfaces) {
          expect(
            contrast(text.color, surface.color),
            `${text.token} on ${surface.token}`
          ).toBeGreaterThanOrEqual(4.5)
        }
      }

      const header = page.getByTestId('data-table-sort-name').locator('xpath=ancestor::th')
      expect(
        contrast(await colorOf(header), await effectiveBackground(header))
      ).toBeGreaterThanOrEqual(4.5)
      const row = page.locator('tbody tr').filter({ hasText: 'checkout-worker-completed' })
      const cells = row.locator('td')
      const secondaryText = [
        cells.nth(2),
        row.getByText('Succeeded'),
        cells.nth(5).locator('span'),
        cells.nth(6),
        cells.nth(7),
        cells.nth(8),
        cells.nth(9)
      ]
      for (const state of ['normal', 'hover', 'selected']) {
        if (state === 'hover') await row.hover()
        if (state === 'selected') await row.getByRole('checkbox').check()
        const background = await effectiveBackground(row)
        for (const text of secondaryText) {
          expect(
            contrast(await colorOf(text), background),
            `${state} row text`
          ).toBeGreaterThanOrEqual(4.5)
        }
      }
      const indicator = row.getByTitle('app · Completed')
      await expect
        .poll(() => indicator.evaluate((node) => getComputedStyle(node).backgroundColor))
        .toBe(theme === 'light' ? 'rgb(161, 161, 170)' : 'rgb(82, 82, 91)')
      const filter = page.getByPlaceholder('Filter pods, namespace, status…')
      expect(
        contrast(await colorOf(filter, '::placeholder'), await effectiveBackground(filter))
      ).toBeGreaterThanOrEqual(4.5)
      const sidebarLabel = sidebar(page).getByText('Clusters', { exact: true })
      expect(
        contrast(await colorOf(sidebarLabel), await effectiveBackground(sidebarLabel))
      ).toBeGreaterThanOrEqual(4.5)
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({
        path: testInfo.outputPath(`pods-${theme}.png`),
        animations: 'disabled'
      })
    })

    test('editor comments, line numbers and dialog labels stay readable', async ({
      page
    }, testInfo) => {
      await page.getByRole('button', { name: 'New from YAML' }).click()
      const editor = page.locator('.cm-content')
      await editor.click()
      await page.keyboard.press('ControlOrMeta+End')
      await page.keyboard.type('\n# Optional settings can be added below')
      const comment = editor.getByText('# Optional settings can be added below', { exact: true })
      await expect(comment).toBeVisible()
      expect(
        contrast(await colorOf(comment), await effectiveBackground(comment))
      ).toBeGreaterThanOrEqual(4.5)
      const lineNumber = page
        .locator('.cm-lineNumbers .cm-gutterElement')
        .filter({ hasText: /^1$/ })
      expect(
        contrast(await colorOf(lineNumber), await effectiveBackground(lineNumber))
      ).toBeGreaterThanOrEqual(4.5)
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({
        path: testInfo.outputPath(`yaml-dialog-${theme}.png`),
        animations: 'disabled'
      })
      await page.getByRole('button', { name: 'Cancel' }).click()
      await openPalette(page)
      await page.getByText('Open settings').click()
      await page.getByRole('button', { name: 'about' }).click()
      const description = page.getByText('A product of Pintle Company Limited')
      expect(
        contrast(await colorOf(description), await effectiveBackground(description))
      ).toBeGreaterThanOrEqual(4.5)
      await page.screenshot({
        path: testInfo.outputPath(`settings-${theme}.png`),
        animations: 'disabled'
      })
    })
  })
}
