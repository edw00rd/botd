// BOTD — game.js (drop-in)
// Fixes:
// - Allow spending DOGs at start of Period 3 (and saving P1/P2 DOGs into P3)
// - Void leftover DOGs the moment Period 3 starts (first Player pick locked in P3)
// - Good Boy: roll targets P1/P2 Q1-3; if HOUSE was correct -> HOUSE loses 1 point; else no effect
// Notes:
// - Pre-game Q1/Q2 scoring still pending (needs final outcome).
// - OT/SO still stubbed after Good Boy.

const state = JSON.parse(localStorage.getItem("botd_state"));
const gameEl = document.getElementById("game");

if (!state) {
  gameEl.textContent = "No game state found. Go back to setup.";
} else {
  // Back-compat: older saves may have scorekeeper instead of house
  state.house = state.house ?? state.scorekeeper;

  // Core
  state.score = state.score ?? { player: 0, house: 0 };
  state.dogs = Number.isFinite(state.dogs) ? state.dogs : 0;

  // LIVE toggle (API later); House can disable anytime
  state.live = !!state.live;

  // Routing
  state.screen = state.screen ?? "pre_q1"; // pre_q1 -> pre_q2 -> p1 -> p2 -> p3 -> goodboy? -> regulation -> ot_stub (later)

  // Commit flags (lock-in points)
  state.committed = state.committed ?? {
    pregame: false,
    p1: false,
    p2: false,
    p3: false
  };

  // Undo stacks
  state.undo = state.undo ?? { pre_q2: [], p1: [], p2: [], p3: [], goodboy: [] };
  state.undoSig = state.undoSig ?? { pre_q2: null, p1: null, p2: null, p3: null, goodboy: null };

  // Shots-on-goal tracking (totals)
  state.sog = state.sog ?? { start: { away: 0, home: 0 }, end: { away: 0, home: 0 } };

  // Pre-game answers
  state.pre = state.pre ?? {};
  state.pre.q1 = state.pre.q1 ?? mkPickState(); // Away/Home
  state.pre.q2 = state.pre.q2 ?? mkPickState(); // Yes/No

  // Periods
  state.periods = state.periods ?? {};
  state.periods.p1 = state.periods.p1 ?? mkPeriodState(1);
  state.periods.p2 = state.periods.p2 ?? mkPeriodState(2);
  state.periods.p3 = state.periods.p3 ?? mkPeriodState(3);

  // Ensure P3 has the new latch fields even for old saves
  state.periods.p3.dogSpend = state.periods.p3.dogSpend ?? { used: false, scratched: null };
  state.periods.p3.dogSpend.voided = !!state.periods.p3.dogSpend.voided;
  state.periods.p3.dogSpend.scratchedList = state.periods.p3.dogSpend.scratchedList ?? [];

  // Ensure P2 has list too (optional, but keeps code uniform)
  state.periods.p2.dogSpend = state.periods.p2.dogSpend ?? { used: false, scratched: null };
  state.periods.p2.dogSpend.scratchedList = state.periods.p2.dogSpend.scratchedList ?? (state.periods.p2.dogSpend.scratched ? [state.periods.p2.dogSpend.scratched] : []);

  // Good Boy state
  state.goodBoy = state.goodBoy ?? {
    earned: false,
    resolved: false,
    roll: null,              // 1..6
    target: null,            // label
    housePointRemoved: false // true/false
  };

  render();
}

function renderDogs(count) {
  if (!count || count <= 0) return "—";
  return "🐶".repeat(count);
}

function mkPickState() {
  return { player: null, house: null, lockedPlayer: false, lockedHouse: false };
}

