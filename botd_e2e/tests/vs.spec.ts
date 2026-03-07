import { test, expect } from '@playwright/test';
import { startNewGame, getState, assertNearTop } from './helpers';

test('VS mode: complete a full game flow to Postgame', async ({ page }) => {
  await startNewGame(page, { mode: 'VS', away: 'A', home: 'B', player1: 'P1', player2: 'P2', ante: 'chores' });

  // Pre-game Q1
  await page.click('#q1_playerAway');
  await page.click('#q1_houseHome');
  await page.click('#toQ2');

  // Pre-game Q2
  await page.click('#q2_player_No');
  await page.click('#q2_house_No');
  await page.click('#toP1');

  // P1 (player locks all, then P2)
  await page.click('#p1q1_player_Yes');
  await page.click('#p1q2_player_Yes');
  await page.click('#p1q3_player_Yes');
  await page.click('#p1q1_house_No');
  await page.click('#p1q2_house_No');
  await page.click('#p1q3_house_No');

  await page.check('#p1_r_goal_y');
  await page.check('#p1_r_pen_y');
  await page.fill('#p1_r_sog_away', '7');
  await page.fill('#p1_r_sog_home', '7');
  await page.click('#p1_lockResults');
  await page.click('#toP2');

  // Scroll target logic: if either side has dogs, should scroll to that side's dog tile.
  const st1 = await getState(page);
  const pDogs = st1?.dogs?.player ?? 0;
  const hDogs = st1?.dogs?.house ?? 0;
  if (pDogs > 0) {
    await expect(page.locator('#dogsSpendTile_player')).toHaveCount(1);
    await assertNearTop(page, '#dogsSpendTile_player');
  } else if (hDogs > 0) {
    await expect(page.locator('#dogsSpendTile_house')).toHaveCount(1);
    await assertNearTop(page, '#dogsSpendTile_house');
  } else {
    await assertNearTop(page, '#scoreBar');
  }

  // Play through quickly
  await page.click('#p2q1_player_No');
  await page.click('#p2q2_player_No');
  await page.click('#p2q3_player_No');
  await page.click('#p2q1_house_No');
  await page.click('#p2q2_house_No');
  await page.click('#p2q3_house_No');
  await page.check('#p2_r_goal_n');
  await page.check('#p2_r_pen_n');
  await page.fill('#p2_r_sog_away', '10');
  await page.fill('#p2_r_sog_home', '10');
  await page.click('#p2_lockResults');
  await page.click('#toP3');

  // P3
  await page.click('#p3q1_player_No');
  await page.click('#p3q2_player_No');
  await page.click('#p3q3_player_No');
  await page.click('#p3q1_house_No');
  await page.click('#p3q2_house_No');
  await page.click('#p3q3_house_No');
  await page.check('#p3_r_goal_n');
  await page.check('#p3_r_pen_n');
  await page.fill('#p3_r_sog_away', '14');
  await page.fill('#p3_r_sog_home', '14');
  await page.click('#p3_lockResults');
  await page.click('#toGoodBoy');

  // Could be goodboy or regulation depending on P3 winner; accept either and proceed
  if ((await page.locator('#toPostgame').count()) > 0) {
    await page.click('#toPostgame');
  }

  // Regulation (not tied)
  await page.fill('#regAwayGoals', '4');
  await page.fill('#regHomeGoals', '1');
  await page.click('#regPPNo');
  await page.click('#lockRegulation');
  await page.click('#awardPregame');

  await expect(page.locator('text=Postgame Summary')).toBeVisible();
});
