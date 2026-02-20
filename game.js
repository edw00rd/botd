// BOTD — game.js (drop-in)
// Includes:
// - Away @ Home convention
// - "House" terminology (+ back-compat from scorekeeper)
// - Sealed picks (hidden after lock; only 🔒 Locked shows)
// - Pre-Game Q1 + Q2
// - Period 1: 3 sealed questions + House results panel
// - Period 2: same + DOG spending ("scratch" one House question; Option #1)
// - Results UI: Y/N checkbox-style selectors (mutually exclusive) + SOG totals
// - SOG logic: start at 0/0 then carry forward by period; House enters end totals
// - LIVE scaffolding + House override to disable LIVE anytime (API later)
// - Back button behavior:
//   * BACK first undoes last action on that screen (if available)
//   * Once "Start Period 1" is pressed, pregame undo is disabled (locked-in)
//   * Once "Continue to Period 2" is pressed, Period 1 undo is disabled (locked-in)
//   * Once "Continue to Period 3" is pressed, Period 2 undo is disabled (locked-in)

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
  state.screen = state.screen ?? "pre_q1"; // pre_q1 -> pre_q2 -> p1 -> p2 -> p3_stub

  // Commit flags (lock-in points)
  state.committed = state.committed ?? {
    pregame: false, // true when Period 1 starts
    p1: false,      // true when Period 2 starts
    p2: false       // true when Period 3 starts (stub)
  };

  // Undo stacks
  state.undo = state.undo ?? {
    pre_q2: [],
    p1: [],
    p2: []
  };
  state.undoSig = state.undoSig ?? {
    pre_q2: null,
    p1: null,
    p2: null
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
  state.periods.p1 = state.periods.p1 ?? mkPeriodState(1);
  state.periods.p2 = state.periods.p2 ?? mkPeriodState(2);

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

function mkPeriodState(n) {
  return {
    n,
    dogSpend: {
      used: false,
      scratched: null // "q1_goal" | "q2_penalty" | "q3_both5sog"
    },
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

// ----- Snapshot helpers (important: periods can affect dogs + sog) -----
function snapPreQ2() {
  return clone(state.pre.q2);
}

function snapP1() {
  return clone({
    p1: state.periods.p1,
    dogs: state.dogs,
    sog: state.sog
  });
}

function snapP2() {
  return clone({
    p2: state.periods.p2,
    dogs: state.dogs,
    sog: state.sog
  });
}

// Push undo snapshot only if not committed and snapshot differs from last pushed
function pushUndo(key, snapshotObj) {
  if (key === "pre_q2" && state.committed.pregame) return;
  if (key === "p1" && state.committed.p1) return;
  if (key === "p2" && state.committed.p2) return;

  const sig = JSON.stringify(snapshotObj);
  if (state.undoSig[key] === sig) return; // avoid spam duplicates
  state.undoSig[key] = sig;

  state.undo[key].push(snapshotObj);
  if (state.undo[key].length > 35) state.undo[key].shift();
  saveState();
}

function tryUndo(key, applyFn) {
  const stack = state.undo?.[key];
  if (!stack || stack.length === 0) return false;

  const snap = stack.pop();
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

function commitP2() {
  state.committed.p2 = true;
  state.undo.p2 = [];
  state.undoSig.p2 = null;
  saveState();
}

function render() {
  const away = state.away;
  const home = state.home;

  const headerHTML = `
    <div style="border:1px solid #ccc; padding:12px; max-width:820px;">
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
  else if (state.screen === "p1") screenHTML = renderPeriod("p1");
  else if (state.screen === "p2") screenHTML = renderPeriod("p2");
  else if (state.screen === "p3_stub") {
    screenHTML = `
      <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:820px;">
        <h3 style="margin-top:0;">Period 3 (Next)</h3>
        <p>Period 2 is complete. Next up: Period 3 + “Good Boy!” + OT/SO (later).</p>
        <button id="backToP2">Back</button>
      </div>
    `;
  } else {
    screenHTML = `
      <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:820px;">
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
    <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:820px;">
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

function sealedYesNoSection({ idPrefix, lockedSelf, lockedOther, requireOtherLock, disabledAll = false }) {
  const lockedUI = `<div style="margin:8px 0;"><strong>🔒 Locked</strong></div>`;
  if (lockedSelf) return lockedUI;

  const disabled = disabledAll || (requireOtherLock && !lockedOther) ? "disabled" : "";
  const helper = (!disabledAll && requireOtherLock && !lockedOther)
    ? `<div style="font-size:0.95rem; opacity:0.8;">Player locks first.</div>`
    : "";

  const scratchedMsg = disabledAll
    ? `<div style="font-size:0.95rem; opacity:0.8;">Scratched 🐶 (House can’t answer)</div>`
    : "";

  return `
    <div style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;">
      <button id="${idPrefix}_Yes" ${disabled}>Yes</button>
      <button id="${idPrefix}_No" ${disabled}>No</button>
    </div>
    ${helper}
    ${scratchedMsg}
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
   Shared Period renderer (P1 / P2)
-------------------------- */
function renderPeriod(key) {
  const p = state.periods[key];
  const picks = p.picks;
  const r = p.results;

  const anyPlayerLocked =
    picks.q1_goal.lockedPlayer ||
    picks.q2_penalty.lockedPlayer ||
    picks.q3_both5sog.lockedPlayer;

  const canSpendDog =
    key === "p2" &&
    state.dogs > 0 &&
    !p.dogSpend.used &&
    !anyPlayerLocked &&
    !p.lockedResults;

  const scratchPanel = canSpendDog ? `
    <div style="margin-top:12px; border:1px solid #ddd; padding:10px; max-width:820px;">
      <div style="font-weight:800; margin-bottom:6px;">Spend a DOG? 🐶 (Period 2 only)</div>
      <div style="opacity:0.85; margin-bottom:10px;">
        Spend <strong>1 DOG</strong> to scratch <strong>one House question</strong> this period (House can’t answer or score it).
        Must choose before ${state.player1} locks any Period 2 picks.
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <button id="scratch_q1">Scratch Q1 (Goal?)</button>
        <button id="scratch_q2">Scratch Q2 (Penalty?)</button>
        <button id="scratch_q3">Scratch Q3 (Both 5+ SOG?)</button>
      </div>
      <div style="margin-top:8px; font-size:0.9rem; opacity:0.75;">
        DOGs remaining: ${state.dogs}
      </div>
    </div>
  ` : "";

  const qCard = (label, pickState, idPrefix, scratchedForHouse = false) => {
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
      requireOtherLock: true,
      disabledAll: scratchedForHouse
    });

    const ready = pickState.lockedPlayer && (scratchedForHouse || pickState.lockedHouse);

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
        ${ready ? `<div style="margin-top:6px; font-size:0.9rem; opacity:0.75;">Ready ✅</div>` : ""}
      </div>
    `;
  };

  const scratched = (key === "p2") ? p.dogSpend.scratched : null;
  const isScratched = (qid) => scratched === qid;

  const allLocked =
    picks.q1_goal.lockedPlayer && (isScratched("q1_goal") || picks.q1_goal.lockedHouse) &&
    picks.q2_penalty.lockedPlayer && (isScratched("q2_penalty") || picks.q2_penalty.lockedHouse) &&
    picks.q3_both5sog.lockedPlayer && (isScratched("q3_both5sog") || picks.q3_both5sog.lockedHouse);

  const resultsNote = state.live
    ? `<div style="font-size:0.9rem; opacity:0.75; margin-bottom:8px;">LIVE is ON (API later). House can still enter results now.</div>`
    : `<div style="font-size:0.9rem; opacity:0.75; margin-bottom:8px;">House enters end-of-period totals.</div>`;

  const resultsPanel = allLocked ? `
    <div style="margin-top:12px; border:1px solid #ddd; padding:10px; max-width:820px;">
      <div style="font-weight:700; margin-bottom:6px;">Period ${p.n} Results (House)</div>
      ${resultsNote}

      ${
        p.lockedResults
          ? `<div style="margin:8px 0;"><strong>🔒 Period ${p.n} results locked</strong></div>`
          : `
            <div style="margin:8px 0;">
              <div style="display:grid; grid-template-columns: 110px 1fr 1fr; gap:10px; align-items:center;">
                <div></div>
                <div style="font-weight:700;">Y</div>
                <div style="font-weight:700;">N</div>

                <div style="font-weight:700;">Goals?</div>
                <label style="display:flex; gap:8px; align-items:center;">
                  <input type="checkbox" id="${key}_r_goal_y" ${r.goal === "Yes" ? "checked" : ""} />
                  <span>Yes</span>
                </label>
                <label style="display:flex; gap:8px; align-items:center;">
                  <input type="checkbox" id="${key}_r_goal_n" ${r.goal === "No" ? "checked" : ""} />
                  <span>No</span>
                </label>

                <div style="font-weight:700;">Penalty?</div>
                <label style="display:flex; gap:8px; align-items:center;">
                  <input type="checkbox" id="${key}_r_pen_y" ${r.penalty === "Yes" ? "checked" : ""} />
                  <span>Yes</span>
                </label>
                <label style="display:flex; gap:8px; align-items:center;">
                  <input type="checkbox" id="${key}_r_pen_n" ${r.penalty === "No" ? "checked" : ""} />
                  <span>No</span>
                </label>
              </div>
            </div>

            <div style="margin-top:12px; font-weight:700;">Period ${p.n} SOG</div>
            <div style="display:flex; gap:10px; flex-wrap:wrap; margin:8px 0;">
              <div style="flex:1; min-width:220px;">
                <div style="font-weight:700; margin-bottom:4px;">${state.away}</div>
                <input id="${key}_r_sog_away" type="number" min="0" inputmode="numeric"
                       value="${r.endSogAway ?? ""}"
                       placeholder="End of period total SOG"
                       style="width:100%; padding:10px; border:1px solid #ccc;" />
              </div>
              <div style="flex:1; min-width:220px;">
                <div style="font-weight:700; margin-bottom:4px;">${state.home}</div>
                <input id="${key}_r_sog_home" type="number" min="0" inputmode="numeric"
                       value="${r.endSogHome ?? ""}"
                       placeholder="End of period total SOG"
                       style="width:100%; padding:10px; border:1px solid #ccc;" />
              </div>
            </div>

            <button id="${key}_lockResults">Lock Period ${p.n} Results</button>

            <div style="margin-top:8px; font-size:0.9rem; opacity:0.75;">
              Start SOG this period: Away ${state.sog.start.away ?? 0}, Home ${state.sog.start.home ?? 0}.
            </div>
          `
      }

      ${p.computed ? renderPeriodComputedSummary(key) : ""}
    </div>
  ` : `<div style="margin-top:12px; font-size:0.95rem; opacity:0.75;">Lock all picks to enter results.</div>`;

  const backBtnId = key === "p1" ? "backToQ2" : "backToP1";
  const backLabel = "Back";

  const continueHTML =
    (p.computed && p.lockedResults)
      ? (key === "p1"
          ? `<button id="toP2">Continue to Period 2</button>`
          : `<button id="toP3Stub">Continue to Period 3</button>`)
      : "";

  return `
    <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:820px;">
      <h3 style="margin-top:0;">Period ${p.n} (3 pts possible)</h3>

      ${scratchPanel}

      ${qCard("Q1: Will there be a goal this period?", picks.q1_goal, `${key}q1`, isScratched("q1_goal"))}
      ${qCard("Q2: Will there be a penalty this period?", picks.q2_penalty, `${key}q2`, isScratched("q2_penalty"))}
      ${qCard("Q3: Will each team record at least 5 shots on goal this period?", picks.q3_both5sog, `${key}q3`, isScratched("q3_both5sog"))}

      ${resultsPanel}

      <div style="display:flex; gap:10px; margin-top:12px;">
        <button id="${backBtnId}">${backLabel}</button>
        ${continueHTML}
      </div>
    </div>
  `;
}

function renderPeriodComputedSummary(key) {
  const p = state.periods[key];
  const c = p.computed;
  if (!c) return "";

  const winnerText = c.periodWinner === "player"
    ? `${state.player1} wins Period ${p.n} ✅ (DOG +1)`
    : c.periodWinner === "house"
      ? `${state.house} wins Period ${p.n} ✅ (House terminates 1 DOG if available)`
      : `Period ${p.n} is a tie (no DOG changes)`;

  const scratchedLine = (key === "p2" && p.dogSpend.used && p.dogSpend.scratched)
    ? `<div style="margin:6px 0; font-size:0.9rem; opacity:0.8;"><strong>Scratched:</strong> ${prettyQ(p.dogSpend.scratched)} (House couldn’t answer)</div>`
    : "";

  return `
    <div style="margin-top:10px; padding:10px; border:1px solid #eee;">
      <div style="font-weight:700; margin-bottom:6px;">Scoring Summary</div>
      ${scratchedLine}
      <div style="margin:6px 0;"><strong>${state.player1} correct:</strong> ${c.playerCorrect} / 3</div>
      <div style="margin:6px 0;"><strong>${state.house} correct:</strong> ${c.houseCorrect} / 3</div>
      <div style="margin:6px 0;"><strong>Period Winner:</strong> ${winnerText}</div>
      <div style="margin:6px 0; font-size:0.9rem; opacity:0.75;">
        Period SOG: Away ${c.periodSog.away}, Home ${c.periodSog.home}
        (start ${c.startSog.away}/${c.startSog.home} → end ${c.endSog.away}/${c.endSog.home})
      </div>
    </div>
  `;
}

function prettyQ(qid) {
  if (qid === "q1_goal") return "Q1 (Goal?)";
  if (qid === "q2_penalty") return "Q2 (Penalty?)";
  if (qid === "q3_both5sog") return "Q3 (Both 5+ SOG?)";
  return qid;
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

  // Screen-specific wiring
  if (state.screen === "pre_q1") wirePreQ1Buttons();
  if (state.screen === "pre_q2") wirePreQ2Buttons();
  if (state.screen === "p1") wirePeriodButtons("p1");
  if (state.screen === "p2") wirePeriodButtons("p2");

  // Nav: Q1 -> Q2
  const toQ2 = document.getElementById("toQ2");
  if (toQ2) toQ2.onclick = () => { state.screen = "pre_q2"; render(); };

  // Back from Q2: undo first, else go to Q1
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
      const undone = tryUndo("p1", (snap) => {
        state.periods.p1 = snap.p1;
        state.dogs = snap.dogs;
        state.sog = snap.sog;
      });
      if (!undone) {
        if (!state.committed.pregame) state.screen = "pre_q2";
        render();
      }
    };
  }

  // Continue to Period 2: commits P1
  const toP2 = document.getElementById("toP2");
  if (toP2) {
    toP2.onclick = () => {
      commitP1();
      state.screen = "p2";
      render();
    };
  }

  // Back from P2: undo first, else stay (P1 is committed)
  const backToP1 = document.getElementById("backToP1");
  if (backToP1) {
    backToP1.onclick = () => {
      const undone = tryUndo("p2", (snap) => {
        state.periods.p2 = snap.p2;
        state.dogs = snap.dogs;
        state.sog = snap.sog;
      });
      if (!undone) {
        // P1 committed, so we don't navigate back; just re-render.
        render();
      }
    };
  }

  // Continue to Period 3 (stub): commits P2
  const toP3Stub = document.getElementById("toP3Stub");
  if (toP3Stub) {
    toP3Stub.onclick = () => {
      commitP2();
      state.screen = "p3_stub";
      render();
    };
  }

  const backToP2 = document.getElementById("backToP2");
  if (backToP2) backToP2.onclick = () => { state.screen = "p2"; render(); };
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
  if (pYes) pYes.onclick = () => { pushUndo("pre_q2", snapPreQ2()); q2.player = "Yes"; q2.lockedPlayer = true; render(); };
  if (pNo) pNo.onclick = () => { pushUndo("pre_q2", snapPreQ2()); q2.player = "No"; q2.lockedPlayer = true; render(); };

  const hYes = document.getElementById("q2_house_Yes");
  const hNo = document.getElementById("q2_house_No");
  if (hYes) hYes.onclick = () => { pushUndo("pre_q2", snapPreQ2()); q2.house = "Yes"; q2.lockedHouse = true; render(); };
  if (hNo) hNo.onclick = () => { pushUndo("pre_q2", snapPreQ2()); q2.house = "No"; q2.lockedHouse = true; render(); };
}

/* -------------------------
   Period wiring (P1 / P2)
-------------------------- */
function wirePeriodButtons(key) {
  const p = state.periods[key];
  const picks = p.picks;
  const r = p.results;

  const snapKey = key === "p1" ? "p1" : "p2";
  const snapFn = key === "p1" ? snapP1 : snapP2;

  // Period 2 DOG spending (scratch one House question)
  if (key === "p2") {
    const anyPlayerLocked =
      picks.q1_goal.lockedPlayer || picks.q2_penalty.lockedPlayer || picks.q3_both5sog.lockedPlayer;

    const canSpendDog =
      state.dogs > 0 && !p.dogSpend.used && !anyPlayerLocked && !p.lockedResults;

    if (canSpendDog) {
      const b1 = document.getElementById("scratch_q1");
      const b2 = document.getElementById("scratch_q2");
      const b3 = document.getElementById("scratch_q3");

      const doScratch = (qid) => {
        pushUndo(snapKey, snapFn());
        // spend DOG
        state.dogs = Math.max(0, (state.dogs ?? 0) - 1);
        p.dogSpend.used = true;
        p.dogSpend.scratched = qid;

        // scratch = House can’t answer / can’t score
        const target = p.picks[qid];
        target.lockedHouse = true;
        target.house = null;

        render();
      };

      if (b1) b1.onclick = () => doScratch("q1_goal");
      if (b2) b2.onclick = () => doScratch("q2_penalty");
      if (b3) b3.onclick = () => doScratch("q3_both5sog");
    }
  }

  const isScratched = (qid) => (key === "p2" && p.dogSpend.used && p.dogSpend.scratched === qid);

  // Wire yes/no for sealed picks
  const wirePickYesNo = (pickState, prefix, qid, forHouse) => {
    const pYes = document.getElementById(`${prefix}_player_Yes`);
    const pNo = document.getElementById(`${prefix}_player_No`);
    if (pYes) pYes.onclick = () => { pushUndo(snapKey, snapFn()); pickState.player = "Yes"; pickState.lockedPlayer = true; render(); };
    if (pNo) pNo.onclick = () => { pushUndo(snapKey, snapFn()); pickState.player = "No"; pickState.lockedPlayer = true; render(); };

    // House buttons should be ignored/disabled if scratched
    if (forHouse && isScratched(qid)) return;

    const hYes = document.getElementById(`${prefix}_house_Yes`);
    const hNo = document.getElementById(`${prefix}_house_No`);
    if (hYes) hYes.onclick = () => { pushUndo(snapKey, snapFn()); pickState.house = "Yes"; pickState.lockedHouse = true; render(); };
    if (hNo) hNo.onclick = () => { pushUndo(snapKey, snapFn()); pickState.house = "No"; pickState.lockedHouse = true; render(); };
  };

  wirePickYesNo(picks.q1_goal, `${key}q1`, "q1_goal", true);
  wirePickYesNo(picks.q2_penalty, `${key}q2`, "q2_penalty", true);
  wirePickYesNo(picks.q3_both5sog, `${key}q3`, "q3_both5sog", true);

  // Results checkboxes (mutually exclusive per row) + persist without rerender
  const goalY = document.getElementById(`${key}_r_goal_y`);
  const goalN = document.getElementById(`${key}_r_goal_n`);
  const penY = document.getElementById(`${key}_r_pen_y`);
  const penN = document.getElementById(`${key}_r_pen_n`);

  if (goalY && goalN) {
    goalY.onchange = () => {
      pushUndo(snapKey, snapFn());
      if (goalY.checked) { goalN.checked = false; r.goal = "Yes"; }
      else if (!goalN.checked) { r.goal = null; }
      saveState();
    };
    goalN.onchange = () => {
      pushUndo(snapKey, snapFn());
      if (goalN.checked) { goalY.checked = false; r.goal = "No"; }
      else if (!goalY.checked) { r.goal = null; }
      saveState();
    };
  }

  if (penY && penN) {
    penY.onchange = () => {
      pushUndo(snapKey, snapFn());
      if (penY.checked) { penN.checked = false; r.penalty = "Yes"; }
      else if (!penN.checked) { r.penalty = null; }
      saveState();
    };
    penN.onchange = () => {
      pushUndo(snapKey, snapFn());
      if (penN.checked) { penY.checked = false; r.penalty = "No"; }
      else if (!penY.checked) { r.penalty = null; }
      saveState();
    };
  }

  // Persist SOG while typing (without rerender)
  const sogAway = document.getElementById(`${key}_r_sog_away`);
  const sogHome = document.getElementById(`${key}_r_sog_home`);

  if (sogAway) {
    sogAway.oninput = () => {
      pushUndo(snapKey, snapFn());
      const v = parseInt(sogAway.value, 10);
      r.endSogAway = Number.isNaN(v) ? null : v;
      saveState();
    };
  }
  if (sogHome) {
    sogHome.oninput = () => {
      pushUndo(snapKey, snapFn());
      const v = parseInt(sogHome.value, 10);
      r.endSogHome = Number.isNaN(v) ? null : v;
      saveState();
    };
  }

  // Lock results button
  const lockBtn = document.getElementById(`${key}_lockResults`);
  if (lockBtn) {
    lockBtn.onclick = () => {
      pushUndo(snapKey, snapFn());

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

      // Correctness
      const playerCorrect =
        (picks.q1_goal.player === r.goal ? 1 : 0) +
        (picks.q2_penalty.player === r.penalty ? 1 : 0) +
        (picks.q3_both5sog.player === q3Truth ? 1 : 0);

      // House correctness: scratched question always counts as incorrect for House (Option #1)
      const houseCorrect =
        ((isScratched("q1_goal") ? false : picks.q1_goal.house === r.goal) ? 1 : 0) +
        ((isScratched("q2_penalty") ? false : picks.q2_penalty.house === r.penalty) ? 1 : 0) +
        ((isScratched("q3_both5sog") ? false : picks.q3_both5sog.house === q3Truth) ? 1 : 0);

      // Winner: best 2 of 3, tie -> none
      let periodWinner = "none";
      if (playerCorrect >= 2 && houseCorrect < 2) periodWinner = "player";
      else if (houseCorrect >= 2 && playerCorrect < 2) periodWinner = "house";

      // DOG effects
      if (periodWinner === "player") state.dogs = (state.dogs ?? 0) + 1;
      else if (periodWinner === "house") state.dogs = Math.max(0, (state.dogs ?? 0) - 1);

      p.lockedResults = true;
      p.computed = {
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