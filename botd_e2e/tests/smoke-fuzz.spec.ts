import { test, expect, type Page } from '@playwright/test';
import { startNewGame, getState } from './helpers';

function intEnv(name: string, fallback: number) {
  const raw = process.env[name];
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Deterministic PRNG (xorshift32) so fuzz runs are reproducible.
function makeRng(seed: number) {
  let x = seed | 0;
  if (x === 0) x = 0x6d2b79f5; // non-zero default
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

function seedFor(mode: 'HOUSE' | 'VS', runIndex: number, baseSeed: number) {
  const modeSalt = mode === 'HOUSE' ? 0x1234abcd : 0x89ef0123;
  // Mix baseSeed + mode + runIndex into a 32-bit seed
  return (baseSeed ^ modeSalt ^ ((runIndex + 1) * 0x9e3779b9)) >>> 0;
}

async function click(page: Page, selector: string) {
  const loc = page.locator(selector);
  await expect(loc).toHaveCount(1);
  await loc.click();
}

async function pickPreQ1(page: Page, rng: () => number) {
  const playerPick = rng() < 0.5 ? 'Away' : 'Home';
  await click(page, playerPick === 'Away' ? '#q1_playerAway' : '#q1_playerHome');

  const housePick = rng() < 0.5 ? 'Away' : 'Home';
  await click(page, housePick === 'Away' ? '#q1_houseAway' : '#q1_houseHome');

  await click(page, '#toQ2');
}

async function pickYesNoLock(page: Page, yesSel: string, noSel: string, rng: () => number) {
  await click(page, rng() < 0.5 ? yesSel : noSel);
}

async function pickPreQ2(page: Page, rng: () => number) {
  await pickYesNoLock(page, '#q2_player_Yes', '#q2_player_No', rng);
  await pickYesNoLock(page, '#q2_house_Yes', '#q2_house_No', rng);
  await click(page, '#toP1');
}

async function pickPeriodPicks(page: Page, key: 'p1' | 'p2' | 'p3', rng: () => number) {
  // Player locks Q1–Q3 first
  await pickYesNoLock(page, `#${key}q1_player_Yes`, `#${key}q1_player_No`, rng);
  await pickYesNoLock(page, `#${key}q2_player_Yes`, `#${key}q2_player_No`, rng);
  await pickYesNoLock(page, `#${key}q3_player_Yes`, `#${key}q3_player_No`, rng);

  // House/Player2 answers after player locked all 3
  // If a question is scratched, those buttons may be absent; only click if present.
  for (const q of ['q1', 'q2', 'q3'] as const) {
    const yes = page.locator(`#${key}${q}_house_Yes`);
    if (await yes.count()) {
      await pickYesNoLock(page, `#${key}${q}_house_Yes`, `#${key}${q}_house_No`, rng);
    }
  }
}

async function setPeriodResults(page: Page, key: 'p1' | 'p2' | 'p3', rng: () => number) {
  // Goal / penalty (mutually exclusive checkboxes)
  const goalYes = rng() < 0.5;
  await click(page, goalYes ? `#${key}_r_goal_y` : `#${key}_r_goal_n`);

  const penYes = rng() < 0.5;
  await click(page, penYes ? `#${key}_r_pen_y` : `#${key}_r_pen_n`);

  // SOG totals: keep monotonic & >=0 by basing "end" on current state start totals
  const st = await getState(page);
  const startAway = st?.sog?.start?.away ?? 0;
  const startHome = st?.sog?.start?.home ?? 0;

  const addAway = 3 + Math.floor(rng() * 10); // 3..12
  const addHome = 3 + Math.floor(rng() * 10); // 3..12

  await page.locator(`#${key}_r_sog_away`).fill(String(startAway + addAway));
  await page.locator(`#${key}_r_sog_home`).fill(String(startHome + addHome));

  await click(page, `#${key}_lockResults`);
}

async function maybeSpendDog(page: Page, mode: 'HOUSE' | 'VS', key: 'p2' | 'p3', rng: () => number) {
  // Spend a DOG ~30% of the time if the spend tile is present.
  if (rng() >= 0.3) return;

  const expectScratchRemoved = async (btnSelector: string) => {
    // After the click + re-render, the clicked scratch button should no longer be rendered.
    await expect(page.locator(btnSelector)).toHaveCount(0);
  };

  if (mode === 'HOUSE') {
    const tile = page.locator('#dogsSpendTile');
    if (!(await tile.count())) return;

    const which = rng();
    const btn = which < 0.34 ? '#scratch_q1' : which < 0.67 ? '#scratch_q2' : '#scratch_q3';
    await click(page, btn);

    await expectScratchRemoved(btn);

    // P2 allows only 1 scratch, so the whole tile should disappear.
    if (key === 'p2') await expect(tile).toHaveCount(0);
    return;
  }

  // VS: try player first, then house.
  const playerTile = page.locator('#dogsSpendTile_player');
  const houseTile  = page.locator('#dogsSpendTile_house');
  const preferPlayer = rng() < 0.5;

  const trySide = async (side: 'player' | 'house') => {
    const tile = side === 'player' ? playerTile : houseTile;
    if (!(await tile.count())) return false;

    const which = rng();
    const btn = which < 0.34 ? `#scratch_${side}_q1` : which < 0.67 ? `#scratch_${side}_q2` : `#scratch_${side}_q3`;
    await click(page, btn);

    await expectScratchRemoved(btn);
    if (key === 'p2') await expect(tile).toHaveCount(0); // P2 max 1 scratch

    return true;
  };

  if (preferPlayer) {
    if (await trySide('player')) return;
    await trySide('house');
  } else {
    if (await trySide('house')) return;
    await trySide('player');
  }
}

async function finishRegulationToPostgame(page: Page, rng: () => number) {
  // If we hit Good Boy, skip straight to regulation (we don't need to resolve it for this smoke pass).
  if (await page.locator('text=Good Boy').count()) {
    const cont = page.locator('#toPostgame');
    if (await cont.count()) await cont.click();
  }

  // Regulation screen
  await expect(page.locator('text=Regulation Result')).toHaveCount(1);

  const st = await getState(page);

  const periods = ['p1','p2','p3'] as const;
  const periodsWithGoals = periods.reduce((acc, k) => acc + ((st?.periods?.[k]?.results?.goal === 'Yes') ? 1 : 0), 0);

  const endAwaySog = st?.sog?.end?.away ?? st?.sog?.start?.away ?? 0;
  const endHomeSog = st?.sog?.end?.home ?? st?.sog?.start?.home ?? 0;
  const totalSog = (endAwaySog ?? 0) + (endHomeSog ?? 0);

  // If no period had Goals?=Yes, the only consistent regulation score is 0–0 (tie -> OT/SO).
  if (periodsWithGoals === 0) {
    await page.locator('#regAwayGoals').fill('0');
    await page.locator('#regHomeGoals').fill('0');
    await click(page, '#regPPNo');
    await click(page, '#lockRegulation');

    // Go to OT flow
    await click(page, '#toOT');

    // OT picks (player then house)
    await pickYesNoLock(page, '#ot_playerYes', '#ot_playerNo', rng);
    await pickYesNoLock(page, '#ot_houseYes', '#ot_houseNo', rng);

    // Decide whether the real game ended in OT or SO
    const endedInOT = rng() < 0.5;
    await click(page, endedInOT ? '#ot_truthYes' : '#ot_truthNo');
    await click(page, '#ot_lockTruth');

    if (endedInOT) {
      // Choose final winner and finalize
      await click(page, rng() < 0.5 ? '#finalWinnerAway' : '#finalWinnerHome');
      await click(page, '#finalizeFromOT');
    } else {
      // Continue to shootout
      await click(page, '#toSO');

      // SO picks (player then house)
      await pickYesNoLock(page, '#so_playerYes', '#so_playerNo', rng);
      await pickYesNoLock(page, '#so_houseYes', '#so_houseNo', rng);

      // Truth: shootout longer than 3?
      await click(page, rng() < 0.5 ? '#so_truthYes' : '#so_truthNo');
      await click(page, '#so_lockTruth');

      // Choose final winner and finalize
      await click(page, rng() < 0.5 ? '#finalWinnerAwaySO' : '#finalWinnerHomeSO');
      await click(page, '#finalizeFromSO');
    }

    // Postgame
    await expect(page.locator('text=Postgame Summary')).toHaveCount(1);

    const st2 = await getState(page);
    expect(st2?.score?.player).toBeGreaterThanOrEqual(0);
    expect(st2?.score?.house).toBeGreaterThanOrEqual(0);
    return;
  }

  // Otherwise, pick a non-tie regulation score that respects:
  //  - totalGoals >= periodsWithGoals
  //  - totalSOG >= totalGoals
  //  - totalGoals > 0 implies at least one period Goals?=Yes (already true here)
  const maxGoals = Math.max(periodsWithGoals, Math.min(totalSog, 12)); // keep small but valid
  const totalGoals = Math.min(maxGoals, periodsWithGoals + Math.floor(rng() * 4)); // +0..3

  // Split goals between teams, ensuring non-tie.
  let a = Math.floor(rng() * (totalGoals + 1));
  let h = totalGoals - a;

  // Avoid tie (e.g., 1-1, 2-2)
  if (a === h) {
    if (a === 0) a = totalGoals; // move all to away
    else { a += 1; h -= 1; }
  }
  if (h < 0) { h = 0; a = totalGoals; }

  await page.locator('#regAwayGoals').fill(String(a));
  await page.locator('#regHomeGoals').fill(String(h));

  // PP goal can only be Yes if totalGoals > 0.
  await click(page, (totalGoals > 0 && rng() < 0.5) ? '#regPPYes' : '#regPPNo');
  await click(page, '#lockRegulation');

  // Award pregame points (non-tie)
  await click(page, '#awardPregame');

  // Postgame
  await expect(page.locator('text=Postgame Summary')).toHaveCount(1);

  const st3 = await getState(page);
  expect(st3?.score?.player).toBeGreaterThanOrEqual(0);
  expect(st3?.score?.house).toBeGreaterThanOrEqual(0);
}

test('Smoke fuzz: 42/42 HOUSE + VS flows are deterministic & reach Postgame', async ({ page }, testInfo) => {
  test.setTimeout(15 * 60_000);

  const runsPerMode = intEnv('BOTD_FUZZ_RUNS', 42);
  const baseSeed = intEnv('BOTD_SEED', 42);

  // Optional: run a single case to reproduce a CI failure.
  // Examples:
  //   BOTD_FUZZ_MODE=HOUSE BOTD_FUZZ_RUN=17  (run HOUSE iteration #17 only)
  //   BOTD_FUZZ_MODE=VS    BOTD_FUZZ_RUN=1   (run VS iteration #1 only)
  const onlyMode = (process.env.BOTD_FUZZ_MODE || '').toUpperCase();
  const onlyRun = process.env.BOTD_FUZZ_RUN ? parseInt(process.env.BOTD_FUZZ_RUN, 10) : NaN;

  testInfo.annotations.push({ type: 'seed', description: `BOTD_SEED=${baseSeed} BOTD_FUZZ_RUNS=${runsPerMode}` });

  const modes = (onlyMode === 'HOUSE' || onlyMode === 'VS') ? ([onlyMode] as Array<'HOUSE'|'VS'>) : (['HOUSE','VS'] as const);

  for (const mode of modes) {
    const startIdx = Number.isFinite(onlyRun) && onlyRun >= 1 ? (onlyRun - 1) : 0;
    const endIdx = Number.isFinite(onlyRun) && onlyRun >= 1 ? onlyRun : runsPerMode;

    for (let i = startIdx; i < endIdx; i++) {
      const runSeed = seedFor(mode, i, baseSeed);
      const rng = makeRng(runSeed);

      console.log(`[BOTD smoke-fuzz] ${mode} run ${i + 1}/${runsPerMode} seed=${runSeed}`);

      await startNewGame(page, {
        mode,
        away: `AW${i}`,
        home: `HM${i}`,
        player1: 'P1',
        player2: mode === 'VS' ? 'P2' : 'House',
        ante: '42'
      });

      await pickPreQ1(page, rng);
      await pickPreQ2(page, rng);

      // Period 1
      await pickPeriodPicks(page, 'p1', rng);
      await setPeriodResults(page, 'p1', rng);
      await click(page, '#toP2');

      // Period 2 (maybe dog spend)
      await maybeSpendDog(page, mode, 'p2', rng);
      await pickPeriodPicks(page, 'p2', rng);
      await setPeriodResults(page, 'p2', rng);
      await click(page, '#toP3');

      // Period 3 (maybe dog spend)
      await maybeSpendDog(page, mode, 'p3', rng);
      await pickPeriodPicks(page, 'p3', rng);
      await setPeriodResults(page, 'p3', rng);

      await click(page, '#toGoodBoy');

      await finishRegulationToPostgame(page, rng);

      // Start fresh for the next run
      await page.evaluate(() => localStorage.removeItem('botd_state'));
    }
  }
});
