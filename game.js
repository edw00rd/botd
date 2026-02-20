// BOTD — game.js (drop-in: adds Period 1 with manual results + SOG tracking scaffolding)
// - Away @ Home convention
// - "House" terminology
// - Side-by-side sealed picks (hidden after lock; only 🔒 Locked shows)
// - Pre-Game Q1 + Q2
// - Period 1: 3 questions + House enters results with buttons + SOG totals
// - SOG logic: start at 0/0, House enters end totals, period SOG = end - start
// - LIVE toggle scaffolding + House override to disable LIVE anytime (API later)

const state = JSON.parse(localStorage.getItem("botd_state"));
const gameEl = document.getElementById("game");

if (!state) {
  gameEl.textContent = "No game state found. Go back to setup.";
} else {
  // Back-compat: older saves may have scorekeeper instead of house
  state.house = state.house ?? state.scorekeeper;

  // Core
  state.score = state.score ?? { player: 0, house: 0 };
  state.dogs = state.dogs ?? 0;

  // LIVE toggle (API later); House can disable anytime
  state.live = !!state.live;

  // Routing
  state.screen = state.screen ?? "pre_q1"; // pre_q1 -> pre_q2 -> p1 -> p2_stub

  // Shots-on-goal tracking (totals)
  // Start game assumed 0/0; end-of-period totals entered by House when LIVE is off.
  state.sog = state.sog ?? {
    start: { away: 0, home: 0 },
    end: { away: 0, home: 0 }
  };

  // Pre-game answers
  state.pre = state.pre ?? {};
  state.pre.q1 = state.pre.q1 ?? mkPickState("Away|Home");
  state.pre.q2 = state.pre.q2 ?? mkPickState("Yes|No");

  // Periods
  state.periods = state.periods ?? {};
  state.periods.p1 = state.periods.p1 ?? mkPeriodState();

  render();
}

function mkPickState(_type) {
  return {
    player: null,
    house: null,
    lockedPlayer: false,
    lockedHouse: false
  };
}

function mkPeriodState() {
  return {
    picks: {
      q1_goal: mkPickState("Yes|No"),
      q2_penalty: mkPickState("Yes|No"),
      q3_both5sog: mkPickState("Yes|No")
    },
    results: {
      goal: null,      // "Yes" | "No"
      penalty: null,   // "Yes" | "No"
      endSogAway: null, // number
      endSogHome: null  // number
    },
    lockedResults: false,
    computed: null // filled after results lock
  };
}

function render() {
  const away = state.away;
  const home = state.home;

  const headerHTML = `
    <div style="border:1px solid #ccc; padding:12px; max-width:720px;">
      <h2 style="margin-top:0;">${away} @ ${home}</h2>

      <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
        <div>
          <p style="margin:6px 0;"><strong>${state.player1}</strong> vs <strong>${state.house}</strong></p>
          <p style="margin:6px 0;">
            <strong>Score:</strong> ${state.player1} ${state.score.player} — ${state.house} ${state.score.house}
            &nbsp; | &nbsp; <strong>DOGs:</strong> ${state.dogs}
          </p>
          <p style="margin:6px 0;"><strong>ANTE:</strong> ${state.ante || "(none)"} </p>
        </div>

        <div style="text-align:right;">
          <p style="margin:6px 0;"><strong>LIVE:</strong> ${state.live ? "ON" : "OFF"}</p>
          ${state.live ? `<button id="disableLive">Disable LIVE (House Override)</button>` : ""}
          <p style="margin:6px 0; font-size:0.9rem; opacity:0.75;">
            ${state.live ? "Stats will come from API later." : "House enters period stats manually."}
          </p>
        </div>
      </div>
    </div>
  `;

  let screenHTML = "";
  if (state.screen === "pre_q1") screenHTML = renderPreQ1();
  else if (state.screen === "pre_q2") screenHTML = renderPreQ2();
  else if (state.screen === "p1") screenHTML = renderPeriod1();
  else if (state.screen === "p2_stub") {
    screenHTML = `
      <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:720px;">
        <h3 style="margin-top:0;">Period 2 (Next)</h3>
        <p>Period 1 is complete. Next up: Period 2 questions + DOG spending/termination.</p>
        <button id="backToP1">Back</button>
      </div>
    `;
  } else {
    screenHTML = `
      <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:720px;">
        <p>Unknown screen: ${state.screen}</p>
      </div>
    `;
  }

  gameEl.innerHTML = `${headerHTML}${screenHTML}`;

  wireHandlers();
  localStorage.setItem("botd_state", JSON.stringify(state));
}

