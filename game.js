// BOTD — game.js (drop-in, now includes Pre-Game Q2)
// - Away @ Home convention
// - "House" terminology
// - Side-by-side question layout
// - Picks hidden after lock (only shows 🔒 Locked)
// - House helper text only shows BEFORE player locks
// - Continue flow Q1 -> Q2 -> (stub) Period 1 next

const state = JSON.parse(localStorage.getItem("botd_state"));
const gameEl = document.getElementById("game");

if (!state) {
  gameEl.textContent = "No game state found. Go back to setup.";
} else {
  // Back-compat: older saves may have scorekeeper instead of house
  state.house = state.house ?? state.scorekeeper;

  // Canon: away/home
  state.score = state.score ?? { player: 0, house: 0 };
  state.dogs = state.dogs ?? 0;

  // Simple screen routing
  state.screen = state.screen ?? "pre_q1"; // "pre_q1" -> "pre_q2" -> "period1_stub"

  // Pre-game answers
  state.pre = state.pre ?? {};

  state.pre.q1 = state.pre.q1 ?? {
    player: null,        // "Away" | "Home"
    house: null,         // "Away" | "Home"
    lockedPlayer: false,
    lockedHouse: false
  };

  // Q2: Power-play goal? (Yes/No)
  state.pre.q2 = state.pre.q2 ?? {
    player: null,        // "Yes" | "No"
    house: null,         // "Yes" | "No"
    lockedPlayer: false,
    lockedHouse: false
  };

  render();
}

function render() {
  const away = state.away;
  const home = state.home;

  const headerHTML = `
    <div style="border:1px solid #ccc; padding:12px; max-width:520px;">
      <h2 style="margin-top:0;">${away} @ ${home}</h2>
      <p style="margin:6px 0;"><strong>${state.player1}</strong> vs <strong>${state.house}</strong></p>
      <p style="margin:6px 0;">
        <strong>Score:</strong> ${state.player1} ${state.score.player} — ${state.house} ${state.score.house}
        &nbsp; | &nbsp; <strong>DOGs:</strong> ${state.dogs}
      </p>
      <p style="margin:6px 0;"><strong>ANTE:</strong> ${state.ante || "(none)"} </p>
    </div>
  `;

  let screenHTML = "";
  if (state.screen === "pre_q1") {
    screenHTML = renderPreQ1();
  } else if (state.screen === "pre_q2") {
    screenHTML = renderPreQ2();
  } else if (state.screen === "period1_stub") {
    screenHTML = `
      <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:520px;">
        <h3 style="margin-top:0;">Period 1 (Next)</h3>
        <p>Pre-game is complete. Next up: Period questions + DOG system.</p>
        <button id="backToQ2">Back</button>
      </div>
    `;
  } else {
    screenHTML = `
      <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:520px;">
        <p>Unknown screen: ${state.screen}</p>
      </div>
    `;
  }

  gameEl.innerHTML = `${headerHTML}${screenHTML}`;

  wireHandlers();
  localStorage.setItem("botd_state", JSON.stringify(state));
}

function renderSideBySideQuestion({
  title,
  questionText,
  leftName,
  rightName,
  leftLocked,
  rightLocked,
  leftSectionHTML,
  rightSectionHTML,
  continueButtonHTML = "",
  backButtonHTML = ""
}) {
  return `
    <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:520px;">
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
        ${backButtonHTML}
        ${continueButtonHTML}
      </div>
    </div>
  `;
}

