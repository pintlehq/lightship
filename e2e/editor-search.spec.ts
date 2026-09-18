import { expect, test } from '@playwright/test'

import { navTo, openApp, sidebar } from './helpers'

test('resource YAML uses the inline find bar with keyboard navigation', async ({ page }) => {
  await openApp(page)
  await navTo(page, 'Pods')
  await page.locator('tbody tr').first().click()
  await page.getByRole('button', { name: 'YAML' }).click()

  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+f')
  const search = page.getByRole('search', { name: 'Find in editor' })
  await expect(search).toBeVisible()
  const input = search.getByRole('textbox', { name: 'Find in editor' })
  await expect(input).toBeFocused()
  await input.fill('kind')
  await expect(search.getByRole('status')).toContainText('0 / 1')
  await input.press('Enter')
  await expect(search.getByRole('status')).toContainText('1 / 1')
  await input.press('Escape')
  await expect(search).not.toBeVisible()
})

test('find and replace fit in a narrow YAML creation dialog', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 800 })
  await openApp(page)
  await navTo(page, 'Pods')
  await page.getByRole('button', { name: 'New from YAML' }).click()

  const editor = page.locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+f')
  const search = page.getByRole('search', { name: 'Find in editor' })
  await expect(search).toBeVisible()
  expect(await search.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)

  await search.getByRole('textbox', { name: 'Find in editor' }).fill('my-pod')
  await search.getByRole('button', { name: 'Toggle replace' }).click()
  await search.getByRole('textbox', { name: 'Replace with' }).fill('demo-pod')
  await search.getByRole('button', { name: 'Replace all matches' }).click()
  await expect(editor).toContainText('demo-pod')
  await page.getByRole('button', { name: 'Cancel' }).click()
})

test('Secret search is available only while a value is revealed', async ({ page }) => {
  await openApp(page)
  await sidebar(page).getByText('Config', { exact: true }).click()
  await navTo(page, 'Secrets')
  await page.locator('tbody tr').first().click()
  await page.getByRole('button', { name: 'Data' }).click()
  await page.getByRole('button', { name: 'EXAMPLE_KEY' }).click()

  await expect(page.getByText('Value hidden')).toBeVisible()
  await expect(page.locator('.cm-editor')).toHaveCount(0)
  await page.getByRole('button', { name: 'Reveal to view / edit' }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+f')
  const search = page.getByRole('search', { name: 'Find in editor' })
  await search.getByRole('textbox', { name: 'Find in editor' }).fill('example-value')
  await expect(search.getByRole('status')).toContainText('0 / 1')

  await page.getByRole('button', { name: 'Hide value' }).click()
  await expect(search).not.toBeVisible()
  await expect(page.locator('.cm-editor')).toHaveCount(0)
})
