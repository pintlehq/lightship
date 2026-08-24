import { test, expect } from '@playwright/test'

import { openApp, sidebar } from './helpers'

test('manage clusters: inline rename, red remove, add-cluster modal', async ({ page }) => {
  await openApp(page)
  await sidebar(page).getByRole('button', { name: 'Manage clusters' }).click()

  // Clicking the cluster name starts an inline rename.
  await page.getByRole('button', { name: 'e2e-cluster', exact: true }).click()
  await expect(page.getByRole('textbox').first()).toBeVisible()
  await page.keyboard.press('Escape')

  // The Remove action renders in destructive red.
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveClass(/text-destructive/)

  // Add cluster modal → paste YAML tab → Load from file is available.
  await sidebar(page).getByRole('button', { name: 'Add cluster' }).click()
  await page.getByRole('button', { name: 'paste YAML' }).click()
  await expect(page.getByRole('button', { name: /Load from file/ })).toBeVisible()
})
