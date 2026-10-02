import { test, expect } from '@playwright/test'

import { openApp, navTo, sidebar } from './helpers'

test('starts with the cluster collapsed and resets its fold after reload', async ({ page }) => {
  await openApp(page)
  const tree = sidebar(page)
  await expect(tree.getByText('Overview', { exact: true })).toHaveCount(0)
  await expect(tree.getByText('Workloads', { exact: true })).toHaveCount(0)
  await expect(tree.getByLabel('e2e-cluster: not checked', { exact: true })).toBeVisible()
  await expect(page.getByText('No tab open · ⌘K to search')).toBeVisible()

  await tree.getByText('e2e-cluster', { exact: true }).click()
  await expect(tree.getByText('Overview', { exact: true })).toBeVisible()
  await expect(tree.getByText('Pods', { exact: true })).toBeVisible()
  await expect(page.getByText('No tab open · ⌘K to search')).toBeVisible()

  await page.reload()
  await expect(tree.getByText('e2e-cluster', { exact: true })).toBeVisible()
  await expect(tree.getByText('Overview', { exact: true })).toHaveCount(0)
  await expect(tree.getByText('Workloads', { exact: true })).toHaveCount(0)
  await expect(tree.getByLabel('e2e-cluster: not checked', { exact: true })).toBeVisible()
})

test('navigate Overview / Nodes / Pods and open tabs', async ({ page }) => {
  await openApp(page)

  await sidebar(page).getByText('e2e-cluster', { exact: true }).click()
  await expect(page.getByText('No tab open · ⌘K to search')).toBeVisible()
  await navTo(page, 'Overview')
  await expect(page.getByRole('heading', { name: 'Recent events' })).toBeVisible()

  await navTo(page, 'Nodes')
  await expect(page.getByPlaceholder('Filter nodes, zone, instance type…')).toBeVisible()
  await expect(page.getByText('120 of 120')).toBeVisible()

  await navTo(page, 'Pods')
  await expect(page.getByPlaceholder('Filter pods, namespace, status…')).toBeVisible()

  // Three nav tabs are now open (status bar segment).
  await expect(page.getByText('3 tabs')).toBeVisible()
})
