import { test, expect } from '@playwright/test'

import { openApp, navTo } from './helpers'

test('pods list filters and opens a pod detail with sub-tabs', async ({ page }) => {
  await openApp(page)
  await navTo(page, 'Pods')
  await expect(page.getByText('5000 items')).toBeVisible()

  const selectAll = page.locator('thead').getByRole('checkbox')
  const [checkboxBox, clippingBox] = await Promise.all([
    selectAll.boundingBox(),
    selectAll.locator('..').boundingBox()
  ])
  expect(checkboxBox).not.toBeNull()
  expect(clippingBox).not.toBeNull()
  expect(checkboxBox!.x + checkboxBox!.width).toBeLessThanOrEqual(
    clippingBox!.x + clippingBox!.width
  )

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

test('sorts the virtualized 5000-pod list and preserves sorting through an empty filter', async ({
  page
}) => {
  await openApp(page)
  await navTo(page, 'Pods')
  await expect(page.getByText('5000 items')).toBeVisible()
  const header = page.getByTestId('data-table-sort-name').locator('xpath=ancestor::th')
  await header.getByText('NAME', { exact: true }).click()
  const rows = page.locator('tbody tr:not([aria-hidden])')
  const visibleNames = () => rows.locator('td:nth-child(2)').allTextContents()
  const ascending = await visibleNames()
  expect(ascending.length).toBeGreaterThan(1)
  expect(ascending.length).toBeLessThan(100)
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  expect(ascending).toEqual([...ascending].sort(collator.compare))
  const filter = page.getByPlaceholder('Filter pods, namespace, status…')
  await filter.fill('zzzzzz')
  await expect(page.getByText('No pods found')).toBeVisible()
  await filter.fill('')
  await expect(header).toHaveAttribute('aria-sort', 'ascending')
  await page.getByTestId('data-table-sort-name').click()
  await expect(header).toHaveAttribute('aria-sort', 'descending')
  const descending = await visibleNames()
  expect(descending).toEqual([...descending].sort((a, b) => collator.compare(b, a)))
})
