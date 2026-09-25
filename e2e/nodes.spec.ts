import { test, expect } from '@playwright/test'

import { openApp, navTo } from './helpers'

test('nodes table opens a node detail with Properties and sub-tabs', async ({ page }) => {
  await openApp(page)
  await navTo(page, 'Nodes')
  await expect(page.getByText('120 of 120')).toBeVisible()

  // Open the first node row → detail tab.
  await page.locator('tbody tr').first().click()

  // Properties tab shows the node-info fields.
  await expect(page.getByRole('button', { name: 'Properties' })).toBeVisible()
  await expect(page.getByText('OS Image')).toBeVisible()
  await expect(page.getByText('Kernel version')).toBeVisible()
  await expect(page.getByText('Container runtime')).toBeVisible()
  await expect(page.getByText('Kubelet version')).toBeVisible()
  // Requested-resources stat cards.
  await expect(page.getByText('CPU requests')).toBeVisible()
  await expect(page.getByText('Memory requests')).toBeVisible()

  // Switch sub-tabs.
  await page.getByRole('button', { name: /^Charts/ }).click()
  await page.getByRole('button', { name: /^Events/ }).click()
  await page.getByRole('button', { name: /^Pods/ }).click()
})

test('drain confirmation explains blockers and can be cancelled before mutation', async ({
  page
}) => {
  await openApp(page)
  await navTo(page, 'Nodes')
  await page.locator('tbody tr').first().getByRole('checkbox').click()
  await page.getByRole('button', { name: 'Drain' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Unmanaged pods and pods using emptyDir block the drain')
  await expect(dialog).toContainText('Once cordoned, interrupted nodes remain cordoned')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByText('1 selected')).toBeVisible()
})