function renderSideBySideQuestion({ title, questionText, leftName, rightName, leftSectionHTML, rightSectionHTML, backHTML = "", continueHTML = "" }) {
  return `
    <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:720px;">
      <h3 style="margin-top:0;">${title}</h3>
      <p><strong>${questionText}</strong></p>

      <div style="display:flex; gap:12px; align-items:flex-start;">
        <div style="flex:1; border-top:1px solid #eee; padding-top:10px;">
          <div style="font-weight:700; margin-bottom:6px;">${leftName}</div>
          ${leftSectionHTML}
        </div>

        <div style="width:1px; background:#eee; align-self:stretch;"></div>

        <div style="flex:1; border-top:1px solid #eee; padding-top:10px;">
          <div style="font-weight:700; margin-bottom:6px;">${rightName}</div>
          ${rightSectionHTML}
        </div>
      </div>

      <div style="display:flex; gap:10px; margin-top:12px;">
        ${backHTML}
        ${continueHTML}
      </div>
    </div>
  `;
}

function sealedYesNoSection({ idPrefix, lockedSelf, lockedOther, requireOtherLock }) {
  // requireOtherLock: if true, buttons disabled until other locks
  // lockedOther is used to determine disable state (e.g., House cannot act until player locks)
  const lockedUI = `<div style="margin:8px 0;"><strong>🔒 Locked</strong></div>`;

  if (lockedSelf) return lockedUI;

  const disabled = requireOtherLock && !lockedOther ? "disabled" : "";
  const helper = requireOtherLock && !lockedOther
    ? `<div style="font-size:0.95rem; opacity:0.8;">Player locks first.</div>`
    : "";

  return `
    <div style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;">
      <button id="${idPrefix}_Yes" ${disabled}>Yes</button>
      <button id="${idPrefix}_No" ${disabled}>No</button>
    </div>
    ${helper}
  `;
}

function renderPreQ1() {
  const q1 = state.pre.q1;

  const playerSection = q1.lockedPlayer
    ? `<div style="margin:8px 0;"><strong>🔒 Locked</strong></div>`
    : `
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;">
        <button id="q1_playerAway">${state.away}</button>
        <button id="q1_playerHome">${state.home}</button>
      </div>
    `;

  const houseSection = q1.lockedHouse
    ? `<div style="margin:8px 0;"><strong>🔒 Locked</strong></div>`
    : `
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;">
        <button id="q1_houseAway" ${!q1.lockedPlayer ? "disabled" : ""}>${state.away}</button>
        <button id="q1_houseHome" ${!q1.lockedPlayer ? "disabled" : ""}>${state.home}</button>
      </div>
      ${!q1.lockedPlayer ? `<div style="font-size:0.95rem; opacity:0.8;">Player locks first.</div>` : ""}
    `;

  const continueHTML = (q1.lockedPlayer && q1.lockedHouse) ? `<button id="toQ2">Continue</button>` : "";

  return renderSideBySideQuestion({
    title: "Pre-Game Q1 (1 pt)",
    questionText: "Who will win the game?",
    leftName: state.player1,
    rightName: state.house,
    leftSectionHTML: playerSection,
    rightSectionHTML: houseSection,
    continueHTML
  });
}