function renderPreQ1() {
  const away = state.away;
  const home = state.home;
  const q1 = state.pre.q1;

  const playerSection = q1.lockedPlayer
    ? `<div style="margin:8px 0;"><strong>🔒 Locked</strong></div>`
    : `
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;">
        <button id="q1_playerAway">${away}</button>
        <button id="q1_playerHome">${home}</button>
      </div>
    `;

  const houseSection = q1.lockedHouse
    ? `<div style="margin:8px 0;"><strong>🔒 Locked</strong></div>`
    : `
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;">
        <button id="q1_houseAway" ${!q1.lockedPlayer ? "disabled" : ""}>${away}</button>
        <button id="q1_houseHome" ${!q1.lockedPlayer ? "disabled" : ""}>${home}</button>
      </div>
      ${!q1.lockedPlayer ? `<div style="font-size:0.95rem; opacity:0.8;">Player locks first.</div>` : ""}
    `;

  const continueHTML =
    q1.lockedPlayer && q1.lockedHouse
      ? `<button id="toQ2">Continue</button>`
      : "";

  return renderSideBySideQuestion({
    title: "Pre-Game Q1 (1 pt)",
    questionText: "Who will win the game?",
    leftName: state.player1,
    rightName: state.house,
    leftLocked: q1.lockedPlayer,
    rightLocked: q1.lockedHouse,
    leftSectionHTML: playerSection,
    rightSectionHTML: houseSection,
    continueButtonHTML: continueHTML
  });
}

function renderPreQ2() {
  const q2 = state.pre.q2;

  const playerSection = q2.lockedPlayer
    ? `<div style="margin:8px 0;"><strong>🔒 Locked</strong></div>`
    : `
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;">
        <button id="q2_playerYes">Yes</button>
        <button id="q2_playerNo">No</button>
      </div>
    `;

  const houseSection = q2.lockedHouse
    ? `<div style="margin:8px 0;"><strong>🔒 Locked</strong></div>`
    : `
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;">
        <button id="q2_houseYes" ${!q2.lockedPlayer ? "disabled" : ""}>Yes</button>
        <button id="q2_houseNo" ${!q2.lockedPlayer ? "disabled" : ""}>No</button>
      </div>
      ${!q2.lockedPlayer ? `<div style="font-size:0.95rem; opacity:0.8;">Player locks first.</div>` : ""}
    `;

  const backHTML = `<button id="backToQ1">Back</button>`;

  const continueHTML =
    q2.lockedPlayer && q2.lockedHouse
      ? `<button id="toPeriod1">Continue</button>`
      : "";

  return renderSideBySideQuestion({
    title: "Pre-Game Q2 (1 pt)",
    questionText: "Will there be a power-play goal in the game?",
    leftName: state.player1,
    rightName: state.house,
    leftLocked: q2.lockedPlayer,
    rightLocked: q2.lockedHouse,
    leftSectionHTML: playerSection,
    rightSectionHTML: houseSection,
    backButtonHTML: backHTML,
    continueButtonHTML: continueHTML
  });
}

function wireHandlers() {
  // Pre Q1
  if (state.screen === "pre_q1") wirePreQ1Buttons();
  // Pre Q2
  if (state.screen === "pre_q2") wirePreQ2Buttons();

  const toQ2 = document.getElementById("toQ2");
  if (toQ2) {
    toQ2.onclick = () => {
      state.screen = "pre_q2";
      render();
    };
  }

  const backToQ1 = document.getElementById("backToQ1");
  if (backToQ1) {
    backToQ1.onclick = () => {
      state.screen = "pre_q1";
      render();
    };
  }

  const toPeriod1 = document.getElementById("toPeriod1");
  if (toPeriod1) {
    toPeriod1.onclick = () => {
      state.screen = "period1_stub";
      render();
    };
  }

  const backToQ2 = document.getElementById("backToQ2");
  if (backToQ2) {
    backToQ2.onclick = () => {
      state.screen = "pre_q2";
      render();
    };
  }
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

  const pYes = document.getElementById("q2_playerYes");
  const pNo = document.getElementById("q2_playerNo");
  if (pYes) pYes.onclick = () => { q2.player = "Yes"; q2.lockedPlayer = true; render(); };
  if (pNo) pNo.onclick = () => { q2.player = "No"; q2.lockedPlayer = true; render(); };

  const hYes = document.getElementById("q2_houseYes");
  const hNo = document.getElementById("q2_houseNo");
  if (hYes) hYes.onclick = () => { q2.house = "Yes"; q2.lockedHouse = true; render(); };
  if (hNo) hNo.onclick = () => { q2.house = "No"; q2.lockedHouse = true; render(); };
}