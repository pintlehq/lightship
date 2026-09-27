import { expect, test } from '@playwright/test'
import type { Pod, WatchEvent } from '../src/shared/ipc-types'
import { navTo, openApp } from './helpers'

test('same-name pods have separate detail tabs and reflect watch updates and deletion', async ({
  page
}) => {
  await page.addInitScript(() => {
    let pods: Pod[] = ['web', 'jobs'].map((ns) => ({
      name: 'api',
      ns,
      status: 'Running',
      ready: '1/1',
      restarts: 0,
      cpu: '1m',
      mem: '1Mi',
      node: 'node-a',
      age: '1d',
      ip: '10.0.0.1',
      containers: []
    }))
    const listeners = new Set<(event: WatchEvent) => void>()
    window.addEventListener('test:pod-failure', () => {
      pods = pods.map((pod) => (pod.ns === 'web' ? { ...pod, status: 'CrashLoopBackOff' } : pod))
      for (const listener of listeners) listener({ type: 'reset', rows: pods })
    })
    window.addEventListener('test:pod-delete', () => {
      pods = pods.filter((pod) => pod.ns !== 'web')
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
          overview: async () => ({ nodes: 1, nodesReady: 1, pods: pods.length, namespaces: 2 }),
          pods: async () => pods,
          listResource: async (_id: string, kind: string) =>
            kind === 'namespaces'
              ? ['web', 'jobs'].map((name) => ({ uid: name, name, age: '1d', columns: {} }))
              : [],
          getResourceDetail: async () => ({ labels: {} }),
          events: async () => [],
          watch: (_id: string, kind: string, listener: (event: WatchEvent) => void) => {
            if (kind === 'pods') listeners.add(listener)
            return () => {
              listeners.delete(listener)
            }
          }
        },
        uiState: { getDetailTabs: async () => ({}), setDetailTab: async () => {} },
        activity: { list: async () => [] },
        window: { onCloseTab: () => () => {} }
      }
    })
  })
  await openApp(page)
  await navTo(page, 'Pods')
  await page
    .locator('tbody tr')
    .filter({ has: page.getByText('web', { exact: true }) })
    .click()
  await expect(page.locator('dd').filter({ hasText: /^web$/ })).toBeVisible()
  await navTo(page, 'Pods')
  await page
    .locator('tbody tr')
    .filter({ has: page.getByText('jobs', { exact: true }) })
    .click()
  await expect(page.locator('dd').filter({ hasText: /^jobs$/ })).toBeVisible()
  await expect(page.locator('[data-tab-id]').filter({ hasText: 'api·pod' })).toHaveCount(2)
  await page.locator('[data-tab-id]').filter({ hasText: 'api·pod' }).first().click()
  await expect(page.locator('dd').filter({ hasText: /^web$/ })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('test:pod-failure')))
  await expect(page.getByText('CrashLoopBackOff', { exact: true })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('test:pod-delete')))
  await expect(page.getByText(/api was not found/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Forward', exact: true })).toHaveCount(0)
})