function renderPreQ2() {
  const q2 = state.pre.q2;

  const playerSection = sealedYesNoSection({
    idPrefix: "q2_player",
    lockedSelf: q2.lockedPlayer,
    lockedOther: true,
    requireOtherLock: false
  });

  const houseSection = sealedYesNoSection({
    idPrefix: "q2_house",
    lockedSelf: q2.lockedHouse,
    lockedOther: q2.lockedPlayer,
    requireOtherLock: true
  });

  const backHTML = `<button id="backToQ1">Back</button>`;
  const continueHTML = (q2.lockedPlayer && q2.lockedHouse) ? `<button id="toP1">Start Period 1</button>` : "";

  return renderSideBySideQuestion({
    title: "Pre-Game Q2 (1 pt)",
    questionText: "Will there be a power-play goal in the game?",
    leftName: state.player1,
    rightName: state.house,
    leftSectionHTML: playerSection,
    rightSectionHTML: houseSection,
    backHTML,
    continueHTML
  });
}

function renderPeriod1() {
  const p1 = state.periods.p1;
  const picks = p1.picks;

  // Question cards (three sealed yes/no)
  const qCard = (label, pickState, idPrefix) => {
    const playerSection = sealedYesNoSection({
      idPrefix: `${idPrefix}_player`,
      lockedSelf: pickState.lockedPlayer,
      lockedOther: true,
      requireOtherLock: false
    });

    const houseSection = sealedYesNoSection({
      idPrefix: `${idPrefix}_house`,
      lockedSelf: pickState.lockedHouse,
      lockedOther: pickState.lockedPlayer,
      requireOtherLock: true
    });

    const ready = pickState.lockedPlayer && pickState.lockedHouse;

    return `
      <div style="border:1px solid #eee; padding:10px; margin-top:10px;">
        <div style="font-weight:700; margin-bottom:6px;">${label}</div>
        <div style="display:flex; gap:12px; align-items:flex-start;">
          <div style="flex:1;">
            <div style="font-weight:700; margin-bottom:6px;">${state.player1}</div>
            ${playerSection}
          </div>
          <div style="width:1px; background:#eee; align-self:stretch;"></div>
          <div style="flex:1;">
            <div style="font-weight:700; margin-bottom:6px;">${state.house}</div>
            ${houseSection}
          </div>
        </div>
        ${ready ? `<div style="margin-top:6px; font-size:0.9rem; opacity:0.75;">Both locked ✅</div>` : ""}
      </div>
    `;
  };

  const allLocked =
    picks.q1_goal.lockedPlayer && picks.q1_goal.lockedHouse &&
    picks.q2_penalty.lockedPlayer && picks.q2_penalty.lockedHouse &&
    picks.q3_both5sog.lockedPlayer && picks.q3_both5sog.lockedHouse;

  // Results panel: only after all picks locked
  const resultsPanel = () => {
    const r = p1.results;

    // If LIVE is on, we still show manual inputs (API later), but House can disable LIVE anytime.
    // For now, LIVE simply changes the label.
    const note = state.live
      ? `<div style="font-size:0.9rem; opacity:0.75; margin-bottom:8px;">LIVE is ON (API later). House can still enter results now.</div>`
      : `<div style="font-size:0.9rem; opacity:0.75; margin-bottom:8px;">House enters end-of-period totals.</div>`;

    const lockedUI = p1.lockedResults
      ? `<div style="margin:8px 0;"><strong>🔒 Period 1 results locked</strong></div>`
      : `
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin:8px 0;">
          <button id="r_goal_yes">Goal: Yes</button>
          <button id="r_goal_no">Goal: No</button>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin:8px 0;">
          <button id="r_pen_yes">Penalty: Yes</button>
          <button id="r_pen_no">Penalty: No</button>
        </div>

        <div style="display:flex; gap:10px; flex-wrap:wrap; margin:8px 0;">
          <div style="flex:1;">
            <div style="font-weight:700; margin-bottom:4px;">End SOG — Away (${state.away})</div>
            <input id="r_sog_away" type="number" min="0" inputmode="numeric" placeholder="e.g., 8" style="width:100%; padding:10px; border:1px solid #ccc;" />
          </div>
          <div style="flex:1;">
            <div style="font-weight:700; margin-bottom:4px;">End SOG — Home (${state.home})</div>
            <input id="r_sog_home" type="number" min="0" inputmode="numeric" placeholder="e.g., 11" style="width:100%; padding:10px; border:1px solid #ccc;" />
          </div>
        </div>

        <button id="lockP1Results">Lock Period 1 Results</button>

        <div style="margin-top:8px; font-size:0.9rem; opacity:0.75;">
          Start-of-game SOG assumed: Away 0, Home 0. (Later periods: start = last period end)
        </div>
      `;

    const computed = p1.computed ? renderP1ComputedSummary() : "";

    return `
      <div style="margin-top:12px; border:1px solid #ddd; padding:10px;">
        <div style="font-weight:700; margin-bottom:6px;">Period 1 Results (House)</div>
        ${note}
        ${lockedUI}
        ${computed}
      </div>
    `;
  };

  const continueHTML = (p1.computed && p1.lockedResults)
    ? `<button id="toP2Stub">Continue to Period 2</button>`
    : "";

  return `
    <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:720px;">
      <h3 style="margin-top:0;">Period 1 (3 pts possible)</h3>

      ${qCard("Q1: Will there be a goal this period?", picks.q1_goal, "p1q1")}
      ${qCard("Q2: Will there be a penalty this period?", picks.q2_penalty, "p1q2")}
      ${qCard("Q3: Will each team record at least 5 shots on goal this period?", picks.q3_both5sog, "p1q3")}

      ${allLocked ? resultsPanel() : `<div style="margin-top:12px; font-size:0.95rem; opacity:0.75;">Lock all picks to enter results.</div>`}

      <div style="display:flex; gap:10px; margin-top:12px;">
        <button id="backToQ2">Back</button>
        ${continueHTML}
      </div>
    </div>
  `;
}

