import { expect, Page } from '@playwright/test';

export async function startNewGame(page: Page, opts: { mode: 'HOUSE' | 'VS'; away?: string; home?: string; player1?: string; player2?: string; ante?: string; }) {
  const away = opts.away ?? 'AWAY';
  const home = opts.home ?? 'HOME';
  const player1 = opts.player1 ?? 'P1';
  const player2 = opts.player2 ?? 'P2';
  const ante = opts.ante ?? 'pushups';

  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });

  await page.locator('#away').fill(away);
  await page.locator('#home').fill(home);
  await page.locator('#mode').selectOption(opts.mode);
  await page.locator('#player1').fill(player1);
  await page.locator('#house').fill(player2);

  // ante may be missing in older pages
  const anteEl = page.locator('#ante');
  if (await anteEl.count()) {
    await anteEl.fill(ante);
  }

  await page.locator('#startBtn').click();
  await page.waitForURL(/game\.html/i);

  // Ensure game container exists
  await expect(page.locator('#game')).toBeVisible();
}

export async function getState(page: Page) {
  return await page.evaluate(() => {
    const raw = localStorage.getItem('botd_state');
    return raw ? JSON.parse(raw) : null;
  });
}

export async function clickIfEnabled(page: Page, selector: string) {
  const loc = page.locator(selector);
  await expect(loc).toHaveCount(1);
  const disabled = await loc.getAttribute('disabled');
  if (disabled !== null) return false;
  await loc.click();
  return true;
}

export async function assertNearTop(page: Page, selector: string, maxTopPx = 180) {
  const top = await page.locator(selector).evaluate(el => el.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(-5);
  expect(top).toBeLessThan(maxTopPx);
}
