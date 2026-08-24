import { test, expect } from '@playwright/test'

import { openApp, navTo } from './helpers'

test('navigate Overview / Nodes / Pods and open tabs', async ({ page }) => {
  await openApp(page)

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