function mkPeriodState(n) {
  return {
    n,
    dogSpend: {
      used: false,
      scratched: null,        // legacy single scratch
      scratchedList: [],      // new multi scratch (P3)
      voided: false           // P3 only: leftover dogs void once P3 starts
    },
    picks: {
      q1_goal: mkPickState(),
      q2_penalty: mkPickState(),
      q3_both5sog: mkPickState()
    },
    results: {
      goal: null,
      penalty: null,
      endSogAway: null,
      endSogHome: null
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

// ----- Snapshot helpers -----
function snapPreQ2() {
  return clone(state.pre.q2);
}
function snapPeriod(key) {
  return clone({
    period: state.periods[key],
    score: state.score,
    dogs: state.dogs,
    sog: state.sog,
    goodBoy: state.goodBoy,
    screen: state.screen
  });
}
function snapGoodBoy() {
  return clone({
    score: state.score,
    goodBoy: state.goodBoy,
    screen: state.screen
  });
}

function pushUndo(key, snapshotObj) {
  if (key === "pre_q2" && state.committed.pregame) return;
  if (key === "p1" && state.committed.p1) return;
  if (key === "p2" && state.committed.p2) return;
  if (key === "p3" && state.committed.p3) return;
  if (key === "goodboy" && state.goodBoy.resolved) return;

  const sig = JSON.stringify(snapshotObj);
  if (state.undoSig[key] === sig) return;
  state.undoSig[key] = sig;

  state.undo[key].push(snapshotObj);
  if (state.undo[key].length > 40) state.undo[key].shift();
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

function commitStage(stageKey) {
  state.committed[stageKey] = true;
  if (stageKey === "pregame") { state.undo.pre_q2 = []; state.undoSig.pre_q2 = null; }
  if (stageKey === "p1") { state.undo.p1 = []; state.undoSig.p1 = null; }
  if (stageKey === "p2") { state.undo.p2 = []; state.undoSig.p2 = null; }
  if (stageKey === "p3") { state.undo.p3 = []; state.undoSig.p3 = null; }
  saveState();
}

function render() {
  const away = state.away;
  const home = state.home;

  const headerHTML = `
    <div style="border:1px solid #ccc; padding:12px; max-width:860px;">
      <h2 style="margin-top:0;">${away} @ ${home}</h2>
      <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
        <div>
          <p style="margin:6px 0;"><strong>${state.player1}</strong> vs <strong>${state.house}</strong></p>
          <p style="margin:6px 0;">
            <strong>Score:</strong> ${state.player1} ${state.score.player} — ${state.house} ${state.score.house}
            &nbsp; | &nbsp; <strong>DOGs:</strong> ${renderDogs(state.dogs)}
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
  else if (state.screen === "p3") screenHTML = renderPeriod("p3", { p3Mode: true });
  else if (state.screen === "goodboy") screenHTML = renderGoodBoy();
  else if (state.screen === "regulation") screenHTML = renderRegulation();
  else if (state.screen === "ot_stub") screenHTML = renderOTStub();
  else if (state.screen === "postgame_stub") screenHTML = renderPostgameStub(); // (can delete later)
  else screenHTML = `<div style="margin-top:16px;border:1px solid #ccc;padding:12px;max-width:860px;">Unknown screen: ${state.screen}</div>`;

  gameEl.innerHTML = `${headerHTML}${screenHTML}`;
  wireHandlers();
  saveState();
}

function renderSideBySideQuestion({ title, questionText, leftName, rightName, leftSectionHTML, rightSectionHTML, backHTML = "", continueHTML = "" }) {
  return `
    <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:860px;">
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
    ? `<div style="font-size:0.95rem; opacity:0.8;">🦴 FETCHED — House disabled</div>`
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
   Pre-Game Q1 / Q2
-------------------------- */
function renderPreQ1() {
  const q1 = state.pre.q1;

  const playerSection = q1.lockedPlayer
    ? `<div style="margin:8px 0;"><strong>🔒 Locked</strong></div>`
    : `<div style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;">
         <button id="q1_playerAway">${state.away}</button>
         <button id="q1_playerHome">${state.home}</button>
       </div>`;

  const houseSection = q1.lockedHouse
    ? `<div style="margin:8px 0;"><strong>🔒 Locked</strong></div>`
    : `<div style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;">
         <button id="q1_houseAway" ${!q1.lockedPlayer ? "disabled" : ""}>${state.away}</button>
         <button id="q1_houseHome" ${!q1.lockedPlayer ? "disabled" : ""}>${state.home}</button>
       </div>
       ${!q1.lockedPlayer ? `<div style="font-size:0.95rem; opacity:0.8;">Player locks first.</div>` : ""}`;

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

/* -------------------------
   Periods
-------------------------- */
function renderPeriod(key, opts = {}) {
  const p = state.periods[key];
  const picks = p.picks;
  const r = p.results;

  const isP2 = key === "p2";
  const isP3 = key === "p3";

  // How many scratches allowed
  const maxScratches = isP3 ? 2 : (isP2 ? 1 : 0);

  // Normalize scratched list
  p.dogSpend.scratchedList = p.dogSpend.scratchedList ?? (p.dogSpend.scratched ? [p.dogSpend.scratched] : []);

  const anyPlayerLocked =
    picks.q1_goal.lockedPlayer || picks.q2_penalty.lockedPlayer || picks.q3_both5sog.lockedPlayer;

  // Can spend dogs at the beginning of P2 or P3 only
  const canSpendDog =
    (isP2 || isP3) &&
    state.dogs > 0 &&
    !p.lockedResults &&
    !anyPlayerLocked &&
    !p.dogSpend.voided && // P3 may void
    (p.dogSpend.scratchedList.length < maxScratches);

  const scratchPanel = canSpendDog ? `
    <div style="margin-top:12px; border:1px solid #ddd; padding:10px; max-width:860px;">
      <div style="font-weight:800; margin-bottom:6px;">Spend DOGs 🐶</div>
      <div style="opacity:0.85; margin-bottom:10px;">
        Spend <strong>1 DOG</strong> to scratch <strong>one House question</strong> this period.
        ${isP3 ? `You may scratch up to <strong>2</strong> questions in Period 3.` : `Period 2 allows <strong>1</strong> scratch.`}
        Must choose before ${state.player1} locks any picks.
        ${isP3 ? `<div style="margin-top:6px; font-size:0.9rem; opacity:0.75;">(Once Period 3 starts, leftover DOGs become void.)</div>` : ""}
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <button id="scratch_q1">Scratch Q1 (Goal?)</button>
        <button id="scratch_q2">Scratch Q2 (Penalty?)</button>
        <button id="scratch_q3">Scratch Q3 (Both 5+ SOG?)</button>
      </div>
      <div style="margin-top:8px; font-size:0.9rem; opacity:0.75;">
        DOGs: ${renderDogs(state.dogs)} &nbsp; | &nbsp; Scratches: ${p.dogSpend.scratchedList.length}/${maxScratches}
      </div>
    </div>
  ` : "";

  const isScratched = (qid) => p.dogSpend.scratchedList.includes(qid);

  const qCard = (label, pickState, idPrefix, qid) => {
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
      disabledAll: (isP2 || isP3) && isScratched(qid)
    });

    const ready = pickState.lockedPlayer && (((isP2 || isP3) && isScratched(qid)) || pickState.lockedHouse);

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

  const allLocked =
    picks.q1_goal.lockedPlayer && (((isP2 || isP3) && isScratched("q1_goal")) || picks.q1_goal.lockedHouse) &&
    picks.q2_penalty.lockedPlayer && (((isP2 || isP3) && isScratched("q2_penalty")) || picks.q2_penalty.lockedHouse) &&
    picks.q3_both5sog.lockedPlayer && (((isP2 || isP3) && isScratched("q3_both5sog")) || picks.q3_both5sog.lockedHouse);

  const resultsNote = state.live
    ? `<div style="font-size:0.9rem; opacity:0.75; margin-bottom:8px;">LIVE is ON (API later). House can still enter results now.</div>`
    : `<div style="font-size:0.9rem; opacity:0.75; margin-bottom:8px;">House enters end-of-period totals.</div>`;

  const resultsPanel = allLocked ? `
    <div style="margin-top:12px; border:1px solid #ddd; padding:10px; max-width:860px;">
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

  const backBtnId = key === "p1" ? "backToQ2" : (key === "p2" ? "backToP1" : "backToP2");
  const continueId = key === "p1" ? "toP2" : (key === "p2" ? "toP3" : "toGoodBoy");
  const continueLabel = key === "p1" ? "Continue to Period 2" : (key === "p2" ? "Continue to Period 3" : "Continue");

  const continueHTML =
    (p.computed && p.lockedResults)
      ? `<button id="${continueId}">${continueLabel}</button>`
      : "";

  const p3Banner = opts.p3Mode ? `
    <div style="margin-top:10px; padding:10px; border:1px dashed #bbb; opacity:0.95;">
      <strong>Period 3 note:</strong> Spend DOGs <em>before</em> locking your first pick.
      Once ${state.player1} locks any Period 3 pick, leftover DOGs become <strong>void</strong>.
      If ${state.player1} wins Period 3, they earn <strong>Good Boy!</strong> (FETCH!!).
    </div>
  ` : "";

  return `
    <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:860px;">
      <h3 style="margin-top:0;">Period ${p.n} (3 pts possible)</h3>
      ${scratchPanel}
      ${p3Banner}

      ${qCard("Q1: Will there be a goal this period?", picks.q1_goal, `${key}q1`, "q1_goal")}
      ${qCard("Q2: Will there be a penalty this period?", picks.q2_penalty, `${key}q2`, "q2_penalty")}
      ${qCard("Q3: Will each team record at least 5 shots on goal this period?", picks.q3_both5sog, `${key}q3`, "q3_both5sog")}

      ${resultsPanel}

      <div style="display:flex; gap:10px; margin-top:12px;">
        <button id="${backBtnId}">Back</button>
        ${continueHTML}
      </div>
    </div>
  `;
}

function renderPeriodComputedSummary(key) {
  const p = state.periods[key];
  const c = p.computed;
  if (!c) return "";

  const dot = (isCorrect) => (isCorrect ? "🟢" : "⚪️");
  const rowDots = (side) => {
    const q1 = !!c.correct?.q1?.[side];
    const q2 = !!c.correct?.q2?.[side];
    const q3 = !!c.correct?.q3?.[side];
    return `${dot(q1)}${dot(q2)}${dot(q3)}`;
  };

  const winnerText =
    c.periodWinner === "player"
      ? `${state.player1} wins Period ${p.n} ✅`
      : c.periodWinner === "house"
        ? `${state.house} wins Period ${p.n} ✅`
        : `Period ${p.n} is a tie (no winner)`;

  const scratchedList = p.dogSpend?.scratchedList ?? [];
  const scratchedLine =
    scratchedList.length
      ? `<div style="margin:6px 0; font-size:0.9rem; opacity:0.8;">
           <strong>Scratched:</strong> ${scratchedList.map(prettyQ).join(", ")} (House disabled)
         </div>`
      : "";

  return `
    <div style="margin-top:10px; padding:10px; border:1px solid #eee;">
      <div style="font-weight:700; margin-bottom:10px;">Scoring Summary</div>
      ${scratchedLine}

      <div style="display:flex; align-items:center; gap:12px; margin:6px 0;">
        <div style="min-width:140px; font-weight:700;">${state.player1} correct:</div>
        <div style="min-width:70px;">${c.playerCorrect}/3</div>
        <div style="font-size:1.15rem; letter-spacing:2px;">${rowDots("player")}</div>
      </div>

      <div style="display:flex; align-items:center; gap:12px; margin:6px 0;">
        <div style="min-width:140px; font-weight:700;">${state.house} correct:</div>
        <div style="min-width:70px;">${c.houseCorrect}/3</div>
        <div style="font-size:1.15rem; letter-spacing:2px;">${rowDots("house")}</div>
      </div>

      <hr style="border:none; border-top:1px solid #eee; margin:10px 0;" />

      <div style="margin:6px 0;"><strong>Period Winner:</strong> ${winnerText}</div>
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
   Good Boy (House point removal)
-------------------------- */
function renderGoodBoy() {
  const gb = state.goodBoy;

  const mapping = `
    <div style="margin-top:10px; font-size:0.95rem; opacity:0.85;">
      <div style="font-weight:700; margin-bottom:6px;">🦴 D6 Mapping</div>
      <div>1 = P1 Q1 (Goal?)</div>
      <div>2 = P1 Q2 (Penalty?)</div>
      <div>3 = P1 Q3 (Both 5+ SOG?)</div>
      <div>4 = P2 Q1 (Goal?)</div>
      <div>5 = P2 Q2 (Penalty?)</div>
      <div>6 = P2 Q3 (Both 5+ SOG?)</div>
    </div>
  `;

  const status = gb.resolved
    ? `<div style="margin-top:10px; padding:10px; border:1px solid #eee;">
         <div style="font-weight:800;">FETCH!! Result</div>
         <div style="margin-top:6px;">Roll: <strong>${gb.roll}</strong> → Target: <strong>${gb.target}</strong></div>
         <div style="margin-top:6px;">Effect: ${
           gb.housePointRemoved ? "<strong>House -1 point ✅</strong>" : "<strong>No effect</strong>"
         }</div>
       </div>`
    : "";

  return `
    <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:860px;">
      <h3 style="margin-top:0;">Good Boy! 🐶 — FETCH!!</h3>
      <p>
        You won Period 3, so you earned a <strong>Good Boy</strong>.
        Roll 🎲 to target one of the House’s Period 1–2 questions.
        If the House was correct on that target, they lose <strong>1 point</strong>.
      </p>

      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <button id="gbRoll" ${gb.resolved ? "disabled" : ""}>FETCH!! (Roll 🎲)</button>
        <label style="display:flex; gap:8px; align-items:center;">
          <span>House manual roll:</span>
          <input id="gbManual" type="number" min="1" max="6" inputmode="numeric" style="width:80px;" ${gb.resolved ? "disabled" : ""}/>
          <button id="gbSetManual" ${gb.resolved ? "disabled" : ""}>Set</button>
        </label>
      </div>

      ${mapping}
      ${status}

      <div style="display:flex; gap:10px; margin-top:12px;">
        <button id="backToP3">Back</button>
        <button id="toPostgame">Continue</button>
      </div>
    </div>
  `;
}

function renderPostgameStub() {
  return `
    <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:860px;">
      <h3 style="margin-top:0;">Next: OT / Shootout (later)</h3>
      <p>Core game is complete through Period 3 + Good Boy.</p>
      <button id="backToGoodBoy">Back</button>
    </div>
  `;
}

function ensureRegulationState() {
  state.regulation = state.regulation ?? {
    awayGoals: null,
    homeGoals: null,
    ppGoal: null,   // "Yes" | "No"
    locked: false
  };
  state.pregameAwarded = state.pregameAwarded ?? { q1: false, q2: false };
}

function renderRegulation() {
  ensureRegulationState();
  const reg = state.regulation;

  const lockedView = reg.locked ? `
    <div style="margin:10px 0;"><strong>🔒 Regulation locked</strong></div>
    <div><strong>Regulation score:</strong> ${state.away} ${reg.awayGoals} — ${state.home} ${reg.homeGoals}</div>
    <div><strong>PP goal:</strong> ${reg.ppGoal}</div>
    <div style="margin-top:12px;">
      ${reg.awayGoals === reg.homeGoals
        ? `<button id="toOT">BOTD → OT</button>`
        : `<button id="awardPregame">Award Pre-Game Points</button>`
      }
    </div>
  ` : `
    <p style="opacity:0.85;">
      Enter the score at the <strong>end of Period 3</strong> (REGULATION).<br/>
      If tied, BOTD goes to OT and we’ll score pre-game questions after the real game ends.
    </p>

    <div style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;">
      <div style="flex:1; min-width:220px;">
        <div style="font-weight:700; margin-bottom:4px;">${state.away} (Away)</div>
        <input id="regAwayGoals" type="number" min="0" inputmode="numeric"
          value="${reg.awayGoals ?? ""}"
          placeholder="Reg goals"
          style="width:100%; padding:10px; border:1px solid #ccc;" />
      </div>
      <div style="flex:1; min-width:220px;">
        <div style="font-weight:700; margin-bottom:4px;">${state.home} (Home)</div>
        <input id="regHomeGoals" type="number" min="0" inputmode="numeric"
          value="${reg.homeGoals ?? ""}"
          placeholder="Reg goals"
          style="width:100%; padding:10px; border:1px solid #ccc;" />
      </div>
    </div>

    <div style="margin-top:12px; font-weight:700;">Was there a power-play goal in the game?</div>
    <div style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;">
      <button id="regPPYes">Yes</button>
      <button id="regPPNo">No</button>
      <div style="opacity:0.8;">Selected: <strong>${reg.ppGoal ?? "—"}</strong></div>
    </div>

    <button id="lockRegulation">Lock Regulation</button>
  `;

  return `
    <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:860px;">
      <h3 style="margin-top:0;">Regulation Result (House)</h3>
      ${lockedView}

      <div style="display:flex; gap:10px; margin-top:12px;">
        <button id="backFromRegulation">Back</button>
      </div>
    </div>
  `;
}

function renderOTStub() {
  return `
    <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:860px;">
      <h3 style="margin-top:0;">BOTD Overtime (Next)</h3>
      <p>Regulation ended tied — BOTD goes to OT.</p>
      <p style="opacity:0.8;">(We’ll build OT/SO next.)</p>
      <button id="backToRegulation">Back</button>
    </div>
  `;
}

function awardPregamePointsFromRegulation() {
  ensureRegulationState();
  const reg = state.regulation;
  if (!reg.locked) return;

  // If tied, do nothing here (OT later)
  if (reg.awayGoals === reg.homeGoals) return;

  const winner = reg.awayGoals > reg.homeGoals ? "Away" : "Home";

  // Pre Q1
  if (!state.pregameAwarded.q1) {
    const q1 = state.pre?.q1;
    if (q1?.player === winner) state.score.player += 1;
    if (q1?.house === winner) state.score.house += 1;
    state.pregameAwarded.q1 = true;
  }

  // Pre Q2 (PP goal yes/no)
  if (!state.pregameAwarded.q2) {
    const q2 = state.pre?.q2;
    const truth = reg.ppGoal; // "Yes" | "No"
    if (q2?.player === truth) state.score.player += 1;
    if (q2?.house === truth) state.score.house += 1;
    state.pregameAwarded.q2 = true;
  }

  saveState();
}

/* -------------------------
   Wiring / Handlers
-------------------------- */
function wireHandlers() {
  const disableLive = document.getElementById("disableLive");
  if (disableLive) disableLive.onclick = () => { state.live = false; render(); };

  if (state.screen === "pre_q1") wirePreQ1Buttons();
  if (state.screen === "pre_q2") wirePreQ2Buttons();
  if (state.screen === "p1") wirePeriodButtons("p1");
  if (state.screen === "p2") wirePeriodButtons("p2");
  if (state.screen === "p3") wirePeriodButtons("p3");
  if (state.screen === "goodboy") wireGoodBoyButtons();
  if (state.screen === "regulation") wireRegulationButtons();
  if (state.screen === "ot_stub") wireOTStubButtons();
  
  // Nav
  const toQ2 = document.getElementById("toQ2");
  if (toQ2) toQ2.onclick = () => { state.screen = "pre_q2"; render(); };

  const backToQ1 = document.getElementById("backToQ1");
  if (backToQ1) backToQ1.onclick = () => {
    const undone = tryUndo("pre_q2", (snap) => { state.pre.q2 = snap; });
    if (!undone) { state.screen = "pre_q1"; render(); }
  };

  const toP1 = document.getElementById("toP1");
  if (toP1) toP1.onclick = () => { commitStage("pregame"); state.screen = "p1"; render(); };

  const toP2 = document.getElementById("toP2");
  if (toP2) toP2.onclick = () => { commitStage("p1"); state.screen = "p2"; render(); };

  const toP3 = document.getElementById("toP3");
  if (toP3) toP3.onclick = () => {
    commitStage("p2");

    // Ensure P3 spending is available BEFORE first pick
    const p3 = state.periods.p3;
    p3.dogSpend = p3.dogSpend ?? { used: false, scratched: null, scratchedList: [], voided: false };
    p3.dogSpend.voided = false;

    state.screen = "p3";
    render();
  };

  const toGoodBoy = document.getElementById("toGoodBoy");
  if (toGoodBoy) toGoodBoy.onclick = () => {
    commitStage("p3");
    state.screen = state.goodBoy.earned ? "goodboy" : "regulation";
    render();
  };

  const toPostgame = document.getElementById("toPostgame");
  if (toPostgame) toPostgame.onclick = () => { state.screen = "regulation"; render(); };

  const backToGoodBoy = document.getElementById("backToGoodBoy");
  if (backToGoodBoy) backToGoodBoy.onclick = () => { state.screen = "goodboy"; render(); };

  const backToP3 = document.getElementById("backToP3");
  if (backToP3) backToP3.onclick = () => { state.screen = "p3"; render(); };

  const backToQ2 = document.getElementById("backToQ2");
  if (backToQ2) backToQ2.onclick = () => {
    const undone = tryUndo("p1", (snap) => {
      state.periods.p1 = snap.period;
      state.score = snap.score;
      state.dogs = snap.dogs;
      state.sog = snap.sog;
      state.goodBoy = snap.goodBoy;
      state.screen = snap.screen;
    });
    if (!undone) render();
  };

  const backToP1 = document.getElementById("backToP1");
  if (backToP1) backToP1.onclick = () => {
    const undone = tryUndo("p2", (snap) => {
      state.periods.p2 = snap.period;
      state.score = snap.score;
      state.dogs = snap.dogs;
      state.sog = snap.sog;
      state.goodBoy = snap.goodBoy;
      state.screen = snap.screen;
    });
    if (!undone) render();
  };

  const backToP2 = document.getElementById("backToP2");
  if (backToP2) backToP2.onclick = () => {
    const undone = tryUndo("p3", (snap) => {
      state.periods.p3 = snap.period;
      state.score = snap.score;
      state.dogs = snap.dogs;
      state.sog = snap.sog;
      state.goodBoy = snap.goodBoy;
      state.screen = snap.screen;
    });
    if (!undone) render();
  };
}

function wireRegulationButtons() {
  ensureRegulationState();
  const reg = state.regulation;

  const back = document.getElementById("backFromRegulation");
  if (back) {
    back.onclick = () => {
      // go back to GoodBoy if it exists, otherwise back to P3
      state.screen = state.goodBoy?.earned ? "goodboy" : "p3";
      render();
    };
  }

  const yes = document.getElementById("regPPYes");
  const no = document.getElementById("regPPNo");
  if (yes) yes.onclick = () => { reg.ppGoal = "Yes"; render(); };
  if (no) no.onclick = () => { reg.ppGoal = "No"; render(); };

  const lock = document.getElementById("lockRegulation");
  if (lock) {
    lock.onclick = () => {
      const a = parseInt(document.getElementById("regAwayGoals")?.value ?? "", 10);
      const h = parseInt(document.getElementById("regHomeGoals")?.value ?? "", 10);

      if (!Number.isFinite(a) || a < 0 || !Number.isFinite(h) || h < 0) {
        alert("Enter valid regulation goals for both teams.");
        return;
      }
      if (reg.ppGoal !== "Yes" && reg.ppGoal !== "No") {
        alert("Select Yes/No for PP goal.");
        return;
      }

      reg.awayGoals = a;
      reg.homeGoals = h;
      reg.locked = true;
      render();
    };
  }

  const toOT = document.getElementById("toOT");
  if (toOT) toOT.onclick = () => { state.screen = "ot_stub"; render(); };

  const award = document.getElementById("awardPregame");
  if (award) {
    award.onclick = () => {
      awardPregamePointsFromRegulation();
      // for now just show postgame stub
      state.screen = "postgame_stub";
      render();
    };
  }
}

function wireOTStubButtons() {
  const back = document.getElementById("backToRegulation");
  if (back) back.onclick = () => { state.screen = "regulation"; render(); };
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
   Period wiring (P1 / P2 / P3)
-------------------------- */
function wirePeriodButtons(key) {
  const p = state.periods[key];
  const picks = p.picks;
  const r = p.results;

  const isP2 = key === "p2";
  const isP3 = key === "p3";
  const undoKey = key;

  // Normalize list
  p.dogSpend.scratchedList = p.dogSpend.scratchedList ?? (p.dogSpend.scratched ? [p.dogSpend.scratched] : []);

  const anyPlayerLocked = () =>
    picks.q1_goal.lockedPlayer || picks.q2_penalty.lockedPlayer || picks.q3_both5sog.lockedPlayer;

  // P3: void leftover dogs after player locks first pick
  const voidDogsIfP3Started = () => {
    if (!isP3) return;
    if (p.dogSpend.voided) return;
    if (anyPlayerLocked()) {
      state.dogs = 0;
      p.dogSpend.voided = true;
    }
  };

  // DOG spending at start of P2 and P3
  const maxScratches = isP3 ? 2 : (isP2 ? 1 : 0);

  const canSpendDog =
    (isP2 || isP3) &&
    state.dogs > 0 &&
    !p.lockedResults &&
    !anyPlayerLocked() &&
    !p.dogSpend.voided &&
    (p.dogSpend.scratchedList.length < maxScratches);

  if (canSpendDog) {
    const b1 = document.getElementById("scratch_q1");
    const b2 = document.getElementById("scratch_q2");
    const b3 = document.getElementById("scratch_q3");

    const doScratch = (qid) => {
      if (p.dogSpend.scratchedList.includes(qid)) return;
      pushUndo(undoKey, snapPeriod(key));

      state.dogs = Math.max(0, (state.dogs ?? 0) - 1);

      p.dogSpend.used = true;
      p.dogSpend.scratchedList.push(qid);

      // House cannot answer this q
      const target = p.picks[qid];
      target.lockedHouse = true;
      target.house = null;

      render();
    };

    if (b1) b1.onclick = () => doScratch("q1_goal");
    if (b2) b2.onclick = () => doScratch("q2_penalty");
    if (b3) b3.onclick = () => doScratch("q3_both5sog");
  }

  const isScratched = (qid) => p.dogSpend.scratchedList.includes(qid);

  // Wire yes/no picks
  const wirePickYesNo = (pickState, prefix, qid) => {
    const pYes = document.getElementById(`${prefix}_player_Yes`);
    const pNo = document.getElementById(`${prefix}_player_No`);

    if (pYes) pYes.onclick = () => {
      pushUndo(undoKey, snapPeriod(key));
      pickState.player = "Yes";
      pickState.lockedPlayer = true;
      voidDogsIfP3Started();
      render();
    };
    if (pNo) pNo.onclick = () => {
      pushUndo(undoKey, snapPeriod(key));
      pickState.player = "No";
      pickState.lockedPlayer = true;
      voidDogsIfP3Started();
      render();
    };

    if ((isP2 || isP3) && isScratched(qid)) return;

    const hYes = document.getElementById(`${prefix}_house_Yes`);
    const hNo = document.getElementById(`${prefix}_house_No`);
    if (hYes) hYes.onclick = () => { pushUndo(undoKey, snapPeriod(key)); pickState.house = "Yes"; pickState.lockedHouse = true; render(); };
    if (hNo) hNo.onclick = () => { pushUndo(undoKey, snapPeriod(key)); pickState.house = "No"; pickState.lockedHouse = true; render(); };
  };

  wirePickYesNo(picks.q1_goal, `${key}q1`, "q1_goal");
  wirePickYesNo(picks.q2_penalty, `${key}q2`, "q2_penalty");
  wirePickYesNo(picks.q3_both5sog, `${key}q3`, "q3_both5sog");

  // Results checkboxes mutual exclusive
  const goalY = document.getElementById(`${key}_r_goal_y`);
  const goalN = document.getElementById(`${key}_r_goal_n`);
  const penY = document.getElementById(`${key}_r_pen_y`);
  const penN = document.getElementById(`${key}_r_pen_n`);

  if (goalY && goalN) {
    goalY.onchange = () => {
      pushUndo(undoKey, snapPeriod(key));
      if (goalY.checked) { goalN.checked = false; r.goal = "Yes"; }
      else if (!goalN.checked) r.goal = null;
      saveState();
    };
    goalN.onchange = () => {
      pushUndo(undoKey, snapPeriod(key));
      if (goalN.checked) { goalY.checked = false; r.goal = "No"; }
      else if (!goalY.checked) r.goal = null;
      saveState();
    };
  }

  if (penY && penN) {
    penY.onchange = () => {
      pushUndo(undoKey, snapPeriod(key));
      if (penY.checked) { penN.checked = false; r.penalty = "Yes"; }
      else if (!penN.checked) r.penalty = null;
      saveState();
    };
    penN.onchange = () => {
      pushUndo(undoKey, snapPeriod(key));
      if (penN.checked) { penY.checked = false; r.penalty = "No"; }
      else if (!penY.checked) r.penalty = null;
      saveState();
    };
  }

  const sogAway = document.getElementById(`${key}_r_sog_away`);
  const sogHome = document.getElementById(`${key}_r_sog_home`);
  if (sogAway) sogAway.oninput = () => { pushUndo(undoKey, snapPeriod(key)); const v = parseInt(sogAway.value, 10); r.endSogAway = Number.isNaN(v) ? null : v; saveState(); };
  if (sogHome) sogHome.oninput = () => { pushUndo(undoKey, snapPeriod(key)); const v = parseInt(sogHome.value, 10); r.endSogHome = Number.isNaN(v) ? null : v; saveState(); };

  // Lock results
  const lockBtn = document.getElementById(`${key}_lockResults`);
  if (lockBtn) {
    lockBtn.onclick = () => {
      pushUndo(undoKey, snapPeriod(key));

      const endAway = r.endSogAway;
      const endHome = r.endSogHome;

      if (!r.goal || !r.penalty || endAway === null || endHome === null) {
        alert("House must select Y/N for Goals and Penalty, and enter end SOG totals for both teams.");
        return;
      }

      const startAway = state.sog.start.away ?? 0;
      const startHome = state.sog.start.home ?? 0;

      const periodAway = endAway - startAway;
      const periodHome = endHome - startHome;

      if (periodAway < 0 || periodHome < 0) {
        alert("End SOG cannot be less than start SOG. Check totals.");
        return;
      }

      const q3Truth = (periodAway >= 5 && periodHome >= 5) ? "Yes" : "No";

      const correct = {
        q1: {
          player: (picks.q1_goal.player === r.goal),
          house: ((isP2 || isP3) && isScratched("q1_goal")) ? false : (picks.q1_goal.house === r.goal)
        },
        q2: {
          player: (picks.q2_penalty.player === r.penalty),
          house: ((isP2 || isP3) && isScratched("q2_penalty")) ? false : (picks.q2_penalty.house === r.penalty)
        },
        q3: {
          truth: q3Truth,
          player: (picks.q3_both5sog.player === q3Truth),
          house: ((isP2 || isP3) && isScratched("q3_both5sog")) ? false : (picks.q3_both5sog.house === q3Truth)
        }
      };

      const playerCorrect = (correct.q1.player ? 1 : 0) + (correct.q2.player ? 1 : 0) + (correct.q3.player ? 1 : 0);
      const houseCorrect = (correct.q1.house ? 1 : 0) + (correct.q2.house ? 1 : 0) + (correct.q3.house ? 1 : 0);

      let periodWinner = "none";
      if (playerCorrect >= 2 && houseCorrect < 2) periodWinner = "player";
      else if (houseCorrect >= 2 && playerCorrect < 2) periodWinner = "house";

      // Award points
      state.score.player += playerCorrect;
      state.score.house += houseCorrect;

      // DOG effects:
      // - P1/P2 only (P3 normal dogs are NOT kept)
      if (!isP3) {
        if (periodWinner === "player") state.dogs = (state.dogs ?? 0) + 1;
        else if (periodWinner === "house") state.dogs = Math.max(0, (state.dogs ?? 0) - 1);
      } else {
        // End of P3: leftover dogs should be 0 no matter what
        state.dogs = 0;

        // Good Boy earned only if player wins P3
        if (periodWinner === "player") {
          state.goodBoy.earned = true;
          state.goodBoy.resolved = false;
          state.goodBoy.roll = null;
          state.goodBoy.target = null;
          state.goodBoy.housePointRemoved = false;
        } else {
          state.goodBoy.earned = false;
          state.goodBoy.resolved = false;
          state.goodBoy.roll = null;
          state.goodBoy.target = null;
          state.goodBoy.housePointRemoved = false;
        }
      }

      p.lockedResults = true;
      p.computed = { q3Truth, correct, playerCorrect, houseCorrect, periodWinner };

      // Carry SOG forward
      state.sog.end.away = endAway;
      state.sog.end.home = endHome;
      state.sog.start.away = endAway;
      state.sog.start.home = endHome;

      render();
    };
  }
}

/* -------------------------
   Good Boy wiring (House -1)
-------------------------- */
function wireGoodBoyButtons() {
  const gb = state.goodBoy;
  if (!gb.earned) return;

  const doResolve = (roll) => {
    pushUndo("goodboy", snapGoodBoy());

    gb.roll = roll;

    const map = {
      1: { period: "p1", q: "q1", label: "P1 Q1 (Goal?)" },
      2: { period: "p1", q: "q2", label: "P1 Q2 (Penalty?)" },
      3: { period: "p1", q: "q3", label: "P1 Q3 (Both 5+ SOG?)" },
      4: { period: "p2", q: "q1", label: "P2 Q1 (Goal?)" },
      5: { period: "p2", q: "q2", label: "P2 Q2 (Penalty?)" },
      6: { period: "p2", q: "q3", label: "P2 Q3 (Both 5+ SOG?)" }
    };

    const target = map[roll];
    gb.target = target.label;

    const periodObj = state.periods[target.period];
    const houseWasCorrect = !!periodObj?.computed?.correct?.[target.q]?.house;

    gb.housePointRemoved = false;
    if (houseWasCorrect) {
      state.score.house = Math.max(0, (state.score.house ?? 0) - 1);
      gb.housePointRemoved = true;
    }

    gb.resolved = true;
    render();
  };

  const rollBtn = document.getElementById("gbRoll");
  if (rollBtn) rollBtn.onclick = () => {
    if (gb.resolved) return;
    const roll = Math.floor(Math.random() * 6) + 1;
    doResolve(roll);
  };

  const manual = document.getElementById("gbManual");
  const setBtn = document.getElementById("gbSetManual");
  if (setBtn) setBtn.onclick = () => {
    if (gb.resolved) return;
    const v = parseInt(manual?.value ?? "", 10);
    if (!v || v < 1 || v > 6) { alert("Enter a number 1–6."); return; }
    doResolve(v);
  };

  const backToP3 = document.getElementById("backToP3");
  if (backToP3) backToP3.onclick = () => { state.screen = "p3"; render(); };

  const toPostgame = document.getElementById("toPostgame");
  if (toPostgame) toPostgame.onclick = () => { state.screen = "postgame_stub"; render(); };
}