// BOTD — game.js (drop-in)
// Includes:
// - Away @ Home convention
// - "House" terminology (+ back-compat from scorekeeper)
// - Sealed picks (hidden after lock; only 🔒 Locked shows)
// - Pre-Game Q1 + Q2
// - Period 1: 3 sealed questions + House results panel
//   * Results UI uses Y/N checkbox-style selectors (mutually exclusive) + SOG totals
//   * Results persist across re-renders/navigation (for Good Boy later)
// - SOG logic: start at 0/0, House enters end totals, period SOG = end - start
// - LIVE scaffolding + House override to disable LIVE anytime (API later)
// - Back button behavior:
//   * BACK first undoes last action on that screen (if available)
//   * Once "Start Period 1" is pressed, pregame undo is disabled (locked-in)
//   * Once "Continue to Period 2" is pressed, Period 1 undo is disabled (locked-in)

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

  // Commit flags (lock-in points)
  state.committed = state.committed ?? {
    pregame: false, // becomes true when Period 1 starts
    p1: false       // becomes true when Period 2 starts (stub for now)
  };

  // Undo stacks (per phase). We only use undo in pre_q2 and p1 for now.
  state.undo = state.undo ?? {
    pre_q2: [],
    p1: []
  };
  state.undoSig = state.undoSig ?? {
    pre_q2: null,
    p1: null
  };

  // Shots-on-goal tracking (totals)
  state.sog = state.sog ?? {
    start: { away: 0, home: 0 },
    end: { away: 0, home: 0 }
  };

  // Pre-game answers
  state.pre = state.pre ?? {};
  state.pre.q1 = state.pre.q1 ?? mkPickState(); // Away/Home
  state.pre.q2 = state.pre.q2 ?? mkPickState(); // Yes/No

  // Periods
  state.periods = state.periods ?? {};
  state.periods.p1 = state.periods.p1 ?? mkPeriodState();

  render();
}

function mkPickState() {
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
      q1_goal: mkPickState(),       // Yes/No
      q2_penalty: mkPickState(),    // Yes/No
      q3_both5sog: mkPickState()    // Yes/No
    },
    results: {
      goal: null,         // "Yes" | "No"
      penalty: null,      // "Yes" | "No"
      endSogAway: null,   // number
      endSogHome: null    // number
    },
    lockedResults: false,
    computed: null
  };
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function saveState() {
  localStorage.setItem("botd_state", JSON.stringify(state));
}

// Push undo snapshot only if not committed and snapshot differs from last pushed
function pushUndo(key, snapshotObj) {
  if (key === "pre_q2" && state.committed.pregame) return;
  if (key === "p1" && state.committed.p1) return;

  const snap = clone(snapshotObj);
  const sig = JSON.stringify(snap);

  if (state.undoSig[key] === sig) return; // avoid spam duplicates
  state.undoSig[key] = sig;

  state.undo[key].push(snap);
  if (state.undo[key].length > 30) state.undo[key].shift(); // cap stack
  saveState();
}

function tryUndo(key, applyFn) {
  const stack = state.undo?.[key];
  if (!stack || stack.length === 0) return false;

  const snap = stack.pop();
  // reset signature so next push isn't blocked incorrectly
  state.undoSig[key] = stack.length ? JSON.stringify(stack[stack.length - 1]) : null;

  applyFn(snap);
  saveState();
  render();
  return true;
}

function commitPregame() {
  state.committed.pregame = true;
  state.undo.pre_q2 = [];
  state.undoSig.pre_q2 = null;
  saveState();
}

