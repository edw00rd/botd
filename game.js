// BOTD — game.js (drop-in)
// Fixes:
// - Allow spending DOGs at start of Period 3 (and saving P1/P2 DOGs into P3)
// - Void leftover DOGs the moment Period 3 starts (first Player pick locked in P3)
// - Good Boy: roll targets P1/P2 Q1-3; if HOUSE was correct -> HOUSE loses 1 point; else no effect
// Notes:
// - Pre-game Q1/Q2 scoring occurs after regulation is locked (or after OT/SO if regulation tied).
// - OT/SO are implemented (1 pt each) and final winner selection awards remaining points.

const state = JSON.parse(localStorage.getItem("botd_state"));
const gameEl = document.getElementById("game");

if (!state) {
  gameEl.textContent = "No game state found. Go back to setup.";
} else {
  // Back-compat: older saves may have scorekeeper instead of house
  state.house = state.house ?? state.scorekeeper;

  // Core
  state.score = state.score ?? { player: 0, house: 0 };
  
// Mode: "HOUSE" (default) or "VS" (symmetric)
state.mode = state.mode ?? "HOUSE";

// VS mode uses player2 name (aliasing prior 'house' field)
state.player2 = state.player2 ?? state.house;
  if (state.mode === "VS") state.house = state.player2;

// DOGs:
// - HOUSE mode: single pool for Player 1 (legacy: number)
// - VS mode: two pools { player: n, house: n } (house == Player 2)
if (state.mode === "VS") {
  // Migrate legacy numeric dogs into Player 1 by default
  if (typeof state.dogs === "number") {
    state.dogs = { player: (Number.isFinite(state.dogs) ? state.dogs : 0), house: 0 };
  } else {
    state.dogs = state.dogs ?? {};
    state.dogs.player = Number.isFinite(state.dogs.player) ? state.dogs.player : 0;
    state.dogs.house  = Number.isFinite(state.dogs.house)  ? state.dogs.house  : 0;
  }
} else {
  // HOUSE mode legacy behavior
  state.dogs = Number.isFinite(state.dogs) ? state.dogs : 0;
}

  // LIVE toggle (API later); House can disable anytime
  state.live = !!state.live;

  // Routing
  state.screen = state.screen ?? "pre_q1"; // pre_q1 -> pre_q2 -> p1 -> p2 -> p3 -> goodboy? -> regulation -> ot -> so -> postgame

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
  state.periods.p3.dogSpend = state.periods.p3.dogSpend ?? { used: false, scratched: null, voided: false };
  state.periods.p3.dogSpend.voided = !!state.periods.p3.dogSpend.voided;
  state.periods.p3.dogSpend.scratchedList = state.periods.p3.dogSpend.scratchedList ?? [];

  // Ensure P2 has list too (optional, but keeps code uniform)
  state.periods.p2.dogSpend = state.periods.p2.dogSpend ?? { used: false, scratched: null };
  state.periods.p2.dogSpend.scratchedList =
    state.periods.p2.dogSpend.scratchedList ??
    (state.periods.p2.dogSpend.scratched ? [state.periods.p2.dogSpend.scratched] : []);

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
  const n = Number.isFinite(count) ? count : 0;
  if (!n || n <= 0) return "—";
  return "🐶".repeat(n);
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

/* -------------------------
   Main render router
-------------------------- */
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
            &nbsp; | &nbsp; <strong>DOGs:</strong> ${
  (state.mode === "VS")
    ? `${state.player1}: ${renderDogs(state.dogs.player)} &nbsp; | &nbsp; ${state.player2}: ${renderDogs(state.dogs.house)}`
    : renderDogs(state.dogs)
}
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
  else if (state.screen === "ot") screenHTML = renderOT();
  else if (state.screen === "so") screenHTML = renderSO();
  else if (state.screen === "postgame") screenHTML = renderPostgameSummary();
  else screenHTML = `<div style="margin-top:16px;border:1px solid #ccc;padding:12px;max-width:860px;">Unknown screen: ${state.screen}</div>`;

  gameEl.innerHTML = `${headerHTML}${screenHTML}`;
  wireHandlers();
  saveState();
}

/* -------------------------
   UI helpers
-------------------------- */
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

function countScratches(periodKey) {
  const p = state.periods?.[periodKey];
  const list = p?.dogSpend?.scratchedList ?? [];
  return list.length;
}

function renderDogsDeltaLine(periodKey) {
  const p = state.periods?.[periodKey];
  if (!p?.computed) return "";

  const n = p.n;
  const isVS = state.mode === "VS";

  const scratchesHouseMode = (p?.dogSpend?.scratchedList ?? []).length;

  const scratchesVS = (side) => (p?.dogSpend?.[side]?.scratchedList ?? []).length;

  if (!isVS) {
    const spentTxt = scratchesHouseMode > 0
      ? `Spent: <strong>${"🐶".repeat(scratchesHouseMode)}</strong> (scratches: ${scratchesHouseMode})`
      : `Spent: <strong>—</strong>`;

    if (n === 1 || n === 2) {
      const w = p.computed.periodWinner;
      const delta = (w === "player") ? "+1 🐶" : (w === "house") ? "−1 🐶" : "±0 🐶";
      return `<div style="margin-top:8px; opacity:0.9;"><strong>DOGs:</strong> ${delta} &nbsp; | &nbsp; ${spentTxt}</div>`;
    }

    const voided = !!p.dogSpend?.voided;
    const voidTxt = voided ? "Leftover DOGs: <strong>VOIDED</strong> (first pick locked)" : "Leftover DOGs: <strong>—</strong>";
    const gb = (p.computed.periodWinner === "player") ? "Good Boy: <strong>EARNED ✅</strong>" : "Good Boy: <strong>—</strong>";

    return `
      <div style="margin-top:8px; opacity:0.9;">
        <strong>DOGs:</strong> ${voidTxt} &nbsp; | &nbsp; ${spentTxt} &nbsp; | &nbsp; ${gb}
      </div>
    `;
  }

  // VS mode
  const pSpent = scratchesVS("player");
  const hSpent = scratchesVS("house");
  const spentTxt = `
    <strong>${state.player1}</strong> spent: ${pSpent ? "🐶".repeat(pSpent) : "—"}
    &nbsp; | &nbsp;
    <strong>${state.player2}</strong> spent: ${hSpent ? "🐶".repeat(hSpent) : "—"}
  `;

  if (n === 1 || n === 2) {
    const w = p.computed.periodWinner;
    const pDelta = (w === "player") ? "+1 🐶" : "±0 🐶";
    const hDelta = (w === "house") ? "+1 🐶" : "±0 🐶";
    return `<div style="margin-top:8px; opacity:0.9;"><strong>DOGs:</strong> ${state.player1}: ${pDelta} &nbsp; | &nbsp; ${state.player2}: ${hDelta} &nbsp; | &nbsp; ${spentTxt}</div>`;
  }

  const pVoided = !!p.dogSpend?.player?.voided;
  const hVoided = !!p.dogSpend?.house?.voided;

  const voidTxt = `
    Leftover DOGs: ${state.player1} <strong>${pVoided ? "VOIDED" : "—"}</strong>,
    ${state.player2} <strong>${hVoided ? "VOIDED" : "—"}</strong>
  `;

  const gb = (p.computed.periodWinner === "player")
    ? `${state.player1}: <strong>GOOD BOY ✅</strong>`
    : (p.computed.periodWinner === "house")
      ? `${state.player2}: <strong>GOOD BOY ✅</strong>`
      : `Good Boy: <strong>—</strong>`;

  return `
    <div style="margin-top:8px; opacity:0.9;">
      <strong>DOGs:</strong> ${voidTxt} &nbsp; | &nbsp; ${spentTxt} &nbsp; | &nbsp; ${gb}
    </div>
  `;
}

