import { test, expect } from '@playwright/test';
import { startNewGame, getState, assertNearTop } from './helpers';

test('VS mode: complete a full game flow (includes scratch assertions)', async ({ page }) => {
  test.setTimeout(3 * 60_000);

  await startNewGame(page, {
    mode: 'VS',
    away: 'Canucks',
    home: 'Kraken',
    player1: 'P1',
    player2: 'P2',
    ante: '42'
  });

  // Pre-game Q1
  await page.click('#q1_playerAway');
  await page.click('#q1_houseHome');
  await page.click('#toQ2');

  // Pre-game Q2
  await page.click('#q2_player_Yes');
  await page.click('#q2_house_No');
  await page.click('#toP1');

  // -------- Period 1: make P1 win 3-0 so P1 earns 1 DOG --------
  await page.click('#p1q1_player_Yes');
  await page.click('#p1q2_player_Yes');
  await page.click('#p1q3_player_Yes');

  await page.click('#p1q1_house_No');
  await page.click('#p1q2_house_No');
  await page.click('#p1q3_house_No');

  await page.click('#p1_r_goal_y');
  await page.click('#p1_r_pen_y');
  
  // Invariant: if Goals? is Yes, total SOG this period must be >= 1.
  // Try an invalid lock first (0 added SOG) and expect an alert.
  await page.fill('#p1_r_sog_away', '0');
  await page.fill('#p1_r_sog_home', '0');
  page.once('dialog', async (d) => {
    expect(d.message()).toContain('Goals? is Yes');
    await d.accept();
  });
  await page.click('#p1_lockResults');

  // Now enter valid SOG totals.
  await page.fill('#p1_r_sog_away', '7');
  await page.fill('#p1_r_sog_home', '7');
  await page.click('#p1_lockResults');

  let st = await getState(page);
  expect(st.dogs.player).toBe(1);
  expect(st.dogs.house).toBe(0);

  // Continue to P2: should land near P1's dogs spend tile (player has dogs)
  await page.click('#toP2');
  await expect(page.locator('#dogsSpendTile_player')).toHaveCount(1);
  await assertNearTop(page, '#dogsSpendTile_player');

  // -------- Period 2: P1 spends 1 DOG to scratch P2's Q1 --------
  const pDogsBefore = (await getState(page)).dogs.player;
  await page.click('#scratch_player_q1');

  // After scratch, P1's spend tile should disappear (P2 max 1 scratch)
  await expect(page.locator('#scratch_player_q1')).toHaveCount(0);
  await expect(page.locator('#dogsSpendTile_player')).toHaveCount(0);

  st = await getState(page);
  expect(st.dogs.player).toBe(pDogsBefore - 1);
  expect(st.periods?.p2?.dogSpend?.player?.scratchedList?.length ?? 0).toBe(1);

  // Scratched questions must be visibly marked with 🦴 (not 🔒)
  await expect(page.locator('text=🦴')).toHaveCount(1);

  // Finish P2 quickly
  await page.click('#p2q1_player_No');
  await page.click('#p2q2_player_No');
  await page.click('#p2q3_player_No');

  // P2 can answer after P1 locks all three (Q1 may be scratched/locked)
  if (await page.locator('#p2q2_house_Yes').count()) await page.click('#p2q2_house_Yes');
  if (await page.locator('#p2q3_house_Yes').count()) await page.click('#p2q3_house_No');

  await page.click('#p2_r_goal_n');
  await page.click('#p2_r_pen_n');
  await page.fill('#p2_r_sog_away', '12');
  await page.fill('#p2_r_sog_home', '10');
  await page.click('#p2_lockResults');
  await page.click('#toP3');

  // -------- Period 3 --------
  await page.click('#p3q1_player_Yes');
  await page.click('#p3q2_player_No');
  await page.click('#p3q3_player_Yes');

  await page.click('#p3q1_house_No');
  await page.click('#p3q2_house_No');
  await page.click('#p3q3_house_No');

  await page.click('#p3_r_goal_y');
  await page.click('#p3_r_pen_n');
  await page.fill('#p3_r_sog_away', '18');
  await page.fill('#p3_r_sog_home', '16');
  await page.click('#p3_lockResults');

  await page.click('#toGoodBoy');

  // Good Boy is possible if someone wins P3; if present, continue through to regulation.
  if (await page.locator('text=Good Boy').count()) {
    await page.click('#toPostgame');
  }

  // Regulation (non-tie)
  await expect(page.locator('text=Regulation Result')).toBeVisible();
  
  // Invariant: total regulation goals must be >= number of periods marked Goals? = Yes.
  // Here P1 and P3 were marked Goals?=Yes => minimum total goals is 2.
  await page.fill('#regAwayGoals', '1');
  await page.fill('#regHomeGoals', '0');
  await page.click('#regPPNo');
  page.once('dialog', async (d) => { await d.accept(); });
  await page.click('#lockRegulation');
  st = await getState(page);
  expect(st.regulation.locked).toBeFalsy();

  // Now enter a valid non-tie regulation score.
  await page.fill('#regAwayGoals', '3');
  await page.fill('#regHomeGoals', '2');
  await page.click('#regPPYes');
  await page.click('#lockRegulation');
  await page.click('#awardPregame');

  await expect(page.locator('text=Postgame Summary')).toBeVisible();

  // Sanity: scores non-negative
  st = await getState(page);
  expect(st.score.player).toBeGreaterThanOrEqual(0);
  expect(st.score.house).toBeGreaterThanOrEqual(0);
});