function commitP1() {
  state.committed.p1 = true;
  state.undo.p1 = [];
  state.undoSig.p1 = null;
  saveState();
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
  saveState();
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

/* -------------------------
   Pre-Game Q1
-------------------------- */
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

/* -------------------------
   Pre-Game Q2
-------------------------- */
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

  // BACK here means: undo last change on this screen, else go to Q1 (if not committed)
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

/* -------------------------
   Period 1
-------------------------- */
function renderPeriod1() {
  const p1 = state.periods.p1;
  const picks = p1.picks;
  const r = p1.results;

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

  const resultsNote = state.live
    ? `<div style="font-size:0.9rem; opacity:0.75; margin-bottom:8px;">LIVE is ON (API later). House can still enter results now.</div>`
    : `<div style="font-size:0.9rem; opacity:0.75; margin-bottom:8px;">House enters end-of-period totals.</div>`;

  const resultsPanel = allLocked ? `
    <div style="margin-top:12px; border:1px solid #ddd; padding:10px;">
      <div style="font-weight:700; margin-bottom:6px;">Period 1 Results (House)</div>
      ${resultsNote}

      ${
        p1.lockedResults
          ? `<div style="margin:8px 0;"><strong>🔒 Period 1 results locked</strong></div>`
          : `
            <div style="margin:8px 0;">
              <div style="display:grid; grid-template-columns: 110px 1fr 1fr; gap:10px; align-items:center;">
                <div></div>
                <div style="font-weight:700;">Y</div>
                <div style="font-weight:700;">N</div>

                <div style="font-weight:700;">Goals?</div>
                <label style="display:flex; gap:8px; align-items:center;">
                  <input type="checkbox" id="r_goal_y" ${r.goal === "Yes" ? "checked" : ""} />
                  <span>Yes</span>
                </label>
                <label style="display:flex; gap:8px; align-items:center;">
                  <input type="checkbox" id="r_goal_n" ${r.goal === "No" ? "checked" : ""} />
                  <span>No</span>
                </label>

                <div style="font-weight:700;">Penalty?</div>
                <label style="display:flex; gap:8px; align-items:center;">
                  <input type="checkbox" id="r_pen_y" ${r.penalty === "Yes" ? "checked" : ""} />
                  <span>Yes</span>
                </label>
                <label style="display:flex; gap:8px; align-items:center;">
                  <input type="checkbox" id="r_pen_n" ${r.penalty === "No" ? "checked" : ""} />
                  <span>No</span>
                </label>
              </div>
            </div>

            <div style="margin-top:12px; font-weight:700;">Period 1 SOG</div>
            <div style="display:flex; gap:10px; flex-wrap:wrap; margin:8px 0;">
              <div style="flex:1; min-width:220px;">
                <div style="font-weight:700; margin-bottom:4px;">${state.away}</div>
                <input id="r_sog_away" type="number" min="0" inputmode="numeric"
                       value="${r.endSogAway ?? ""}"
                       placeholder="End of period total SOG"
                       style="width:100%; padding:10px; border:1px solid #ccc;" />
              </div>
              <div style="flex:1; min-width:220px;">
                <div style="font-weight:700; margin-bottom:4px;">${state.home}</div>
                <input id="r_sog_home" type="number" min="0" inputmode="numeric"
                       value="${r.endSogHome ?? ""}"
                       placeholder="End of period total SOG"
                       style="width:100%; padding:10px; border:1px solid #ccc;" />
              </div>
            </div>

            <button id="lockP1Results">Lock Period 1 Results</button>

            <div style="margin-top:8px; font-size:0.9rem; opacity:0.75;">
              Start-of-game SOG assumed: Away 0, Home 0. (Later periods: start = last period end)
            </div>
          `
      }

      ${p1.computed ? renderP1ComputedSummary() : ""}
    </div>
  ` : `<div style="margin-top:12px; font-size:0.95rem; opacity:0.75;">Lock all picks to enter results.</div>`;

  const continueHTML = (p1.computed && p1.lockedResults)
    ? `<button id="toP2Stub">Continue to Period 2</button>`
    : "";

  // BACK here means: undo last change on this screen, else go back to Q2 if pregame not committed
  return `
    <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:720px;">
      <h3 style="margin-top:0;">Period 1 (3 pts possible)</h3>

      ${qCard("Q1: Will there be a goal this period?", picks.q1_goal, "p1q1")}
      ${qCard("Q2: Will there be a penalty this period?", picks.q2_penalty, "p1q2")}
      ${qCard("Q3: Will each team record at least 5 shots on goal this period?", picks.q3_both5sog, "p1q3")}

      ${resultsPanel}

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
      ? `${state.house} wins Period 1 ✅ (House terminates 1 DOG if available)`
      : `Period 1 is a tie (no DOG changes)`;

  return `
    <div style="margin-top:10px; padding:10px; border:1px solid #eee;">
      <div style="font-weight:700; margin-bottom:6px;">Scoring Summary</div>
      <div style="margin:6px 0;"><strong>${state.player1} correct:</strong> ${c.playerCorrect} / 3</div>
      <div style="margin:6px 0;"><strong>${state.house} correct:</strong> ${c.houseCorrect} / 3</div>
      <div style="margin:6px 0;"><strong>Period Winner:</strong> ${winnerText}</div>
      <div style="margin:6px 0; font-size:0.9rem; opacity:0.75;">
        Period SOG: Away ${c.periodSog.away}, Home ${c.periodSog.home} (start ${c.startSog.away}/${c.startSog.home} → end ${c.endSog.away}/${c.endSogHome ?? c.endSog.home})
      </div>
    </div>
  `;
}

/* -------------------------
   Wiring / Handlers
-------------------------- */
function wireHandlers() {
  // Global: disable LIVE
  const disableLive = document.getElementById("disableLive");
  if (disableLive) {
    disableLive.onclick = () => {
      state.live = false;
      render();
    };
  }

  if (state.screen === "pre_q1") wirePreQ1Buttons();
  if (state.screen === "pre_q2") wirePreQ2Buttons();
  if (state.screen === "p1") wireP1Buttons();

  // Nav: Q1 -> Q2
  const toQ2 = document.getElementById("toQ2");
  if (toQ2) toQ2.onclick = () => { state.screen = "pre_q2"; render(); };

  // Back from Q2: undo first, else go to Q1 (only if pregame not committed)
  const backToQ1 = document.getElementById("backToQ1");
  if (backToQ1) {
    backToQ1.onclick = () => {
      const undone = tryUndo("pre_q2", (snap) => { state.pre.q2 = snap; });
      if (!undone) {
        state.screen = "pre_q1";
        render();
      }
    };
  }

  // Start Period 1: commits pregame (disables pregame undo)
  const toP1 = document.getElementById("toP1");
  if (toP1) {
    toP1.onclick = () => {
      commitPregame();
      state.screen = "p1";
      render();
    };
  }

  // Back from P1: undo first, else go back to Q2 ONLY if pregame not committed
  const backToQ2 = document.getElementById("backToQ2");
  if (backToQ2) {
    backToQ2.onclick = () => {
      const undone = tryUndo("p1", (snap) => { state.periods.p1 = snap; });
      if (!undone) {
        if (!state.committed.pregame) {
          state.screen = "pre_q2";
        }
        render();
      }
    };
  }

  // Continue to Period 2 (stub): commits P1 (disables P1 undo)
  const toP2Stub = document.getElementById("toP2Stub");
  if (toP2Stub) {
    toP2Stub.onclick = () => {
      commitP1();
      state.screen = "p2_stub";
      render();
    };
  }

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
  if (pYes) pYes.onclick = () => { pushUndo("pre_q2", state.pre.q2); q2.player = "Yes"; q2.lockedPlayer = true; render(); };
  if (pNo) pNo.onclick = () => { pushUndo("pre_q2", state.pre.q2); q2.player = "No"; q2.lockedPlayer = true; render(); };

  const hYes = document.getElementById("q2_house_Yes");
  const hNo = document.getElementById("q2_house_No");
  if (hYes) hYes.onclick = () => { pushUndo("pre_q2", state.pre.q2); q2.house = "Yes"; q2.lockedHouse = true; render(); };
  if (hNo) hNo.onclick = () => { pushUndo("pre_q2", state.pre.q2); q2.house = "No"; q2.lockedHouse = true; render(); };
}

function wireP1Buttons() {
  const p1 = state.periods.p1;
  const r = p1.results;

  const wirePickYesNo = (pickState, prefix) => {
    const pYes = document.getElementById(`${prefix}_player_Yes`);
    const pNo = document.getElementById(`${prefix}_player_No`);
    if (pYes) pYes.onclick = () => { pushUndo("p1", state.periods.p1); pickState.player = "Yes"; pickState.lockedPlayer = true; render(); };
    if (pNo) pNo.onclick = () => { pushUndo("p1", state.periods.p1); pickState.player = "No"; pickState.lockedPlayer = true; render(); };

    const hYes = document.getElementById(`${prefix}_house_Yes`);
    const hNo = document.getElementById(`${prefix}_house_No`);
    if (hYes) hYes.onclick = () => { pushUndo("p1", state.periods.p1); pickState.house = "Yes"; pickState.lockedHouse = true; render(); };
    if (hNo) hNo.onclick = () => { pushUndo("p1", state.periods.p1); pickState.house = "No"; pickState.lockedHouse = true; render(); };
  };

  wirePickYesNo(p1.picks.q1_goal, "p1q1");
  wirePickYesNo(p1.picks.q2_penalty, "p1q2");
  wirePickYesNo(p1.picks.q3_both5sog, "p1q3");

  // Results checkboxes (mutually exclusive per row) + persist without rerender
  const goalY = document.getElementById("r_goal_y");
  const goalN = document.getElementById("r_goal_n");
  const penY = document.getElementById("r_pen_y");
  const penN = document.getElementById("r_pen_n");

  if (goalY && goalN) {
    goalY.onchange = () => {
      pushUndo("p1", state.periods.p1);
      if (goalY.checked) { goalN.checked = false; r.goal = "Yes"; }
      else if (!goalN.checked) { r.goal = null; }
      saveState();
    };
    goalN.onchange = () => {
      pushUndo("p1", state.periods.p1);
      if (goalN.checked) { goalY.checked = false; r.goal = "No"; }
      else if (!goalY.checked) { r.goal = null; }
      saveState();
    };
  }

  if (penY && penN) {
    penY.onchange = () => {
      pushUndo("p1", state.periods.p1);
      if (penY.checked) { penN.checked = false; r.penalty = "Yes"; }
      else if (!penN.checked) { r.penalty = null; }
      saveState();
    };
    penN.onchange = () => {
      pushUndo("p1", state.periods.p1);
      if (penN.checked) { penY.checked = false; r.penalty = "No"; }
      else if (!penY.checked) { r.penalty = null; }
      saveState();
    };
  }

  // Persist SOG while typing (without rerender)
  const sogAway = document.getElementById("r_sog_away");
  const sogHome = document.getElementById("r_sog_home");

  if (sogAway) {
    sogAway.oninput = () => {
      pushUndo("p1", state.periods.p1);
      const v = parseInt(sogAway.value, 10);
      r.endSogAway = Number.isNaN(v) ? null : v;
      saveState();
    };
  }
  if (sogHome) {
    sogHome.oninput = () => {
      pushUndo("p1", state.periods.p1);
      const v = parseInt(sogHome.value, 10);
      r.endSogHome = Number.isNaN(v) ? null : v;
      saveState();
    };
  }

  // Lock results button
  const lockBtn = document.getElementById("lockP1Results");
  if (lockBtn) {
    lockBtn.onclick = () => {
      pushUndo("p1", state.periods.p1);

      const endAway = r.endSogAway;
      const endHome = r.endSogHome;

      if (!r.goal || !r.penalty || endAway === null || endHome === null) {
        alert("House must select Y/N for Goals and Penalty, and enter end SOG totals for both teams.");
        return;
      }
      if (endAway < 0 || endHome < 0) {
        alert("SOG totals must be 0 or higher.");
        return;
      }

      const startAway = state.sog.start.away ?? 0;
      const startHome = state.sog.start.home ?? 0;

      const periodAway = endAway - startAway;
      const periodHome = endHome - startHome;

      if (periodAway < 0 || periodHome < 0) {
        alert("End SOG cannot be less than start SOG. Check the totals.");
        return;
      }

      const q3Truth = (periodAway >= 5 && periodHome >= 5) ? "Yes" : "No";

      const playerCorrect =
        (p1.picks.q1_goal.player === r.goal ? 1 : 0) +
        (p1.picks.q2_penalty.player === r.penalty ? 1 : 0) +
        (p1.picks.q3_both5sog.player === q3Truth ? 1 : 0);

      const houseCorrect =
        (p1.picks.q1_goal.house === r.goal ? 1 : 0) +
        (p1.picks.q2_penalty.house === r.penalty ? 1 : 0) +
        (p1.picks.q3_both5sog.house === q3Truth ? 1 : 0);

      let periodWinner = "none";
      if (playerCorrect >= 2 && houseCorrect < 2) periodWinner = "player";
      else if (houseCorrect >= 2 && playerCorrect < 2) periodWinner = "house";

      // DOG effects
      if (periodWinner === "player") state.dogs = (state.dogs ?? 0) + 1;
      else if (periodWinner === "house") state.dogs = Math.max(0, (state.dogs ?? 0) - 1);

      p1.lockedResults = true;
      p1.computed = {
        startSog: { away: startAway, home: startHome },
        endSog: { away: endAway, home: endHome },
        periodSog: { away: periodAway, home: periodHome },
        q3Truth,
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