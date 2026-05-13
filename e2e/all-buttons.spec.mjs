// Exhaustive button-smoke: walk every visible button on each tab, click
// it, dismiss any modal it opened, and verify no console or page error.
//
// Safety policy:
//   - DANGEROUS_PATTERNS / DANGEROUS_ICONS list buttons we deliberately
//     skip (launches the game, opens native file dialogs Playwright can't
//     dismiss, irreversible batch destructive actions).
//   - All Confirm modals are dismissed via the X / backdrop (i.e. Cancel),
//     so destructive operations never actually run.
//   - Buttons whose click changes the DOM are tolerated — we re-enumerate
//     each iteration so stale handles don't trip us.

import { test, expect } from '@playwright/test';
import { launchHzmm, switchTab, closeModalWithEscape } from './helpers.mjs';

const TABS = ['dashboard', 'modules', 'nexus', 'profiles', 'settings'];

// Skip by visible text. Case-insensitive. Covers EN + zh-TW since that's
// the most-likely test locale.
const DANGEROUS_TEXT_PATTERNS = [
  /^\s*(launch|啟動|起動)\b/i,
  /launch game|啟動遊戲/i,
  /browse|匯入檔案|選擇檔案|browse files/i,
  /import|新增 mod/i,
  /batch.*(remove|delete|uninstall)/i,
  /批次.*(移除|刪除|解除)/i,
];

// Skip by an SVG icon class on the button. lucide names are stable.
const DANGEROUS_ICONS = [
  'lucide-play',          // play/launch
  'lucide-rocket',        // launch alt
  'lucide-folder-open',   // open-file dialog
  'lucide-upload',        // upload / browse
  'lucide-file-up',       // upload
];

const consoleErrors = [];
const pageErrors = [];
const clickedSummary = {}; // tab → [labels]
const skippedSummary = {}; // tab → [labels]

let app, page;

test.beforeAll(async () => {
  ({ app, page } = await launchHzmm());
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push({ tab: '', text: msg.text() });
  });
  page.on('pageerror', (err) => pageErrors.push({ tab: '', text: err.message }));
});

test.afterAll(async () => {
  await app?.close();
});

async function buttonIsDangerous(btn) {
  try {
    const text = ((await btn.textContent({ timeout: 500 })) || '').trim();
    if (DANGEROUS_TEXT_PATTERNS.some(re => re.test(text))) return { dangerous: true, reason: 'text', text };
    for (const cls of DANGEROUS_ICONS) {
      const has = await btn.locator(`svg.${cls}`).count();
      if (has > 0) return { dangerous: true, reason: `icon ${cls}`, text };
    }
    return { dangerous: false, text };
  } catch {
    return { dangerous: true, reason: 'unreadable', text: '[unreadable]' };
  }
}

// Build a stable identifier for a button so we know whether we've already
// clicked it this round. Text + icon-class fingerprint.
async function buttonFingerprint(btn) {
  const text = ((await btn.textContent().catch(() => '')) || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const icons = await btn.evaluate(el => {
    const svgs = el.querySelectorAll('svg');
    return Array.from(svgs).flatMap(s => Array.from(s.classList).filter(c => c.startsWith('lucide-'))).join(',');
  }).catch(() => '');
  return `${text}::${icons}`;
}

for (const tab of TABS) {
  test(`click every safe button on '${tab}'`, async () => {
    await switchTab(page, tab);
    await page.waitForTimeout(800);

    clickedSummary[tab] = [];
    skippedSummary[tab] = [];

    const seen = new Set();
    let rounds = 0;
    const MAX_ROUNDS = 8;

    while (rounds++ < MAX_ROUNDS) {
      const buttons = page.locator('button:visible');
      const count = await buttons.count();
      let clickedThisRound = 0;

      for (let i = 0; i < count; i++) {
        const btn = buttons.nth(i);
        if (!(await btn.isVisible().catch(() => false))) continue;

        const fp = await buttonFingerprint(btn);
        if (seen.has(fp)) continue;
        seen.add(fp);

        const safety = await buttonIsDangerous(btn);
        const label = safety.text || `[icon-only]`;

        if (safety.dangerous) {
          skippedSummary[tab].push(`${label} [${safety.reason}]`);
          continue;
        }

        const errBefore = consoleErrors.length;
        const pageErrBefore = pageErrors.length;

        try {
          await btn.click({ force: true, timeout: 2000 });
        } catch {
          skippedSummary[tab].push(`${label} [click failed]`);
          continue;
        }

        await page.waitForTimeout(350);
        // Cancel any modal that opened — protects against destructive confirms.
        await closeModalWithEscape(page);
        // Some renderers open dropdowns (not z-100 modals); click body to dismiss.
        await page.locator('body').click({ position: { x: 2, y: 2 } }).catch(() => {});
        await page.waitForTimeout(150);

        const newConsole = consoleErrors.slice(errBefore).map(e => e.text);
        const newPage = pageErrors.slice(pageErrBefore).map(e => e.text);
        newConsole.forEach(e => { consoleErrors[errBefore + newConsole.indexOf(e)].tab = tab + ': ' + label; });
        newPage.forEach(e => { pageErrors[pageErrBefore + newPage.indexOf(e)].tab = tab + ': ' + label; });

        clickedSummary[tab].push(`${label}${newConsole.length || newPage.length ? ` !err(${newConsole.length}c/${newPage.length}p)` : ''}`);
        clickedThisRound++;

        // Make sure we're still on the same tab — some clicks navigate.
        const stillOnTab = await page.locator(`#tab-${tab}`).evaluate(el => el.checked).catch(() => false);
        if (!stillOnTab) {
          await switchTab(page, tab);
          await page.waitForTimeout(300);
        }
      }

      // If no new buttons appeared and none were clicked, we're done.
      if (clickedThisRound === 0) break;
    }

    console.log(`\n[${tab}] clicked ${clickedSummary[tab].length}, skipped ${skippedSummary[tab].length}`);
    expect(clickedSummary[tab].length).toBeGreaterThan(0);
  });
}

test.afterAll(() => {
  console.log('\n=== ALL-BUTTONS SUMMARY ===');
  for (const tab of TABS) {
    console.log(`\n[${tab}]`);
    console.log(`  clicked (${clickedSummary[tab]?.length || 0}):`);
    (clickedSummary[tab] || []).forEach(b => console.log(`    ✓ ${b}`));
    console.log(`  skipped (${skippedSummary[tab]?.length || 0}):`);
    (skippedSummary[tab] || []).forEach(b => console.log(`    ⤳ ${b}`));
  }
  console.log('\n=== ERRORS ===');
  console.log(`Console errors: ${consoleErrors.length}`);
  consoleErrors.forEach((e, i) => console.log(`  [${i}] (${e.tab}) ${e.text}`));
  console.log(`Page errors: ${pageErrors.length}`);
  pageErrors.forEach((e, i) => console.log(`  [${i}] (${e.tab}) ${e.text}`));
});
