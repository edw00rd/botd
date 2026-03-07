import { test, expect } from '@playwright/test';
import { startNewGame, getState, assertNearTop } from './helpers';

test('HOUSE mode: complete a full game flow (includes scratch assertions)', async ({ page }) => {
  test.setTimeout(3 * 60_000);

  await startNewGame(page, {
    mode: 'HOUSE',
    away: 'Canucks',
    home: 'Kraken',
    player1: 'Tom',
    player2: 'House',
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

  // -------- Period 1 (Player wins -> earns 1 DOG) --------
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
  await page.fill('#p1_r_sog_away', '6');
  await page.fill('#p1_r_sog_home', '6');
  await page.click('#p1_lockResults');

  let st = await getState(page);
  expect(st.dogs).toBe(1);

  // Continue to P2: should land near DOG spend tile because dogs exist
  await page.click('#toP2');
  await expect(page.locator('#dogsSpendTile')).toHaveCount(1);
  await assertNearTop(page, '#dogsSpendTile');

  // -------- Period 2: Spend 1 DOG to scratch Q1 --------
  const dogsBefore = (await getState(page)).dogs;
  expect(dogsBefore).toBeGreaterThan(0);

  await page.click('#scratch_q1');

  // Scratch panel should disappear (P2 only allows 1 scratch)
  await expect(page.locator('#scratch_q1')).toHaveCount(0);
  await expect(page.locator('#dogsSpendTile')).toHaveCount(0);

  st = await getState(page);
  expect(st.dogs).toBe(dogsBefore - 1);
  expect(st.periods?.p2?.dogSpend?.scratchedList?.length ?? 0).toBe(1);

  // Scratched questions must be visibly marked with 🦴 (not 🔒)
  await expect(page.locator('text=🦴')).toHaveCount(1);

  // Finish P2 (no need to optimize winner here—just complete flow)
  await page.click('#p2q1_player_No');
  await page.click('#p2q2_player_Yes');
  await page.click('#p2q3_player_No');

  // House answers Q2/Q3 (Q1 may be scratched/locked)
  if (await page.locator('#p2q2_house_Yes').count()) await page.click('#p2q2_house_No');
  if (await page.locator('#p2q3_house_Yes').count()) await page.click('#p2q3_house_Yes');

  await page.click('#p2_r_goal_n');
  await page.click('#p2_r_pen_y');
  await page.fill('#p2_r_sog_away', '12'); // start was 6
  await page.fill('#p2_r_sog_home', '10'); // start was 6
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
  await page.fill('#p3_r_sog_away', '18'); // start was 12
  await page.fill('#p3_r_sog_home', '16'); // start was 10
  await page.click('#p3_lockResults');

  await page.click('#toGoodBoy');

  // If we landed on Good Boy, continue through it (we don't need to roll for this deterministic test)
  if (await page.locator('text=Good Boy').count()) {
    await page.click('#toPostgame');
  }

  // Regulation (non-tie)
  await expect(page.locator('text=Regulation Result')).toBeVisible();
  
  // Invariant: total regulation goals must be >= number of periods marked Goals? = Yes
  // (and if total goals > 0, at least one period must be Goals?=Yes).
  // This game has Goals?=Yes in P1 and P3, so minimum total goals is 2.
  await page.fill('#regAwayGoals', '1');
  await page.fill('#regHomeGoals', '0');
  await page.click('#regPPNo');
  page.once('dialog', async (d) => { await d.accept(); });
  await page.click('#lockRegulation');
  let stAfterBadReg = await getState(page);
  expect(stAfterBadReg.regulation.locked).toBeFalsy();

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
