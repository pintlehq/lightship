import { expect, test } from '@playwright/test'

import { navTo, openApp } from './helpers'

test('opens namespace detail and scopes a resource shortcut to that namespace', async ({
  page
}) => {
  await openApp(page)
  await navTo(page, 'Namespaces')

  await expect(page.getByPlaceholder('Filter namespaces…')).toBeVisible()
  await expect(page.getByText('checkout', { exact: true })).toBeVisible()
  await page.getByText('checkout', { exact: true }).click()

  await expect(page.getByRole('button', { name: 'Quotas' })).toBeVisible()
  await expect(page.getByText('Resources in this namespace')).toBeVisible()
  await page.getByRole('button', { name: 'Pods', exact: true }).click()

  await expect(page.getByRole('button', { name: 'Namespace: checkout' })).toBeVisible()
})

test('create dialog preserves separate form and YAML modes', async ({ page }) => {
  await openApp(page)
  await navTo(page, 'Namespaces')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Namespace name')).toBeVisible()
  await page.getByRole('button', { name: 'YAML' }).click()
  await expect(page.getByText('kind: Namespace')).toBeVisible()
})
