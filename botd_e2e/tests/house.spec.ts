import { test, expect } from '@playwright/test';
import { startNewGame, getState, assertNearTop } from './helpers';

test('HOUSE mode: complete a full game flow to Postgame', async ({ page }) => {
  await startNewGame(page, { mode: 'HOUSE', away: 'Canucks', home: 'Kraken', player1: 'Tom', player2: 'House', ante: '$5' });

  // Pre-game Q1
  await page.click('#q1_playerAway');
  await page.click('#q1_houseHome');
  await page.click('#toQ2');

  // Pre-game Q2
  await page.click('#q2_player_Yes');
  await page.click('#q2_house_No');
  await page.click('#toP1');

  // Period 1 picks (player then house)
  await page.click('#p1q1_player_Yes');
  await page.click('#p1q2_player_No');
  await page.click('#p1q3_player_Yes');
  await page.click('#p1q1_house_Yes');
  await page.click('#p1q2_house_No');
  await page.click('#p1q3_house_Yes');

  // Enter results P1
  await page.check('#p1_r_goal_y');
  await page.check('#p1_r_pen_n');
  await page.fill('#p1_r_sog_away', '8');
  await page.fill('#p1_r_sog_home', '6');
  await page.click('#p1_lockResults');

  // Continue to P2
  await page.click('#toP2');

  // If DOGs exist, dogs tile should be near top; otherwise scoreBar
  const st1 = await getState(page);
  if ((st1?.dogs ?? 0) > 0) {
    await expect(page.locator('#dogsSpendTile')).toHaveCount(1);
    await assertNearTop(page, '#dogsSpendTile');
  } else {
    await assertNearTop(page, '#scoreBar');
  }

  // Make P2 picks and results quickly
  await page.click('#p2q1_player_No');
  await page.click('#p2q2_player_No');
  await page.click('#p2q3_player_No');
  await page.click('#p2q1_house_No');
  await page.click('#p2q2_house_No');
  await page.click('#p2q3_house_No');
  await page.check('#p2_r_goal_n');
  await page.check('#p2_r_pen_n');
  await page.fill('#p2_r_sog_away', '12');
  await page.fill('#p2_r_sog_home', '11');
  await page.click('#p2_lockResults');
  await page.click('#toP3');

  // P3 picks
  await page.click('#p3q1_player_No');
  await page.click('#p3q2_player_No');
  await page.click('#p3q3_player_No');
  await page.click('#p3q1_house_No');
  await page.click('#p3q2_house_No');
  await page.click('#p3q3_house_No');
  await page.check('#p3_r_goal_n');
  await page.check('#p3_r_pen_n');
  await page.fill('#p3_r_sog_away', '18');
  await page.fill('#p3_r_sog_home', '17');
  await page.click('#p3_lockResults');
  await page.click('#toGoodBoy');

  // After P3, the game stays on game.html (single-page), but the internal "screen" should switch
// to either Regulation or Good Boy.
await page.waitForFunction(() => {
  try {
    const st = JSON.parse(localStorage.getItem('botd_state') || '{}');
    return st.screen === 'regulation';
  } catch (e) {
    return false;
  }
});


  // Regulation: not tied, award pregame points and go postgame
  await page.fill('#regAwayGoals', '3');
  await page.fill('#regHomeGoals', '2');
  await page.click('#regPPYes');
  await page.click('#lockRegulation');
  await page.click('#awardPregame');

  await expect(page).toHaveURL(/game\.html/i);
  await expect(page.locator('text=Postgame Summary')).toBeVisible();

  const finalState = await getState(page);
  expect(finalState?.score?.player).toBeGreaterThanOrEqual(0);
  expect(finalState?.score?.house).toBeGreaterThanOrEqual(0);
});
