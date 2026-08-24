import { test, expect } from '@playwright/test'

import { openApp, navTo } from './helpers'

test('pods list filters and opens a pod detail with sub-tabs', async ({ page }) => {
  await openApp(page)
  await navTo(page, 'Pods')
  await expect(page.getByText('5000 items')).toBeVisible()

  const filter = page.getByPlaceholder('Filter pods, namespace, status…')
  await filter.fill('zzzzzz')
  await expect(page.getByText('No pods found')).toBeVisible()
  await filter.fill('')
  await expect(page.getByText('5000 items')).toBeVisible()

  // Open the first pod row → detail tab (the "Forward" action confirms it).
  await page.locator('tbody tr').first().click()
  await expect(page.getByRole('button', { name: 'Forward' })).toBeVisible()

  // Switch sub-tabs (avoid Logs, which needs a live stream).
  await page.getByRole('button', { name: 'YAML' }).click()
  await page.getByRole('button', { name: /^Events/ }).click()
})

test('new from yaml dialog offers load-from-file', async ({ page }) => {
  await openApp(page)
  await navTo(page, 'Pods')

  await page.getByRole('button', { name: 'New from YAML' }).click()
  await expect(page.getByRole('button', { name: /Load from file/ })).toBeVisible()
  // Word wrap is on by default.
  await expect(page.getByRole('button', { name: 'Wrap' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Cancel' }).click()
})