function renderDogsLinePostgame(periodKey) {
  const p = state.periods?.[periodKey];
  if (!p?.computed) return "";

  const isVS = state.mode === "VS";

  if (!isVS) {
    const scratches = (p?.dogSpend?.scratchedList ?? []).length;
    const spentTxt = scratches > 0 ? `${"🐶".repeat(scratches)} (scratches: ${scratches})` : "—";

    if (p.n === 1 || p.n === 2) {
      const w = p.computed.periodWinner;
      const delta = (w === "player") ? "+1 🐶" : (w === "house") ? "−1 🐶" : "±0 🐶";
      return `
        <div style="margin-top:8px; opacity:0.9;">
          <strong>DOGs:</strong> ${delta} &nbsp; | &nbsp; Spent: <strong>${spentTxt}</strong>
        </div>
      `;
    }

    const voided = !!p.dogSpend?.voided;
    const voidTxt = voided ? "VOIDED (first pick locked)" : "—";
    const gbTxt = (p.computed.periodWinner === "player") ? "EARNED ✅" : "—";
    return `
      <div style="margin-top:8px; opacity:0.9;">
        <strong>DOGs:</strong> Leftover: <strong>${voidTxt}</strong>
        &nbsp; | &nbsp; Spent: <strong>${spentTxt}</strong>
        &nbsp; | &nbsp; Good Boy: <strong>${gbTxt}</strong>
      </div>
    `;
  }

  const pSpent = (p?.dogSpend?.player?.scratchedList ?? []).length;
  const hSpent = (p?.dogSpend?.house?.scratchedList ?? []).length;

  const spentTxt = `
    ${state.player1}: <strong>${pSpent ? "🐶".repeat(pSpent) : "—"}</strong>
    &nbsp; | &nbsp;
    ${state.player2}: <strong>${hSpent ? "🐶".repeat(hSpent) : "—"}</strong>
  `;

  if (p.n === 1 || p.n === 2) {
    const w = p.computed.periodWinner;
    const pDelta = (w === "player") ? "+1 🐶" : "±0 🐶";
    const hDelta = (w === "house") ? "+1 🐶" : "±0 🐶";
    return `
      <div style="margin-top:8px; opacity:0.9;">
        <strong>DOGs:</strong> ${state.player1}: ${pDelta} &nbsp; | &nbsp; ${state.player2}: ${hDelta}
        &nbsp; | &nbsp; Spent: ${spentTxt}
      </div>
    `;
  }

  const pVoided = !!p.dogSpend?.player?.voided;
  const hVoided = !!p.dogSpend?.house?.voided;
  const voidTxt = `${state.player1}: <strong>${pVoided ? "VOIDED" : "—"}</strong> &nbsp; | &nbsp; ${state.player2}: <strong>${hVoided ? "VOIDED" : "—"}</strong>`;

  const gbTxt = (p.computed.periodWinner === "player")
    ? `${state.player1} EARNED ✅`
    : (p.computed.periodWinner === "house")
      ? `${state.player2} EARNED ✅`
      : "—";

  return `
    <div style="margin-top:8px; opacity:0.9;">
      <strong>DOGs:</strong> Leftover: ${voidTxt}
      &nbsp; | &nbsp; Spent: ${spentTxt}
      &nbsp; | &nbsp; Good Boy: <strong>${gbTxt}</strong>
    </div>
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
  const isVS = state.mode === "VS";

  // How many scratches allowed
  const maxScratches = isP3 ? 2 : (isP2 ? 1 : 0);

  // Back-compat normalize scratched list(s)
  p.dogSpend = p.dogSpend ?? {};
  if (!isVS) {
    p.dogSpend.scratchedList = p.dogSpend.scratchedList ?? (p.dogSpend.scratched ? [p.dogSpend.scratched] : []);
  } else {
    // VS: per-side dogSpend
    p.dogSpend.player = p.dogSpend.player ?? { used: false, scratchedList: [], voided: false };
    p.dogSpend.house  = p.dogSpend.house  ?? { used: false, scratchedList: [], voided: false };

    // Migrate any legacy scratches into player side
    if (Array.isArray(p.dogSpend.scratchedList) && p.dogSpend.scratchedList.length && p.dogSpend.player.scratchedList.length === 0) {
      p.dogSpend.player.scratchedList = [...p.dogSpend.scratchedList];
      delete p.dogSpend.scratchedList;
    }
  }

  const anyLockedBySide = (side) =>
    picks.q1_goal[`locked${side === "player" ? "Player" : "House"}`] ||
    picks.q2_penalty[`locked${side === "player" ? "Player" : "House"}`] ||
    picks.q3_both5sog[`locked${side === "player" ? "Player" : "House"}`];

  const scratchedList = (side) => {
    if (!isVS) return p.dogSpend.scratchedList ?? [];
    return (side === "player" ? p.dogSpend.player.scratchedList : p.dogSpend.house.scratchedList) ?? [];
  };

  const isScratchedBy = (side, qid) => scratchedList(side).includes(qid);
  const isScratchedAgainst = (side, qid) => {
    if (isVS) {
      // In VS mode, you are "scratched against" if the OTHER player scratched this question.
      return isScratchedBy(side === "player" ? "house" : "player", qid);
    }
    // In HOUSE mode, only the House side can be scratched (player scratches the House).
    return side === "house" ? isScratchedBy("player", qid) : false;
  };

  const dogsCount = (side) => {
    if (!isVS) return state.dogs ?? 0;
    return side === "player" ? (state.dogs.player ?? 0) : (state.dogs.house ?? 0);
  };

  const scratchButtonsHTML = (side) => {
    const sideLabel = side === "player" ? state.player1 : state.player2;
    const canSpend =
      (isP2 || isP3) &&
      dogsCount(side) > 0 &&
      !p.lockedResults &&
      !anyLockedBySide(side) &&
      !(isVS ? (p.dogSpend[side].voided) : p.dogSpend.voided) &&
      (scratchedList(side).length < maxScratches);

    if (!canSpend) return "";

    const prefix = isVS ? `${side}_` : "";
    const scratchesNow = scratchedList(side).length;

    return `
      <div style="margin-top:12px; border:1px solid #ddd; padding:10px; max-width:860px;">
        <div style="font-weight:800; margin-bottom:6px;">${sideLabel}: Spend DOGs 🐶</div>
        <div style="opacity:0.85; margin-bottom:10px;">
          Spend <strong>1 DOG</strong> to scratch <strong>one opponent question</strong> this period.
          ${isP3 ? `You may scratch up to <strong>2</strong> questions in Period 3.` : `Period 2 allows <strong>1</strong> scratch.`}
          Must choose before ${sideLabel} locks any picks.
          ${isP3 ? `<div style="margin-top:6px; font-size:0.9rem; opacity:0.75;">(Once Period 3 starts, leftover DOGs become void for that player.)</div>` : ""}
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button id="scratch_${prefix}q1">Scratch Q1 (Goal?)</button>
          <button id="scratch_${prefix}q2">Scratch Q2 (Penalty?)</button>
          <button id="scratch_${prefix}q3">Scratch Q3 (Both 5+ SOG?)</button>
        </div>
        <div style="margin-top:8px; font-size:0.9rem; opacity:0.75;">
          DOGs: ${renderDogs(dogsCount(side))} &nbsp; | &nbsp; Scratches: ${scratchesNow}/${maxScratches}
        </div>
      </div>
    `;
  };

  // Scratch panel(s)
  const scratchPanel = (isP2 || isP3)
    ? (isVS
        ? `${scratchButtonsHTML("player")}${scratchButtonsHTML("house")}`
        : scratchButtonsHTML("player"))
    : "";

  const qCard = (label, pickState, idPrefix, qid) => {
    const playerSection = sealedYesNoSection({
      idPrefix: `${idPrefix}_player`,
      lockedSelf: pickState.lockedPlayer,
      lockedOther: true,
      requireOtherLock: false,
      disabledAll: (isP2 || isP3) && isScratchedAgainst("player", qid)
    });

    const houseSection = sealedYesNoSection({
      idPrefix: `${idPrefix}_house`,
      lockedSelf: pickState.lockedHouse,
      lockedOther: pickState.lockedPlayer,
      requireOtherLock: true,
      disabledAll: (isP2 || isP3) && isScratchedAgainst("house", qid)
    });

    const ready = pickState.lockedPlayer && pickState.lockedHouse;

    const scratchBadges = (isP2 || isP3) ? `
      <div style="margin-top:6px; font-size:0.9rem; opacity:0.75;">
        ${isVS && isScratchedBy("player", qid) ? `<span>${state.player1} scratched ${prettyQ(qid)} ✅</span>` : ``}
        ${isVS && isScratchedBy("house", qid) ? `<span>${state.player2} scratched ${prettyQ(qid)} ✅</span>` : ``}
        ${!isVS && isScratchedBy("player", qid) ? `<span>Scratched (House disabled) ✅</span>` : ``}
      </div>` : "";

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
            <div style="font-weight:700; margin-bottom:6px;">${isVS ? state.player2 : state.house}</div>
            ${houseSection}
          </div>
        </div>
        ${ready ? `<div style="margin-top:6px; font-size:0.9rem; opacity:0.75;">Ready ✅</div>` : ""}
        ${scratchBadges}
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
    <div style="margin-top:12px; border:1px solid #ddd; padding:10px; max-width:860px;">
      <div style="font-weight:700; margin-bottom:6px;">Period ${p.n} Results (${state.house})</div>
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
      Once you lock any Period 3 pick, your leftover DOGs become <strong>void</strong>.
      If you win Period 3, you earn <strong>Good Boy!</strong> (FETCH!!).
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
      ${renderDogsDeltaLine(key)}
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
  const isVS = state.mode === "VS";

  const ownerName =
    (isVS && gb.owner === "house") ? state.player2 : state.player1;

  const opponentName =
    (isVS && gb.owner === "house") ? state.player1 : state.player2;

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
           gb.housePointRemoved ? `<strong>${opponentName} -1 point ✅</strong>` : "<strong>No effect</strong>"
         }</div>
       </div>`
    : "";

  return `
    <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:860px;">
      <h3 style="margin-top:0;">Good Boy! 🐶 — FETCH!!</h3>
      <p>
        <strong>${ownerName}</strong> won Period 3, so they earned a <strong>Good Boy</strong>.
        Roll 🎲 to target one of <strong>${opponentName}</strong>’s Period 1–2 questions.
        If <strong>${opponentName}</strong> was correct on that target, they lose <strong>1 point</strong>.
      </p>

      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <button id="gbRoll" ${gb.resolved ? "disabled" : ""}>FETCH!! (Roll 🎲)</button>
        <label style="display:flex; gap:8px; align-items:center;">
          <span>Manual roll:</span>
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

function ensureRegulationState() {
  state.regulation = state.regulation ?? {
    awayGoals: null,
    homeGoals: null,
    ppGoal: null,   // "Yes" | "No"
    locked: false,
    // Draft inputs (so selecting PP Yes/No doesn't wipe typed goals before lock)
    draftAwayGoals: null,
    draftHomeGoals: null
  };

  // Back-compat: if a save predates draft fields, seed drafts from saved values
  state.regulation.draftAwayGoals = state.regulation.draftAwayGoals ?? state.regulation.awayGoals;
  state.regulation.draftHomeGoals = state.regulation.draftHomeGoals ?? state.regulation.homeGoals;

  state.final = state.final ?? {
    winner: null,   // "Away" | "Home"
    endedIn: null,  // "REG" | "OT" | "SO"
    soLongerThan3: null // "Yes" | "No" (only if endedIn === "SO")
  };

  state.ot = state.ot ?? {
    picks: { player: null, house: null, lockedPlayer: false, lockedHouse: false },
    truth: null,
    lockedTruth: false
  };

  state.so = state.so ?? {
    picks: { player: null, house: null, lockedPlayer: false, lockedHouse: false },
    truth: null,
    lockedTruth: false
  };

  state.pregameAwarded = state.pregameAwarded ?? { q1: false, q2: false };
  state.otsoAwarded = state.otsoAwarded ?? { ot: false, so: false };
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
          value="${(reg.draftAwayGoals ?? reg.awayGoals) ?? ""}"
          placeholder="Reg goals"
          style="width:100%; padding:10px; border:1px solid #ccc;" />
      </div>
      <div style="flex:1; min-width:220px;">
        <div style="font-weight:700; margin-bottom:4px;">${state.home} (Home)</div>
        <input id="regHomeGoals" type="number" min="0" inputmode="numeric"
          value="${(reg.draftHomeGoals ?? reg.homeGoals) ?? ""}"
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

function renderOT() {
  ensureRegulationState();
  const ot = state.ot;

  const lockedP = ot.picks.lockedPlayer;
  const lockedH = ot.picks.lockedHouse;

  const playerSection = lockedP
    ? `<div style="margin:8px 0;"><strong>🔒 Locked</strong></div>`
    : `<div style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;">
         <button id="ot_playerYes">Yes</button>
         <button id="ot_playerNo">No</button>
       </div>`;

  const houseSection = lockedH
    ? `<div style="margin:8px 0;"><strong>🔒 Locked</strong></div>`
    : `<div style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;">
         <button id="ot_houseYes" ${!lockedP ? "disabled" : ""}>Yes</button>
         <button id="ot_houseNo" ${!lockedP ? "disabled" : ""}>No</button>
       </div>
       ${!lockedP ? `<div style="font-size:0.95rem; opacity:0.8;">Player locks first.</div>` : ""}`;

  const picksReady = lockedP && lockedH;

  const truthPanel = picksReady ? `
    <div style="margin-top:12px; border:1px solid #ddd; padding:10px; max-width:860px;">
      <div style="font-weight:700; margin-bottom:6px;">OT Outcome (House)</div>

      ${
        ot.lockedTruth
          ? `<div style="margin:8px 0;"><strong>🔒 OT outcome locked:</strong> ${ot.truth}</div>`
          : `<div style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;">
               <button id="ot_truthYes" style="${ot.truth === "Yes" ? "font-weight:700; border:2px solid #000;" : ""}">Yes (ended in OT)</button>
               <button id="ot_truthNo" style="${ot.truth === "No" ? "font-weight:700; border:2px solid #000;" : ""}">No (went to SO)</button>
             </div>
             <div style="opacity:0.8; margin-top:6px;">Selected: <strong>${ot.truth ?? "—"}</strong></div>
                          <button id="ot_lockTruth">Lock OT Outcome</button>`
      }

      ${
        ot.lockedTruth && ot.truth === "Yes"
          ? `<div style="margin-top:12px;">
               <div style="font-weight:700; margin-bottom:6px;">Final Winner (House)</div>
               <div style="display:flex; gap:10px; flex-wrap:wrap;">
                 <button id="finalWinnerAway">${state.away}</button>
                 <button id="finalWinnerHome">${state.home}</button>
               </div>
               <div style="margin-top:8px; opacity:0.85;">Selected: <strong>${state.final.winner ?? "—"}</strong></div>
               <button id="finalizeFromOT" ${state.final.winner ? "" : "disabled"} style="margin-top:10px;">Finalize Game</button>
             </div>`
          : ``
      }

      ${
        ot.lockedTruth && ot.truth === "No"
          ? `<div style="margin-top:12px;"><button id="toSO">Continue to Shootout</button></div>`
          : ``
      }
    </div>
  ` : `<div style="margin-top:12px; font-size:0.95rem; opacity:0.75;">Lock both picks to enter OT outcome.</div>`;

  return `
    <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:860px;">
      <h3 style="margin-top:0;">BOTD Overtime (1 pt)</h3>
      <p><strong>Question:</strong> Will the game end in OT?</p>

      <div style="display:flex; gap:12px; align-items:flex-start;">
        <div style="flex:1; border-top:1px solid #eee; padding-top:10px;">
          <div style="font-weight:700; margin-bottom:6px;">${state.player1}</div>
          ${playerSection}
          <div style="opacity:0.8;">Selected: <strong>${yn(ot.picks.player)}</strong></div>
        </div>
        <div style="width:1px; background:#eee; align-self:stretch;"></div>
        <div style="flex:1; border-top:1px solid #eee; padding-top:10px;">
          <div style="font-weight:700; margin-bottom:6px;">${state.house}</div>
          ${houseSection}
          <div style="opacity:0.8;">Selected: <strong>${yn(ot.picks.house)}</strong></div>
        </div>
      </div>

      ${truthPanel}

      <div style="display:flex; gap:10px; margin-top:12px;">
        <button id="backToRegulation">Back</button>
      </div>
    </div>
  `;
}

function renderSO() {
  ensureRegulationState();
  const so = state.so;

  const lockedP = so.picks.lockedPlayer;
  const lockedH = so.picks.lockedHouse;

  const playerSection = lockedP
    ? `<div style="margin:8px 0;"><strong>🔒 Locked</strong></div>`
    : `<div style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;">
         <button id="so_playerYes">Yes</button>
         <button id="so_playerNo">No</button>
       </div>`;

  const houseSection = lockedH
    ? `<div style="margin:8px 0;"><strong>🔒 Locked</strong></div>`
    : `<div style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;">
         <button id="so_houseYes" ${!lockedP ? "disabled" : ""}>Yes</button>
         <button id="so_houseNo" ${!lockedP ? "disabled" : ""}>No</button>
       </div>
       ${!lockedP ? `<div style="font-size:0.95rem; opacity:0.8;">Player locks first.</div>` : ""}`;

  const picksReady = lockedP && lockedH;

  const truthPanel = picksReady ? `
    <div style="margin-top:12px; border:1px solid #ddd; padding:10px; max-width:860px;">
      <div style="font-weight:700; margin-bottom:6px;">Shootout Outcome (House)</div>

      ${
        so.lockedTruth
          ? `<div style="margin:8px 0;"><strong>🔒 Shootout outcome locked:</strong> ${so.truth}</div>`
          : `<div style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;">
               <button id="so_truthYes" style="${so.truth === "Yes" ? "font-weight:700; border:2px solid #000;" : ""}">Yes (longer than 3 rounds)</button>
               <button id="so_truthNo" style="${so.truth === "No" ? "font-weight:700; border:2px solid #000;" : ""}">No (3 rounds or fewer)</button>
             </div>
             <div style="opacity:0.8; margin-top:6px;">Selected: <strong>${so.truth ?? "—"}</strong></div>
                          <button id="so_lockTruth">Lock Shootout Outcome</button>`
      }

      ${
        so.lockedTruth
          ? `<div style="margin-top:12px;">
               <div style="font-weight:700; margin-bottom:6px;">Final Winner (House)</div>
               <div style="display:flex; gap:10px; flex-wrap:wrap;">
                 <button id="finalWinnerAwaySO">${state.away}</button>
                 <button id="finalWinnerHomeSO">${state.home}</button>
               </div>
               <div style="margin-top:8px; opacity:0.85;">Selected: <strong>${state.final.winner ?? "—"}</strong></div>
               <button id="finalizeFromSO" ${state.final.winner ? "" : "disabled"} style="margin-top:10px;">Finalize Game</button>
             </div>`
          : ``
      }
    </div>
  ` : `<div style="margin-top:12px; font-size:0.95rem; opacity:0.75;">Lock both picks to enter shootout outcome.</div>`;

  return `
    <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:860px;">
      <h3 style="margin-top:0;">BOTD Shootout (1 pt)</h3>
      <p><strong>Question:</strong> Will the shootout last longer than 3 rounds?</p>

      <div style="display:flex; gap:12px; align-items:flex-start;">
        <div style="flex:1; border-top:1px solid #eee; padding-top:10px;">
          <div style="font-weight:700; margin-bottom:6px;">${state.player1}</div>
          ${playerSection}
          <div style="opacity:0.8;">Selected: <strong>${yn(so.picks.player)}</strong></div>
        </div>
        <div style="width:1px; background:#eee; align-self:stretch;"></div>
        <div style="flex:1; border-top:1px solid #eee; padding-top:10px;">
          <div style="font-weight:700; margin-bottom:6px;">${state.house}</div>
          ${houseSection}
          <div style="opacity:0.8;">Selected: <strong>${yn(so.picks.house)}</strong></div>
        </div>
      </div>

      ${truthPanel}

      <div style="display:flex; gap:10px; margin-top:12px;">
        <button id="backToOT">Back</button>
      </div>
    </div>
  `;
}

/* -------------------------
   Postgame rendering helpers
-------------------------- */
function yn(v) {
  if (v === "Yes" || v === "No") return v;
  return v ?? "—";
}
function pickTextPreQ1(v) {
  if (v === "Away") return state.away;
  if (v === "Home") return state.home;
  return v ?? "—";
}
function mark(correct) {
  return correct ? "✅" : "❌";
}

function renderTwoColRow({ leftLabel, leftVal, leftMark, rightVal, rightMark }) {
  return `
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:14px; margin:6px 0;">
      <div style="border:1px solid #eee; padding:8px;">
        <div style="font-weight:700; opacity:0.9;">${leftLabel}</div>
        <div style="margin-top:6px; font-size:1.05rem;"><strong>${leftVal}</strong> &nbsp; ${leftMark}</div>
      </div>
      <div style="border:1px solid #eee; padding:8px;">
        <div style="font-weight:700; opacity:0.9;">${state.house}</div>
        <div style="margin-top:6px; font-size:1.05rem;"><strong>${rightVal}</strong> &nbsp; ${rightMark}</div>
      </div>
    </div>
  `;
}

function periodQCorrect(periodKey, qShort) {
  const p = state.periods?.[periodKey];
  const c = p?.computed?.correct;
  if (!c) return { player: false, house: false, truth: null };

  if (qShort === "q1") return { player: !!c.q1?.player, house: !!c.q1?.house, truth: p.results.goal };
  if (qShort === "q2") return { player: !!c.q2?.player, house: !!c.q2?.house, truth: p.results.penalty };
  if (qShort === "q3") return { player: !!c.q3?.player, house: !!c.q3?.house, truth: c.q3?.truth };
  return { player: false, house: false, truth: null };
}

function isScratched(periodKey, qid) {
  const p = state.periods?.[periodKey];
  if (!p?.dogSpend) return false;

  if (state.mode === "VS") {
    const pList = p.dogSpend?.player?.scratchedList ?? [];
    const hList = p.dogSpend?.house?.scratchedList ?? [];
    return pList.includes(qid) || hList.includes(qid);
  }

  const list = p.dogSpend?.scratchedList ?? [];
  return list.includes(qid);
}

function renderPeriodSection(periodKey, title) {
  const p = state.periods?.[periodKey];
  if (!p?.computed) {
    return `
      <div style="margin-top:16px;">
        <h4 style="margin:0;">${title}</h4>
        <div style="opacity:0.75; margin-top:6px;">(No period results found.)</div>
      </div>
    `;
  }

  const q1 = periodQCorrect(periodKey, "q1");
  const q2 = periodQCorrect(periodKey, "q2");
  const q3 = periodQCorrect(periodKey, "q3");

  const q1Scr = isScratched(periodKey, "q1_goal");
  const q2Scr = isScratched(periodKey, "q2_penalty");
  const q3Scr = isScratched(periodKey, "q3_both5sog");

  const scrLine = (qidScr) => qidScr ? ` <span style="font-size:0.9rem; opacity:0.75;">(SCRATCHED 🐶)</span>` : "";

  const picks = p.picks;

  const p1 = yn(picks.q1_goal.player);
  const h1 = q1Scr ? "—" : yn(picks.q1_goal.house);

  const p2 = yn(picks.q2_penalty.player);
  const h2 = q2Scr ? "—" : yn(picks.q2_penalty.house);

  const p3 = yn(picks.q3_both5sog.player);
  const h3 = q3Scr ? "—" : yn(picks.q3_both5sog.house);

  const winnerText =
    p.computed.periodWinner === "player" ? `${state.player1}` :
    p.computed.periodWinner === "house" ? `${state.house}` :
    "Tie";

  return `
    <div style="margin-top:18px; border-top:2px solid #eee; padding-top:12px;">
      <h4 style="margin:0;">${title}</h4>

      <div style="margin-top:10px; font-weight:700;">Q1: Will there be a goal this period?${scrLine(q1Scr)}</div>
      ${renderTwoColRow({
        leftLabel: state.player1,
        leftVal: p1,
        leftMark: mark(q1.player),
        rightVal: h1,
        rightMark: q1Scr ? "❌" : mark(q1.house)
      })}

      <div style="margin-top:10px; font-weight:700;">Q2: Will there be a penalty this period?${scrLine(q2Scr)}</div>
      ${renderTwoColRow({
        leftLabel: state.player1,
        leftVal: p2,
        leftMark: mark(q2.player),
        rightVal: h2,
        rightMark: q2Scr ? "❌" : mark(q2.house)
      })}

      <div style="margin-top:10px; font-weight:700;">Q3: Will each team record at least 5 SOG this period?${scrLine(q3Scr)}</div>
      <div style="opacity:0.75; margin:4px 0 0;">Truth: <strong>${yn(q3.truth)}</strong></div>
      ${renderTwoColRow({
        leftLabel: state.player1,
        leftVal: p3,
        leftMark: mark(q3.player),
        rightVal: h3,
        rightMark: q3Scr ? "❌" : mark(q3.house)
      })}

      <div style="margin-top:10px;">
        <strong>Period ${p.n} winner:</strong> ${winnerText}
      </div>

      ${renderDogsLinePostgame(periodKey)}
    </div>
  `;
}

function renderPostgameSummary() {
  ensureRegulationState();

  let winner = state.final?.winner;
  if (!winner && state.regulation?.locked) {
    if (state.regulation.awayGoals > state.regulation.homeGoals) winner = "Away";
    else if (state.regulation.homeGoals > state.regulation.awayGoals) winner = "Home";
  }

  const winnerTeam = winner === "Away" ? state.away : winner === "Home" ? state.home : null;

  const playerWins = state.score.player > state.score.house;
  const houseWins  = state.score.house > state.score.player;

  const headline =
    playerWins ? `${state.player1} WINS!!!!!` :
    houseWins ? `${state.house} WINS!!!!!` :
    `It’s a TIE!!!!!`;

  const preQ1 = state.pre?.q1;
  const preQ2 = state.pre?.q2;

  const preQ1Truth = winner;
  const preQ1PlayerOk = preQ1Truth ? (preQ1?.player === preQ1Truth) : false;
  const preQ1HouseOk  = preQ1Truth ? (preQ1?.house === preQ1Truth) : false;

  const ppTruth = state.regulation?.ppGoal;
  const preQ2PlayerOk = (ppTruth === "Yes" || ppTruth === "No") ? (preQ2?.player === ppTruth) : false;
  const preQ2HouseOk  = (ppTruth === "Yes" || ppTruth === "No") ? (preQ2?.house === ppTruth) : false;

  const endedIn = state.final?.endedIn
    ? state.final.endedIn
    : (state.regulation?.locked && state.regulation.awayGoals !== state.regulation.homeGoals ? "REG" : null);

  const otPlayed = state.ot?.lockedTruth;
  const soPlayed = state.so?.lockedTruth;

  const otPlayerOk = otPlayed ? (state.ot.picks.player === state.ot.truth) : false;
  const otHouseOk  = otPlayed ? (state.ot.picks.house === state.ot.truth) : false;

  const soPlayerOk = soPlayed ? (state.so.picks.player === state.so.truth) : false;
  const soHouseOk  = soPlayed ? (state.so.picks.house === state.so.truth) : false;

  const goodBoyLine = state.goodBoy?.earned
    ? `<div style="margin-top:10px; padding:10px; border:1px dashed #bbb;">
         <strong>Good Boy:</strong> ${state.goodBoy.resolved
           ? `Roll ${state.goodBoy.roll} → ${state.goodBoy.target}. ${state.goodBoy.housePointRemoved ? "House -1 ✅" : "No effect."}`
           : `Earned but not resolved.`
         }
       </div>`
    : "";

  return `
    <div style="margin-top:16px; border:1px solid #ccc; padding:14px; max-width:960px;">
      <div style="text-align:center;">
        <div style="font-weight:900; letter-spacing:1px;">BEWARE OF THE DOG</div>
        <div style="margin-top:6px; font-size:1.15rem; font-weight:800;">Postgame Summary</div>
        <div style="margin-top:10px; font-size:1.35rem; font-weight:900;">${headline}</div>
        <div style="margin-top:8px;">
          <strong>Final points:</strong> ${state.player1} ${state.score.player} — ${state.house} ${state.score.house}
        </div>
        <div style="margin-top:6px; opacity:0.85;">
          <strong>Real game winner:</strong> ${winnerTeam ? winnerTeam : "—"} &nbsp; | &nbsp;
          <strong>Ended in:</strong> ${endedIn ?? "—"}
        </div>
      </div>

      ${goodBoyLine}

      <div style="margin-top:18px; border-top:2px solid #eee; padding-top:12px;">
        <h4 style="margin:0;">PreGame</h4>

        <div style="margin-top:10px; font-weight:700;">Q1: Who will win?</div>
        <div style="opacity:0.75; margin:4px 0 0;">Truth: <strong>${winnerTeam ?? "—"}</strong></div>
        ${renderTwoColRow({
          leftLabel: state.player1,
          leftVal: pickTextPreQ1(preQ1?.player),
          leftMark: preQ1Truth ? mark(preQ1PlayerOk) : "—",
          rightVal: pickTextPreQ1(preQ1?.house),
          rightMark: preQ1Truth ? mark(preQ1HouseOk) : "—"
        })}

        <div style="margin-top:10px; font-weight:700;">Q2: Will there be a power-play goal?</div>
        <div style="opacity:0.75; margin:4px 0 0;">Truth: <strong>${ppTruth ?? "—"}</strong></div>
        ${renderTwoColRow({
          leftLabel: state.player1,
          leftVal: yn(preQ2?.player),
          leftMark: (ppTruth === "Yes" || ppTruth === "No") ? mark(preQ2PlayerOk) : "—",
          rightVal: yn(preQ2?.house),
          rightMark: (ppTruth === "Yes" || ppTruth === "No") ? mark(preQ2HouseOk) : "—"
        })}
      </div>

      ${renderPeriodSection("p1", "Period 1")}
      ${renderPeriodSection("p2", "Period 2")}
      ${renderPeriodSection("p3", "Period 3")}

      ${
        otPlayed ? `
          <div style="margin-top:18px; border-top:2px solid #eee; padding-top:12px;">
            <h4 style="margin:0;">Overtime (1 pt)</h4>
            <div style="margin-top:10px; font-weight:700;">Q: Will the game end in OT?</div>
            <div style="opacity:0.75; margin:4px 0 0;">Truth: <strong>${state.ot.truth}</strong></div>
            ${renderTwoColRow({
              leftLabel: state.player1,
              leftVal: yn(state.ot.picks.player),
              leftMark: mark(otPlayerOk),
              rightVal: yn(state.ot.picks.house),
              rightMark: mark(otHouseOk)
            })}
          </div>
        ` : ``
      }

      ${
        soPlayed ? `
          <div style="margin-top:18px; border-top:2px solid #eee; padding-top:12px;">
            <h4 style="margin:0;">Shootout (1 pt)</h4>
            <div style="margin-top:10px; font-weight:700;">Q: Will the shootout last longer than 3 rounds?</div>
            <div style="opacity:0.75; margin:4px 0 0;">Truth: <strong>${state.so.truth}</strong></div>
            ${renderTwoColRow({
              leftLabel: state.player1,
              leftVal: yn(state.so.picks.player),
              leftMark: mark(soPlayerOk),
              rightVal: yn(state.so.picks.house),
              rightMark: mark(soHouseOk)
            })}
          </div>
        ` : ``
      }

      <div style="margin-top:18px; display:flex; gap:10px; flex-wrap:wrap;">
        <button id="restartGame">New Game</button>
      </div>
    </div>
  `;
}

/* -------------------------
   Awarding logic
-------------------------- */
function awardPregamePointsFromRegulation() {
  ensureRegulationState();
  const reg = state.regulation;
  if (!reg.locked) return;

  if (reg.awayGoals === reg.homeGoals) return;

  const winner = reg.awayGoals > reg.homeGoals ? "Away" : "Home";

  if (!state.pregameAwarded.q1) {
    const q1 = state.pre?.q1;
    if (q1?.player === winner) state.score.player += 1;
    if (q1?.house === winner) state.score.house += 1;
    state.pregameAwarded.q1 = true;
  }

  if (!state.pregameAwarded.q2) {
    const q2 = state.pre?.q2;
    const truth = reg.ppGoal;
    if (q2?.player === truth) state.score.player += 1;
    if (q2?.house === truth) state.score.house += 1;
    state.pregameAwarded.q2 = true;
  }

  state.final.winner = winner;
  state.final.endedIn = "REG";

  saveState();
}

function finalizeTieGameAndAwardAll() {
  ensureRegulationState();

  if (!state.final?.winner) return;

  if (!state.otsoAwarded.ot && state.ot?.lockedTruth) {
    const truth = state.ot.truth;
    const p = state.ot.picks;
    if (p.player === truth) state.score.player += 1;
    if (p.house === truth) state.score.house += 1;
    state.otsoAwarded.ot = true;
  }

  if (state.final.endedIn === "SO" && !state.otsoAwarded.so && state.so?.lockedTruth) {
    const truth = state.so.truth;
    const p = state.so.picks;
    if (p.player === truth) state.score.player += 1;
    if (p.house === truth) state.score.house += 1;
    state.otsoAwarded.so = true;
  }

  if (!state.pregameAwarded.q1) {
    const q1 = state.pre?.q1;
    if (q1?.player === state.final.winner) state.score.player += 1;
    if (q1?.house === state.final.winner) state.score.house += 1;
    state.pregameAwarded.q1 = true;
  }

  if (!state.pregameAwarded.q2) {
    const q2 = state.pre?.q2;
    const truth = state.regulation?.ppGoal;
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
  if (state.screen === "ot") wireOTButtons();
  if (state.screen === "so") wireSOButtons();
  if (state.screen === "postgame") {
    const restart = document.getElementById("restartGame");
    if (restart) restart.onclick = () => {
      localStorage.removeItem("botd_state");
      window.location.href = "index.html";
    };
  }

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
  const captureDraftGoals = () => {
    const aStr = document.getElementById("regAwayGoals")?.value ?? "";
    const hStr = document.getElementById("regHomeGoals")?.value ?? "";
    const a = parseInt(aStr, 10);
    const h = parseInt(hStr, 10);

    // Only store drafts when the inputs are parseable (avoid overwriting with NaN)
    if (Number.isFinite(a) && a >= 0) reg.draftAwayGoals = a;
    if (Number.isFinite(h) && h >= 0) reg.draftHomeGoals = h;
    saveState();
  };

  // Persist typed goal values without needing a re-render
  const awayInp = document.getElementById("regAwayGoals");
  const homeInp = document.getElementById("regHomeGoals");
  if (awayInp) awayInp.oninput = () => { captureDraftGoals(); };
  if (homeInp) homeInp.oninput = () => { captureDraftGoals(); };


  const back = document.getElementById("backFromRegulation");
  if (back) {
    back.onclick = () => {
      state.screen = state.goodBoy?.earned ? "goodboy" : "p3";
      render();
    };
  }

  const yes = document.getElementById("regPPYes");
  const no = document.getElementById("regPPNo");
  if (yes) yes.onclick = () => { captureDraftGoals(); reg.ppGoal = "Yes"; render(); };
  if (no) no.onclick = () => { captureDraftGoals(); reg.ppGoal = "No"; render(); };

  const lock = document.getElementById("lockRegulation");
  if (lock) {
    lock.onclick = () => {
      captureDraftGoals();
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
      reg.draftAwayGoals = a;
      reg.draftHomeGoals = h;
      reg.locked = true;

      // If not tied, we can set final winner right now (REG)
      if (a !== h) {
        state.final.winner = a > h ? "Away" : "Home";
        state.final.endedIn = "REG";
      } else {
        state.final.winner = null;
        state.final.endedIn = null;
      }

      render();
    };
  }

  const toOT = document.getElementById("toOT");
  if (toOT) toOT.onclick = () => { state.screen = "ot"; render(); };

  const award = document.getElementById("awardPregame");
  if (award) {
    award.onclick = () => {
      awardPregamePointsFromRegulation();
      state.screen = "postgame";
      render();
    };
  }
}

function wireOTButtons() {
  ensureRegulationState();
  const ot = state.ot;

  const back = document.getElementById("backToRegulation");
  if (back) back.onclick = () => { state.screen = "regulation"; render(); };

  const pYes = document.getElementById("ot_playerYes");
  const pNo  = document.getElementById("ot_playerNo");
  if (pYes) pYes.onclick = () => { ot.picks.player = "Yes"; ot.picks.lockedPlayer = true; render(); };
  if (pNo)  pNo.onclick  = () => { ot.picks.player = "No";  ot.picks.lockedPlayer = true; render(); };

  const hYes = document.getElementById("ot_houseYes");
  const hNo  = document.getElementById("ot_houseNo");
  if (hYes) hYes.onclick = () => { ot.picks.house = "Yes"; ot.picks.lockedHouse = true; render(); };
  if (hNo)  hNo.onclick  = () => { ot.picks.house = "No";  ot.picks.lockedHouse = true; render(); };

  const tYes = document.getElementById("ot_truthYes");
  const tNo  = document.getElementById("ot_truthNo");
  if (tYes) tYes.onclick = () => { ot.truth = "Yes"; render(); };
  if (tNo)  tNo.onclick  = () => { ot.truth = "No"; render(); };

  const lockTruth = document.getElementById("ot_lockTruth");
  if (lockTruth) lockTruth.onclick = () => {
    if (ot.truth !== "Yes" && ot.truth !== "No") { alert("Select Yes/No for OT outcome."); return; }
    ot.lockedTruth = true;
    render();
  };

  const toSO = document.getElementById("toSO");
  if (toSO) toSO.onclick = () => { state.screen = "so"; render(); };

  const wA = document.getElementById("finalWinnerAway");
  const wH = document.getElementById("finalWinnerHome");
  if (wA) wA.onclick = () => { state.final.winner = "Away"; state.final.endedIn = "OT"; render(); };
  if (wH) wH.onclick = () => { state.final.winner = "Home"; state.final.endedIn = "OT"; render(); };

  const finalize = document.getElementById("finalizeFromOT");
  if (finalize) finalize.onclick = () => {
    finalizeTieGameAndAwardAll();
    state.screen = "postgame";
    render();
  };
}

function wireSOButtons() {
  ensureRegulationState();
  const so = state.so;

  const back = document.getElementById("backToOT");
  if (back) back.onclick = () => { state.screen = "ot"; render(); };

  const pYes = document.getElementById("so_playerYes");
  const pNo  = document.getElementById("so_playerNo");
  if (pYes) pYes.onclick = () => { so.picks.player = "Yes"; so.picks.lockedPlayer = true; render(); };
  if (pNo)  pNo.onclick  = () => { so.picks.player = "No";  so.picks.lockedPlayer = true; render(); };

  const hYes = document.getElementById("so_houseYes");
  const hNo  = document.getElementById("so_houseNo");
  if (hYes) hYes.onclick = () => { so.picks.house = "Yes"; so.picks.lockedHouse = true; render(); };
  if (hNo)  hNo.onclick  = () => { so.picks.house = "No";  so.picks.lockedHouse = true; render(); };

  const tYes = document.getElementById("so_truthYes");
  const tNo  = document.getElementById("so_truthNo");
  if (tYes) tYes.onclick = () => { so.truth = "Yes"; render(); };
  if (tNo)  tNo.onclick  = () => { so.truth = "No"; render(); };

  const lockTruth = document.getElementById("so_lockTruth");
  if (lockTruth) lockTruth.onclick = () => {
    if (so.truth !== "Yes" && so.truth !== "No") { alert("Select Yes/No for shootout outcome."); return; }
    so.lockedTruth = true;
    render();
  };

  const wA = document.getElementById("finalWinnerAwaySO");
  const wH = document.getElementById("finalWinnerHomeSO");
  if (wA) wA.onclick = () => { state.final.winner = "Away"; state.final.endedIn = "SO"; state.final.soLongerThan3 = so.truth; render(); };
  if (wH) wH.onclick = () => { state.final.winner = "Home"; state.final.endedIn = "SO"; state.final.soLongerThan3 = so.truth; render(); };

  const finalize = document.getElementById("finalizeFromSO");
  if (finalize) finalize.onclick = () => {
    finalizeTieGameAndAwardAll();
    state.screen = "postgame";
    render();
  };
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
  const isVS = state.mode === "VS";
  const undoKey = key;

  // Ensure dogSpend shape
  p.dogSpend = p.dogSpend ?? {};
  if (!isVS) {
    p.dogSpend.scratchedList = p.dogSpend.scratchedList ?? (p.dogSpend.scratched ? [p.dogSpend.scratched] : []);
  } else {
    p.dogSpend.player = p.dogSpend.player ?? { used: false, scratchedList: [], voided: false };
    p.dogSpend.house  = p.dogSpend.house  ?? { used: false, scratchedList: [], voided: false };

    // Migrate legacy list into player side if present
    if (Array.isArray(p.dogSpend.scratchedList) && p.dogSpend.scratchedList.length && p.dogSpend.player.scratchedList.length === 0) {
      p.dogSpend.player.scratchedList = [...p.dogSpend.scratchedList];
      delete p.dogSpend.scratchedList;
    }
  }

  const maxScratches = isP3 ? 2 : (isP2 ? 1 : 0);

  const dogsCount = (side) => {
    if (!isVS) return state.dogs ?? 0;
    return side === "player" ? (state.dogs.player ?? 0) : (state.dogs.house ?? 0);
  };
  const setDogs = (side, val) => {
    if (!isVS) { state.dogs = val; return; }
    if (side === "player") state.dogs.player = val;
    else state.dogs.house = val;
  };

  const anyLockedBySide = (side) =>
    picks.q1_goal[`locked${side === "player" ? "Player" : "House"}`] ||
    picks.q2_penalty[`locked${side === "player" ? "Player" : "House"}`] ||
    picks.q3_both5sog[`locked${side === "player" ? "Player" : "House"}`];

  const scratchedList = (side) => {
    if (!isVS) return p.dogSpend.scratchedList ?? [];
    return (side === "player" ? p.dogSpend.player.scratchedList : p.dogSpend.house.scratchedList) ?? [];
  };
  const isScratchedBy = (side, qid) => scratchedList(side).includes(qid);

  const scratchOpponent = (scratcherSide, qid) => {
    const victimSide = (scratcherSide === "player") ? "house" : "player";
    const target = p.picks[qid];

    // Spend dog
    setDogs(scratcherSide, Math.max(0, dogsCount(scratcherSide) - 1));

    // Record scratch
    if (!isVS) {
      p.dogSpend.used = true;
      if (!p.dogSpend.scratchedList.includes(qid)) p.dogSpend.scratchedList.push(qid);
      // Victim is House in HOUSE mode
      target.lockedHouse = true;
      target.house = null;
    } else {
      p.dogSpend[scratcherSide].used = true;
      if (!p.dogSpend[scratcherSide].scratchedList.includes(qid)) p.dogSpend[scratcherSide].scratchedList.push(qid);

      // Lock the victim side
      if (victimSide === "player") {
        target.lockedPlayer = true;
        target.player = null;
      } else {
        target.lockedHouse = true;
        target.house = null;
      }
    }
  };

  const canScratchSide = (side) =>
    (isP2 || isP3) &&
    dogsCount(side) > 0 &&
    !p.lockedResults &&
    !anyLockedBySide(side) &&
    !(isVS ? p.dogSpend[side].voided : p.dogSpend.voided) &&
    scratchedList(side).length < maxScratches;

  // Wire scratch buttons
  if (isP2 || isP3) {
    // HOUSE/legacy: player scratches house
    if (!isVS && canScratchSide("player")) {
      const doScratch = (qid) => {
        if (p.dogSpend.scratchedList.includes(qid)) return;
        pushUndo(undoKey, snapPeriod(key));
        scratchOpponent("player", qid);
        render();
      };
      const b1 = document.getElementById("scratch_q1");
      const b2 = document.getElementById("scratch_q2");
      const b3 = document.getElementById("scratch_q3");
      if (b1) b1.onclick = () => doScratch("q1_goal");
      if (b2) b2.onclick = () => doScratch("q2_penalty");
      if (b3) b3.onclick = () => doScratch("q3_both5sog");
    }

    // VS: both sides can scratch
    if (isVS) {
      const wireScratchSet = (side) => {
        if (!canScratchSide(side)) return;
        const prefix = `${side}_`;
        const doScratch = (qid) => {
          if (isScratchedBy(side, qid)) return;
          pushUndo(undoKey, snapPeriod(key));
          scratchOpponent(side, qid);
          render();
        };
        const b1 = document.getElementById(`scratch_${prefix}q1`);
        const b2 = document.getElementById(`scratch_${prefix}q2`);
        const b3 = document.getElementById(`scratch_${prefix}q3`);
        if (b1) b1.onclick = () => doScratch("q1_goal");
        if (b2) b2.onclick = () => doScratch("q2_penalty");
        if (b3) b3.onclick = () => doScratch("q3_both5sog");
      };
      wireScratchSet("player");
      wireScratchSet("house");
    }
  }

  // P3: void leftover dogs after each side locks their first pick
  const voidDogsIfP3Started = (side) => {
    if (!isP3) return;
    if (!isVS) {
      if (p.dogSpend.voided) return;
      if (anyLockedBySide("player")) {
        state.dogs = 0;
        p.dogSpend.voided = true;
      }
      return;
    }
    if (p.dogSpend[side].voided) return;
    if (anyLockedBySide(side)) {
      setDogs(side, 0);
      p.dogSpend[side].voided = true;
    }
  };

  // Wire yes/no picks (player/house)
  const wirePickYesNo = (pickState, prefix, qid) => {
    // Player 1
    const pYes = document.getElementById(`${prefix}_player_Yes`);
    const pNo  = document.getElementById(`${prefix}_player_No`);
    if (pYes) pYes.onclick = () => {
      pushUndo(undoKey, snapPeriod(key));
      pickState.player = "Yes";
      pickState.lockedPlayer = true;
      voidDogsIfP3Started("player");
      render();
    };
    if (pNo) pNo.onclick = () => {
      pushUndo(undoKey, snapPeriod(key));
      pickState.player = "No";
      pickState.lockedPlayer = true;
      voidDogsIfP3Started("player");
      render();
    };

    // Player 2 / House
    const hYes = document.getElementById(`${prefix}_house_Yes`);
    const hNo  = document.getElementById(`${prefix}_house_No`);
    if (hYes) hYes.onclick = () => {
      pushUndo(undoKey, snapPeriod(key));
      pickState.house = "Yes";
      pickState.lockedHouse = true;
      voidDogsIfP3Started("house");
      render();
    };
    if (hNo) hNo.onclick = () => {
      pushUndo(undoKey, snapPeriod(key));
      pickState.house = "No";
      pickState.lockedHouse = true;
      voidDogsIfP3Started("house");
      render();
    };
  };

  wirePickYesNo(picks.q1_goal, `${key}q1`, "q1_goal");
  wirePickYesNo(picks.q2_penalty, `${key}q2`, "q2_penalty");
  wirePickYesNo(picks.q3_both5sog, `${key}q3`, "q3_both5sog");

  // Results checkboxes mutual exclusive
  const goalY = document.getElementById(`${key}_r_goal_y`);
  const goalN = document.getElementById(`${key}_r_goal_n`);
  const penY  = document.getElementById(`${key}_r_pen_y`);
  const penN  = document.getElementById(`${key}_r_pen_n`);

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
          house: (picks.q1_goal.house === r.goal)
        },
        q2: {
          player: (picks.q2_penalty.player === r.penalty),
          house: (picks.q2_penalty.house === r.penalty)
        },
        q3: {
          truth: q3Truth,
          player: (picks.q3_both5sog.player === q3Truth),
          house: (picks.q3_both5sog.house === q3Truth)
        }
      };

      // Apply scratches: a scratched side cannot be correct
      if (!isVS) {
        const list = p.dogSpend.scratchedList ?? [];
        if (list.includes("q1_goal")) correct.q1.house = false;
        if (list.includes("q2_penalty")) correct.q2.house = false;
        if (list.includes("q3_both5sog")) correct.q3.house = false;
      } else {
        const pList = p.dogSpend.player.scratchedList ?? [];
        const hList = p.dogSpend.house.scratchedList ?? [];
        // Player scratched House => House disabled
        if (pList.includes("q1_goal")) correct.q1.house = false;
        if (pList.includes("q2_penalty")) correct.q2.house = false;
        if (pList.includes("q3_both5sog")) correct.q3.house = false;
        // House scratched Player => Player disabled
        if (hList.includes("q1_goal")) correct.q1.player = false;
        if (hList.includes("q2_penalty")) correct.q2.player = false;
        if (hList.includes("q3_both5sog")) correct.q3.player = false;
      }

      const playerCorrect = (correct.q1.player ? 1 : 0) + (correct.q2.player ? 1 : 0) + (correct.q3.player ? 1 : 0);
      const houseCorrect  = (correct.q1.house ? 1 : 0) + (correct.q2.house ? 1 : 0) + (correct.q3.house ? 1 : 0);

      let periodWinner = "none";
      if (playerCorrect >= 2 && houseCorrect < 2) periodWinner = "player";
      else if (houseCorrect >= 2 && playerCorrect < 2) periodWinner = "house";

      // Award points
      state.score.player += playerCorrect;
      state.score.house += houseCorrect;

      // DOG effects:
      // - HOUSE mode: winner adds/removes from Player 1 pool (legacy)
      // - VS mode: each winner gains +1 to their own pool
      if (!isP3) {
        if (!isVS) {
          if (periodWinner === "player") state.dogs = (state.dogs ?? 0) + 1;
          else if (periodWinner === "house") state.dogs = Math.max(0, (state.dogs ?? 0) - 1);
        } else {
          if (periodWinner === "player") state.dogs.player = (state.dogs.player ?? 0) + 1;
          else if (periodWinner === "house") state.dogs.house = (state.dogs.house ?? 0) + 1;
        }
      } else {
        // End of P3: leftover dogs should be 0 no matter what
        if (!isVS) state.dogs = 0;
        else { state.dogs.player = 0; state.dogs.house = 0; }

        // Good Boy earned by the winner in VS; Player only in HOUSE
        if (periodWinner === "player" || (isVS && periodWinner === "house")) {
          state.goodBoy.earned = true;
          state.goodBoy.owner = (periodWinner === "house") ? "house" : "player";
          state.goodBoy.resolved = false;
          state.goodBoy.roll = null;
          state.goodBoy.target = null;
          state.goodBoy.housePointRemoved = false;
        } else {
          state.goodBoy.earned = false;
          state.goodBoy.owner = null;
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

  const isVS = state.mode === "VS";
  const owner = (isVS && gb.owner === "house") ? "house" : "player";
  const opponent = owner === "player" ? "house" : "player";

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

    // The opponent loses a point ONLY if they were correct on the target.
    const opponentWasCorrect = !!periodObj?.computed?.correct?.[target.q]?.[opponent];

    gb.housePointRemoved = false;
    if (opponentWasCorrect) {
      if (opponent === "house") state.score.house = Math.max(0, (state.score.house ?? 0) - 1);
      else state.score.player = Math.max(0, (state.score.player ?? 0) - 1);
      gb.housePointRemoved = true;
    }

    gb.resolved = true;
    render();
  };

  const rollBtn = document.getElementById("gbRoll");
  if (rollBtn) rollBtn.onclick = () => {
    if (gb.resolved) return;
    const ok = confirm("Roll 🎲 for Good Boy?");
    if (!ok) return;
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
}
