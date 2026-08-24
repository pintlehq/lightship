import { test, expect } from '@playwright/test'

import { openApp, openPalette } from './helpers'

test('settings appearance shows Theme only (no Density/Accent)', async ({ page }) => {
  await openApp(page)
  await openPalette(page)
  await page.getByText('Open settings').click()

  await expect(page.getByText('Settings', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Theme' })).toBeVisible()
  // Regression guard: these setting sections were removed (match the Field headings).
  await expect(page.getByRole('heading', { name: 'Density' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Accent' })).toHaveCount(0)
})
