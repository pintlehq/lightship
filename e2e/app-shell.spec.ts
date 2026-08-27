import { test, expect } from '@playwright/test'

import { navTo, openApp, openPalette, sidebar } from './helpers'

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

test('dark theme separates chrome, content, active tabs, and cards without changing light surfaces', async ({
  page
}) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('lightship-theme', 'dark'))
  await page.reload()
  await expect(sidebar(page).getByText('e2e-cluster')).toBeVisible()
  await navTo(page, 'Overview')

  const shellSidebar = sidebar(page)
  const main = page.locator('main')
  const activeTab = page.locator('[data-tab-id]').filter({ hasText: 'Overview' })
  const card = page.locator('[data-slot="card"]').first()
  const background = (selector: typeof main) =>
    selector.evaluate((element) => getComputedStyle(element).backgroundColor)

  await expect.poll(() => background(shellSidebar)).toBe('rgb(20, 20, 23)')
  await expect.poll(() => background(main)).toBe('rgb(15, 15, 17)')
  await expect.poll(() => background(activeTab)).toBe('rgb(15, 15, 17)')
  await expect.poll(() => background(card)).toBe('rgb(25, 25, 28)')

  await page.evaluate(() => localStorage.setItem('lightship-theme', 'light'))
  await page.reload()
  await expect(shellSidebar.getByText('e2e-cluster')).toBeVisible()
  await navTo(page, 'Overview')

  await expect.poll(() => background(shellSidebar)).toBe('rgb(250, 250, 250)')
  await expect.poll(() => background(main)).toBe('rgb(255, 255, 255)')
  await expect.poll(() => background(activeTab)).toBe('rgb(255, 255, 255)')
  await expect.poll(() => background(card)).toBe('rgb(255, 255, 255)')
})
