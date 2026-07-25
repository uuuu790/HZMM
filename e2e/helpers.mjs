import { _electron as electron } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Every launched app got the developer's REAL %APPDATA%, i.e. their real
// config.json — game path, Nexus API key, profiles, installed-mod tracking. The
// all-buttons spec clicks every button in every tab, so a run could rewrite
// those settings or act on the real game directory (uninstall, toggle, apply a
// profile). Point config-store (which reads process.env.APPDATA first) at a
// throwaway directory per run instead.
//
// NOTE: this means the app starts with a BLANK profile — no game path, no API
// key. That is the correct baseline for a UI smoke test, but a spec written
// against the developer's populated config may need its expectations updated.
const scratchDirs = [];

function makeScratchAppData() {
  const dir = mkdtempSync(join(tmpdir(), 'hzmm-e2e-appdata-'));
  scratchDirs.push(dir);
  return dir;
}

/** Remove the throwaway profiles created by launchHzmm. Call from afterAll. */
export function cleanupScratchAppData() {
  while (scratchDirs.length) {
    try { rmSync(scratchDirs.pop(), { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

/**
 * Launches HZMM and waits for the main UI to be ready.
 * Returns { app, page } — call app.close() in afterAll.
 */
export async function launchHzmm({ windowSize } = {}) {
  const env = { ...process.env };
  // Isolate the app's on-disk state from the developer's own install.
  env.APPDATA = makeScratchAppData();
  // Pass window size hint via env so main process can use it
  if (windowSize) {
    env.HZMM_TEST_WIDTH = String(windowSize.width);
    env.HZMM_TEST_HEIGHT = String(windowSize.height);
  }
  const app = await electron.launch({
    args: [resolve(__dirname, '../out/main/index.js')],
    timeout: 20_000,
    env,
  });
  const page = await app.firstWindow();
  if (windowSize) {
    await page.setViewportSize(windowSize);
  }
  await page.waitForLoadState('domcontentloaded');
  // Sidebar radio inputs are visually hidden — wait for attached
  await page.waitForSelector('#tab-dashboard', { state: 'attached', timeout: 15_000 });
  await page.waitForSelector('label[for="tab-dashboard"]', { state: 'visible', timeout: 15_000 });
  return { app, page };
}

/** Switch to a sidebar tab by id ('dashboard' | 'modules' | 'profiles' | 'settings'). */
export async function switchTab(page, tab) {
  await page.locator(`label[for="tab-${tab}"]`).click();
  await page.waitForFunction(
    (t) => document.querySelector(`#tab-${t}`)?.checked === true,
    tab,
    { timeout: 5_000 }
  );
}

/**
 * Close any open modal by clicking its backdrop or X button.
 * HZMM modals don't handle the Escape key — they rely on backdrop click or X.
 */
export async function closeModalWithEscape(page) {
  const modal = page.locator('div.fixed.inset-0.z-\\[100\\]');
  if ((await modal.count()) === 0) return; // no modal open
  // Prefer the X button in the modal header
  const xButton = modal.locator('button').filter({ has: page.locator('svg.lucide-x') }).first();
  if ((await xButton.count()) > 0) {
    await xButton.click({ force: true });
  } else {
    // Fall back to clicking the backdrop
    await modal.locator('div.absolute.inset-0').first().click({ position: { x: 5, y: 5 } });
  }
  // Wait for modal to unmount
  await page.waitForSelector('div.fixed.inset-0.z-\\[100\\]', { state: 'detached', timeout: 3000 }).catch(() => {});
}
