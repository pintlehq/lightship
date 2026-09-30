import { expect, test } from '@playwright/test'
import type {
  HelmRelease,
  NamespaceSummary,
  NodeRow,
  Pod,
  ResourceRow,
  WatchEvent
} from '../src/shared/ipc-types'
import { navTo, openApp } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const names = ['service10', 'Service2', 'service1']
    const ages = ['1d', '2h', '30m']
    const counts = [10, 2, 1]
    const resources: ResourceRow[] = names.map((name, i) => ({
      name,
      uid: name,
      namespace: 'work',
      age: ages[i],
      columns: {
        ready: `${counts[i]}/20`,
        available: String(counts[i]),
        'up-to-date': String(counts[i])
      }
    }))
    const originalPods: Pod[] = names.map((name, i) => ({
      name,
      ns: 'work',
      status: 'Running',
      ready: '1/1',
      restarts: counts[i],
      cpu: `${counts[i]}m`,
      mem: `${counts[i]}Mi`,
      node: 'node',
      age: ages[i],
      ip: '1.2.3.4',
      containers: [{ name: 'app', ready: true, state: 'Running' }]
    }))
    let pods = originalPods
    const nodes: NodeRow[] = names.map((name, i) => ({
      name,
      roles: ['worker'],
      status: 'Ready',
      cpuPct: counts[i],
      cpu: '1',
      memPct: counts[i],
      mem: '1Gi',
      pods: counts[i],
      maxPods: 20,
      ver: 'v1.35',
      zone: 'zone',
      type: 'instance',
      age: ages[i],
      ip: '1.2.3.4',
      cordoned: false
    }))
    const namespaces: NamespaceSummary[] = names.map((name, i) => ({
      name,
      uid: name,
      status: 'Active',
      created: '',
      age: ages[i],
      protected: i === 2,
      podsReady: counts[i],
      podsTotal: 20,
      quotaCount: counts[i],
      limitRangeCount: 0,
      networkPolicyCount: 0,
      defaultDenyIngress: false,
      defaultDenyEgress: false
    }))
    const helm: HelmRelease[] = names.map((name, i) => ({
      name,
      namespace: 'work',
      revision: counts[i],
      chart: 'chart',
      chartVersion: '1.0',
      appVersion: '1.0',
      status: 'deployed',
      updated: ages[i]
    }))
    const listeners = new Set<(event: WatchEvent) => void>()
    window.addEventListener('test:empty-pods', () => {
      pods = []
      for (const listener of listeners) listener({ type: 'reset', rows: pods })
    })
    window.addEventListener('test:restore-pods', () => {
      pods = [...originalPods, { ...originalPods[0], name: 'service0' }]
      for (const listener of listeners) listener({ type: 'reset', rows: pods })
    })
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
          overview: async () => ({ nodes: 3, nodesReady: 3, pods: pods.length, namespaces: 3 }),
          pods: async () => pods,
          nodes: async () => nodes,
          listResource: async (_id: string, kind: string) =>
            kind === 'deployments' || kind === 'namespaces' ? resources : [],
          namespaceSummaries: async () => ({
            items: namespaces,
            access: {
              pods: { available: true },
              quotas: { available: true },
              limits: { available: true },
              policies: { available: true }
            }
          }),
          helmReleases: async () => helm,
          helmRevisions: async () => helm,
          getResourceDetail: async () => ({ labels: {} }),
          events: async () => [],
          watch: (_id: string, kind: string, listener: (event: WatchEvent) => void) => {
            if (kind === 'pods') listeners.add(listener)
            return () => listeners.delete(listener)
          }
        },
        uiState: { getDetailTabs: async () => ({}), setDetailTab: async () => {} },
        activity: { list: async () => [] },
        window: { onCloseTab: () => () => {} }
      }
    })
  })
})

for (const view of ['Pods', 'Deployments', 'Nodes', 'Namespaces', 'Helm Releases']) {
  test(`${view} sorts by header, switches columns, and resets`, async ({ page }) => {
    await openApp(page)
    await navTo(page, view)
    const rows = page.locator('tbody tr:not([aria-hidden])')
    const header = page.getByTestId('data-table-sort-name').locator('xpath=ancestor::th')
    await expect(rows.first()).toContainText('service10')
    // Click header text, rather than the arrow button.
    await header.getByText(/^name$/i).click()
    await expect(header).toHaveAttribute('aria-sort', 'ascending')
    await expect(rows.first()).toContainText('service1')
    await expect(rows.nth(1)).toContainText('Service2')
    await expect(rows.nth(2)).toContainText('service10')
    await page.getByTestId('data-table-sort-name').press('Space')
    await expect(header).toHaveAttribute('aria-sort', 'descending')
    await expect(rows.first()).toContainText('service10')
    await header.click({ position: { x: 4, y: 4 } })
    await expect(header).toHaveAttribute('aria-sort', 'none')
    await expect(rows.nth(1)).toContainText('Service2')

    const key = view === 'Helm Releases' ? 'updated' : 'age'
    await page.getByTestId(`data-table-sort-${key}`).click()
    await expect(rows.first()).toContainText('service1')
    await expect(header).toHaveAttribute('aria-sort', 'none')
    if (view !== 'Helm Releases') {
      await page.getByRole('button', { name: /^Refresh/ }).click()
      await expect(
        page.getByTestId(`data-table-sort-${key}`).locator('xpath=ancestor::th')
      ).toHaveAttribute('aria-sort', 'ascending')
      await expect(rows.first()).toContainText('service1')
    }
  })
}

test('Pods keeps sorting after filtering, empty watch results, updates and resizing', async ({
  page
}) => {
  await openApp(page)
  await navTo(page, 'Pods')
  await page.getByTestId('data-table-sort-name').click()
  const filter = page.getByPlaceholder('Filter pods, namespace, status…')
  await filter.fill('absent')
  await expect(page.getByText('No pods found')).toBeVisible()
  await filter.fill('')
  const header = page.getByTestId('data-table-sort-name').locator('xpath=ancestor::th')
  await expect(header).toHaveAttribute('aria-sort', 'ascending')
  await page.evaluate(() => window.dispatchEvent(new Event('test:empty-pods')))
  await expect(page.getByText('No pods found')).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('test:restore-pods')))
  await expect(page.locator('tbody tr').first()).toContainText('service0')
  const handle = page.getByRole('separator', { name: 'Resize name column' })
  const box = await handle.boundingBox()
  if (!box) throw new Error('Expected a visible resize handle')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 60, box.y + box.height / 2)
  await page.mouse.up()
  await expect(header).toHaveAttribute('aria-sort', 'ascending')
  await page.getByTestId('data-table-sort-name').click()
  await expect(header).toHaveAttribute('aria-sort', 'descending')
})

test('Helm revision history sorts numeric revisions', async ({ page }) => {
  await openApp(page)
  await navTo(page, 'Helm Releases')
  await page.locator('tbody tr').first().click()
  await page.getByTestId('data-table-sort-revision').click()
  await expect(page.locator('tbody tr').first().locator('td').first()).toHaveText('1')
  await page.getByTestId('data-table-sort-revision').click()
  await expect(page.locator('tbody tr').first().locator('td').first()).toHaveText('10')
})
