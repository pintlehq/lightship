import { test, expect } from '@playwright/test'

import { openApp, openPalette, sidebar } from './helpers'

test('loads the shell with the mock cluster and empty state', async ({ page }) => {
  await openApp(page)
  await expect(page.getByText('No tab open · ⌘K to search')).toBeVisible()
})

test('command palette opens and closes', async ({ page }) => {
  await openApp(page)
  await openPalette(page)
  await page.keyboard.press('Escape')
  await expect(page.getByPlaceholder('Type a command or search resources…')).toBeHidden()
})

test('right-click a cluster offers Refresh and toasts', async ({ page }) => {
  await openApp(page)
  await sidebar(page).getByText('e2e-cluster').click({ button: 'right' })
  await page.getByText('Refresh', { exact: true }).click()
  await expect(page.getByText('Refreshed e2e-cluster')).toBeVisible()
})

test('toggle theme via command palette flips the dark class', async ({ page }) => {
  await openApp(page)
  const html = page.locator('html')
  const before = await html.evaluate((el) => el.classList.contains('dark'))
  await openPalette(page)
  await page.getByText('Toggle theme').click()
  await expect.poll(() => html.evaluate((el) => el.classList.contains('dark'))).toBe(!before)
})