function renderP1ComputedSummary() {
  const p1 = state.periods.p1;
  const c = p1.computed;
  if (!c) return "";

  const winnerText = c.periodWinner === "player"
    ? `${state.player1} wins Period 1 ✅ (DOG +1)`
    : c.periodWinner === "house"
      ? `${state.house} wins Period 1 ✅ (House may terminate 1 DOG)`
      : `Period 1 is a tie (no DOG changes)`;

  return `
    <div style="margin-top:10px; padding:10px; border:1px solid #eee;">
      <div style="font-weight:700; margin-bottom:6px;">Scoring Summary</div>
      <div style="margin:6px 0;"><strong>${state.player1} correct:</strong> ${c.playerCorrect} / 3</div>
      <div style="margin:6px 0;"><strong>${state.house} correct:</strong> ${c.houseCorrect} / 3</div>
      <div style="margin:6px 0;"><strong>Period Winner:</strong> ${winnerText}</div>
      <div style="margin:6px 0; font-size:0.9rem; opacity:0.75;">
        Period SOG: Away ${c.periodSog.away}, Home ${c.periodSog.home} (start ${c.startSog.away}/${c.startSog.home} → end ${c.endSog.away}/${c.endSog.home})
      </div>
    </div>
  `;
}

function wireHandlers() {
  // Global: disable LIVE
  const disableLive = document.getElementById("disableLive");
  if (disableLive) {
    disableLive.onclick = () => {
      state.live = false;
      render();
    };
  }

  // Navigation + wiring per screen
  if (state.screen === "pre_q1") wirePreQ1Buttons();
  if (state.screen === "pre_q2") wirePreQ2Buttons();
  if (state.screen === "p1") wireP1Buttons();

  // Nav buttons
  const toQ2 = document.getElementById("toQ2");
  if (toQ2) toQ2.onclick = () => { state.screen = "pre_q2"; render(); };

  const backToQ1 = document.getElementById("backToQ1");
  if (backToQ1) backToQ1.onclick = () => { state.screen = "pre_q1"; render(); };

  const toP1 = document.getElementById("toP1");
  if (toP1) toP1.onclick = () => { state.screen = "p1"; render(); };

  const backToQ2 = document.getElementById("backToQ2");
  if (backToQ2) backToQ2.onclick = () => { state.screen = "pre_q2"; render(); };

  const toP2Stub = document.getElementById("toP2Stub");
  if (toP2Stub) toP2Stub.onclick = () => { state.screen = "p2_stub"; render(); };

  const backToP1 = document.getElementById("backToP1");
  if (backToP1) backToP1.onclick = () => { state.screen = "p1"; render(); };
}

