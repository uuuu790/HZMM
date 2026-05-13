// Config Editor smoke — opens the editor for the HZMMWidgetTest fixture
// mod and verifies the schema renders without console/page errors.
//
// Kept narrow on purpose: the value-mutation tests (toggle optional →
// Save → grep file) need careful row-level locators against a modal DOM
// that re-renders mid-test. Those scenarios are already covered by the
// vitest unit suite (audit-regression.test.js). This file is the integration
// smoke: does the editor mount + render the schema at all?

import { test, expect } from '@playwright/test';
import { launchHzmm, switchTab } from './helpers.mjs';

const consoleErrors = [];
const pageErrors = [];

let app, page;

test.beforeAll(async () => {
  ({ app, page } = await launchHzmm());
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
});

test.afterAll(async () => {
  await app?.close();
});

test('Config Editor opens for HZMMWidgetTest and renders schema', async () => {
  await switchTab(page, 'modules');
  await page.waitForTimeout(800);

  // Click an ancestor of the heading (cursor-pointer card container) rather
  // than the heading itself — h4 has its own click handler that toggles
  // rename mode. Type badge / filename paragraph are safe inside-card targets.
  const card = page.locator('div')
    .filter({ has: page.locator('h4', { hasText: 'HZMMWidgetTest' }) })
    .filter({ has: page.locator('p', { hasText: /^HZMMWidgetTest$/ }) })
    .first();
  await expect(card).toBeVisible({ timeout: 5000 });
  // Click the filename paragraph (always present, no rename handler).
  await card.locator('p', { hasText: /^HZMMWidgetTest$/ }).first().click();

  // Wait for the ConfigEditor modal to mount + the schema to render.
  await expect(page.getByText(/Basics|基本/).first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/Bool toggle|布林開關/).first()).toBeVisible();

  // {value} substitution: IntSlider description renders "目前值：{value}"
  // resolved against the default 50.
  await expect(page.getByText(/目前值：50|Current value: 50/).first()).toBeVisible({ timeout: 3000 });

  // {eval:} substitution: FloatSlider description renders
  // "value × 35 = {eval: value*35}" → "value × 35 = 87.50" for default 2.5.
  await expect(page.getByText(/value × 35 = 87/).first()).toBeVisible({ timeout: 3000 });
});

test('No console or page errors during Config Editor render', async () => {
  expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toHaveLength(0);
  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
});
