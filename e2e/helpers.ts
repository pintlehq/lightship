import { type Page, type Locator, expect } from '@playwright/test'

/** Load the app and wait for the e2e mock cluster to appear in the sidebar. */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await expect(sidebar(page).getByText('e2e-cluster')).toBeVisible()
}

/** The shell sidebar (an <aside>), used to scope nav clicks away from tabs/titles. */
export function sidebar(page: Page): Locator {
  return page.locator('aside').first()
}

/** Expand the mock cluster before clicking a sidebar nav row by its exact label. */
export async function navTo(page: Page, label: string): Promise<void> {
  if (!(await sidebar(page).getByText('Overview', { exact: true }).isVisible())) {
    await sidebar(page).getByText('e2e-cluster', { exact: true }).click()
  }
  await sidebar(page).getByText(label, { exact: true }).click()
}

/** Open the command palette via the ⌘K / Ctrl+K hotkey. */
export async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press('Meta+k')
  await expect(page.getByPlaceholder('Type a command or search resources…')).toBeVisible()
}