function wirePreQ1Buttons() {
  const q1 = state.pre.q1;

  const pAway = document.getElementById("q1_playerAway");
  const pHome = document.getElementById("q1_playerHome");
  if (pAway) pAway.onclick = () => { q1.player = "Away"; q1.lockedPlayer = true; render(); };
  if (pHome) pHome.onclick = () => { q1.player = "Home"; q1.lockedPlayer = true; render(); };

  const hAway = document.getElementById("q1_houseAway");
  const hHome = document.getElementById("q1_houseHome");
  if (hAway) hAway.onclick = () => { q1.house = "Away"; q1.lockedHouse = true; render(); };
  if (hHome) hHome.onclick = () => { q1.house = "Home"; q1.lockedHouse = true; render(); };
}

function wirePreQ2Buttons() {
  const q2 = state.pre.q2;

  const pYes = document.getElementById("q2_player_Yes");
  const pNo = document.getElementById("q2_player_No");
  if (pYes) pYes.onclick = () => { q2.player = "Yes"; q2.lockedPlayer = true; render(); };
  if (pNo) pNo.onclick = () => { q2.player = "No"; q2.lockedPlayer = true; render(); };

  const hYes = document.getElementById("q2_house_Yes");
  const hNo = document.getElementById("q2_house_No");
  if (hYes) hYes.onclick = () => { q2.house = "Yes"; q2.lockedHouse = true; render(); };
  if (hNo) hNo.onclick = () => { q2.house = "No"; q2.lockedHouse = true; render(); };
}

