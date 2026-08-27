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

test('settings About identifies Pintle and links to its website', async ({ page }) => {
  await openApp(page)
  await openPalette(page)
  await page.getByText('Open settings').click()
  await page.getByRole('button', { name: 'about' }).click()

  await expect(page.getByText('A product of Pintle Company Limited')).toBeVisible()
  const website = page.getByRole('link', { name: 'www.pintle.app' })
  await expect(website).toHaveAttribute('href', 'https://www.pintle.app')
  await expect(website).toHaveAttribute('target', '_blank')
  await expect(website).toHaveAttribute('rel', 'noreferrer')
})
