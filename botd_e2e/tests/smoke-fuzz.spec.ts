import { test, expect } from '@playwright/test';
import { startNewGame } from './helpers';

const yn = ['Yes','No'] as const;

async function pick(page, idYes: string, idNo: string, val: typeof yn[number]) {
  await page.click(val === 'Yes' ? idYes : idNo);
}

test('Smoke fuzz: 3 random games HOUSE + 3 random games VS (no crashes, reaches regulation)', async ({ page }) => {
  for (const mode of ['HOUSE','VS'] as const) {
    for (let i = 0; i < 3; i++) {
      await startNewGame(page, { mode, away: 'A', home: 'B', player1: 'P1', player2: 'P2', ante: 'x' });

      await page.click('#q1_playerAway');
      await page.click('#q1_houseHome');
      await page.click('#toQ2');

      await page.click('#q2_player_Yes');
      await page.click('#q2_house_Yes');
      await page.click('#toP1');

      // P1
      await pick(page, '#p1q1_player_Yes', '#p1q1_player_No', yn[Math.floor(Math.random()*2)]);
      await pick(page, '#p1q2_player_Yes', '#p1q2_player_No', yn[Math.floor(Math.random()*2)]);
      await pick(page, '#p1q3_player_Yes', '#p1q3_player_No', yn[Math.floor(Math.random()*2)]);
      await pick(page, '#p1q1_house_Yes', '#p1q1_house_No', yn[Math.floor(Math.random()*2)]);
      await pick(page, '#p1q2_house_Yes', '#p1q2_house_No', yn[Math.floor(Math.random()*2)]);
      await pick(page, '#p1q3_house_Yes', '#p1q3_house_No', yn[Math.floor(Math.random()*2)]);

      await page.check(Math.random() < 0.5 ? '#p1_r_goal_y' : '#p1_r_goal_n');
      await page.check(Math.random() < 0.5 ? '#p1_r_pen_y' : '#p1_r_pen_n');
      await page.fill('#p1_r_sog_away', '6');
      await page.fill('#p1_r_sog_home', '6');
      await page.click('#p1_lockResults');
      await page.click('#toP2');

      // P2
      await pick(page, '#p2q1_player_Yes', '#p2q1_player_No', yn[Math.floor(Math.random()*2)]);
      await pick(page, '#p2q2_player_Yes', '#p2q2_player_No', yn[Math.floor(Math.random()*2)]);
      await pick(page, '#p2q3_player_Yes', '#p2q3_player_No', yn[Math.floor(Math.random()*2)]);
      await pick(page, '#p2q1_house_Yes', '#p2q1_house_No', yn[Math.floor(Math.random()*2)]);
      await pick(page, '#p2q2_house_Yes', '#p2q2_house_No', yn[Math.floor(Math.random()*2)]);
      await pick(page, '#p2q3_house_Yes', '#p2q3_house_No', yn[Math.floor(Math.random()*2)]);

      await page.check(Math.random() < 0.5 ? '#p2_r_goal_y' : '#p2_r_goal_n');
      await page.check(Math.random() < 0.5 ? '#p2_r_pen_y' : '#p2_r_pen_n');
      await page.fill('#p2_r_sog_away', '12');
      await page.fill('#p2_r_sog_home', '12');
      await page.click('#p2_lockResults');
      await page.click('#toP3');

      // P3
      await pick(page, '#p3q1_player_Yes', '#p3q1_player_No', yn[Math.floor(Math.random()*2)]);
      await pick(page, '#p3q2_player_Yes', '#p3q2_player_No', yn[Math.floor(Math.random()*2)]);
      await pick(page, '#p3q3_player_Yes', '#p3q3_player_No', yn[Math.floor(Math.random()*2)]);
      await pick(page, '#p3q1_house_Yes', '#p3q1_house_No', yn[Math.floor(Math.random()*2)]);
      await pick(page, '#p3q2_house_Yes', '#p3q2_house_No', yn[Math.floor(Math.random()*2)]);
      await pick(page, '#p3q3_house_Yes', '#p3q3_house_No', yn[Math.floor(Math.random()*2)]);

      await page.check(Math.random() < 0.5 ? '#p3_r_goal_y' : '#p3_r_goal_n');
      await page.check(Math.random() < 0.5 ? '#p3_r_pen_y' : '#p3_r_pen_n');
      await page.fill('#p3_r_sog_away', '18');
      await page.fill('#p3_r_sog_home', '18');
      await page.click('#p3_lockResults');
      await page.click('#toGoodBoy');

      // If on goodboy screen, continue
      if ((await page.locator('#toPostgame').count()) > 0) {
        await page.click('#toPostgame');
      }

      // Should be on regulation (at least)
      await expect(page.locator('text=Regulation Result')).toBeVisible();

      // Reset for next iteration
      await page.evaluate(() => localStorage.removeItem('botd_state'));
    }
  }
});