function wireP1Buttons() {
  const p1 = state.periods.p1;

  // Helper to wire yes/no for a pickState
  const wirePickYesNo = (pickState, prefix) => {
    const pYes = document.getElementById(`${prefix}_player_Yes`);
    const pNo = document.getElementById(`${prefix}_player_No`);
    if (pYes) pYes.onclick = () => { pickState.player = "Yes"; pickState.lockedPlayer = true; render(); };
    if (pNo) pNo.onclick = () => { pickState.player = "No"; pickState.lockedPlayer = true; render(); };

    const hYes = document.getElementById(`${prefix}_house_Yes`);
    const hNo = document.getElementById(`${prefix}_house_No`);
    if (hYes) hYes.onclick = () => { pickState.house = "Yes"; pickState.lockedHouse = true; render(); };
    if (hNo) hNo.onclick = () => { pickState.house = "No"; pickState.lockedHouse = true; render(); };
  };

  wirePickYesNo(p1.picks.q1_goal, "p1q1");
  wirePickYesNo(p1.picks.q2_penalty, "p1q2");
  wirePickYesNo(p1.picks.q3_both5sog, "p1q3");

  // Results buttons (only exist once all picks locked and results not locked)
  const rGoalYes = document.getElementById("r_goal_yes");
  const rGoalNo = document.getElementById("r_goal_no");
  if (rGoalYes) rGoalYes.onclick = () => { p1.results.goal = "Yes"; render(); };
  if (rGoalNo) rGoalNo.onclick = () => { p1.results.goal = "No"; render(); };

  const rPenYes = document.getElementById("r_pen_yes");
  const rPenNo = document.getElementById("r_pen_no");
  if (rPenYes) rPenYes.onclick = () => { p1.results.penalty = "Yes"; render(); };
  if (rPenNo) rPenNo.onclick = () => { p1.results.penalty = "No"; render(); };

  const lockBtn = document.getElementById("lockP1Results");
  if (lockBtn) {
    lockBtn.onclick = () => {
      // Validate results
      const awayInput = document.getElementById("r_sog_away");
      const homeInput = document.getElementById("r_sog_home");

      const endAway = awayInput ? parseInt(awayInput.value, 10) : NaN;
      const endHome = homeInput ? parseInt(homeInput.value, 10) : NaN;

      if (!p1.results.goal || !p1.results.penalty || Number.isNaN(endAway) || Number.isNaN(endHome)) {
        alert("House must set Goal, Penalty, and enter end SOG totals for Away and Home.");
        return;
      }
      if (endAway < 0 || endHome < 0) {
        alert("SOG totals must be 0 or higher.");
        return;
      }

      // Use current start SOG
      const startAway = state.sog.start.away ?? 0;
      const startHome = state.sog.start.home ?? 0;

      // Period SOG = end - start (never negative; House can fix if needed)
      const periodAway = endAway - startAway;
      const periodHome = endHome - startHome;

      if (periodAway < 0 || periodHome < 0) {
        alert("End SOG cannot be less than start SOG. Check the totals.");
        return;
      }

      // Compute correctness for each side
      const correct = {
        q1: {
          player: p1.picks.q1_goal.player === p1.results.goal,
          house: p1.picks.q1_goal.house === p1.results.goal
        },
        q2: {
          player: p1.picks.q2_penalty.player === p1.results.penalty,
          house: p1.picks.q2_penalty.house === p1.results.penalty
        },
        q3: (() => {
          const truth = (periodAway >= 5 && periodHome >= 5) ? "Yes" : "No";
          return {
            truth,
            player: p1.picks.q3_both5sog.player === truth,
            house: p1.picks.q3_both5sog.house === truth
          };
        })()
      };

      const playerCorrect = (correct.q1.player ? 1 : 0) + (correct.q2.player ? 1 : 0) + (correct.q3.player ? 1 : 0);
      const houseCorrect  = (correct.q1.house ? 1 : 0) + (correct.q2.house ? 1 : 0) + (correct.q3.house ? 1 : 0);

      // Period winner: best 2 of 3 (tie -> nobody)
      let periodWinner = "none";
      if (playerCorrect >= 2 && houseCorrect < 2) periodWinner = "player";
      else if (houseCorrect >= 2 && playerCorrect < 2) periodWinner = "house";
      else periodWinner = "none";

      // DOG effects (P1)
      if (periodWinner === "player") {
        state.dogs = (state.dogs ?? 0) + 1;
      } else if (periodWinner === "house") {
        // House may terminate 1 DOG (if any). In P1 dogs likely 0, but enforce rule.
        state.dogs = Math.max(0, (state.dogs ?? 0) - 1);
      }

      // Lock results + store computed summary
      p1.results.endSogAway = endAway;
      p1.results.endSogHome = endHome;
      p1.lockedResults = true;

      p1.computed = {
        startSog: { away: startAway, home: startHome },
        endSog: { away: endAway, home: endHome },
        periodSog: { away: periodAway, home: periodHome },
        q3Truth: correct.q3.truth,
        playerCorrect,
        houseCorrect,
        periodWinner
      };

      // Update start SOG for next period = this end SOG
      state.sog.end.away = endAway;
      state.sog.end.home = endHome;
      state.sog.start.away = endAway;
      state.sog.start.home = endHome;

      render();
    };
  }
}