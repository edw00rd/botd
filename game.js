// BOTD — game.js (drop-in)
// - Away @ Home convention
// - "House" terminology
// - Side-by-side question layout
// - Picks hidden after lock (only shows 🔒 Locked)
// - House helper text only shows BEFORE player locks
// - Continue button appears once both are locked (stub for Q2)

// Load state
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

  // Simple screen routing (we'll expand later)
  state.screen = state.screen ?? "pre_q1"; // "pre_q1" -> "pre_q2" -> ...

  // Pre-game answers
  state.pre = state.pre ?? {};
  state.pre.q1 = state.pre.q1 ?? {
    player: null,        // "Away" | "Home"
    house: null,         // "Away" | "Home"
    lockedPlayer: false,
    lockedHouse: false
  };

  render();
}

function render() {
  const away = state.away;
  const home = state.home;

  // Base header card
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

  // Screen content
  let screenHTML = "";
  if (state.screen === "pre_q1") {
    screenHTML = renderPreQ1();
  } else if (state.screen === "pre_q2") {
    // Stub screen to confirm "Continue" works
    screenHTML = `
      <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:520px;">
        <h3 style="margin-top:0;">Pre-Game Q2 (1 pt)</h3>
        <p><strong>Coming next:</strong> "Will there be a power-play goal in the game?"</p>
        <button id="backToQ1">Back to Q1</button>
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

function renderPreQ1() {
  const away = state.away;
  const home = state.home;
  const q1 = state.pre.q1;

  // Player section: buttons until lock, then only 🔒 Locked
  const playerSection = q1.lockedPlayer
    ? `<div style="margin:8px 0;"><strong>🔒 Locked</strong></div>`
    : `
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;">
        <button id="playerAway">${away}</button>
        <button id="playerHome">${home}</button>
      </div>
    `;

  // House section: disabled until player locks; helper text only BEFORE player locks; buttons vanish after lock
  const houseSection = q1.lockedHouse
    ? `<div style="margin:8px 0;"><strong>🔒 Locked</strong></div>`
    : `
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;">
        <button id="houseAway" ${!q1.lockedPlayer ? "disabled" : ""}>${away}</button>
        <button id="houseHome" ${!q1.lockedPlayer ? "disabled" : ""}>${home}</button>
      </div>
      ${
        !q1.lockedPlayer
          ? `<div style="font-size:0.95rem; opacity:0.8;">Player locks first.</div>`
          : ""
      }
    `;

  // Continue button once both locked
  const continueHTML =
    q1.lockedPlayer && q1.lockedHouse
      ? `
        <div style="margin-top:12px;">
          <button id="toQ2">Continue</button>
        </div>
      `
      : "";

  return `
    <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:520px;">
      <h3 style="margin-top:0;">Pre-Game Q1 (1 pt)</h3>
      <p><strong>Who will win the game?</strong></p>

      <div style="display:flex; gap:12px; align-items:flex-start;">
        <div style="flex:1; border-top:1px solid #eee; padding-top:10px;">
          <div style="font-weight:700; margin-bottom:6px;">${state.player1}</div>
          ${playerSection}
        </div>

        <div style="width:1px; background:#eee; align-self:stretch;"></div>

        <div style="flex:1; border-top:1px solid #eee; padding-top:10px;">
          <div style="font-weight:700; margin-bottom:6px;">${state.house}</div>
          ${houseSection}
        </div>
      </div>

      ${continueHTML}
    </div>
  `;
}

function wireHandlers() {
  // Wire Q1 buttons if present
  if (state.screen === "pre_q1") {
    wirePreQ1Buttons();
  }

  // Wire Q2 stub buttons if present
  const backToQ1 = document.getElementById("backToQ1");
  if (backToQ1) {
    backToQ1.onclick = () => {
      state.screen = "pre_q1";
      render();
    };
  }

  const toQ2 = document.getElementById("toQ2");
  if (toQ2) {
    toQ2.onclick = () => {
      state.screen = "pre_q2";
      render();
    };
  }
}

function wirePreQ1Buttons() {
  const q1 = state.pre.q1;

  // Player buttons exist only if not locked
  const playerAwayBtn = document.getElementById("playerAway");
  const playerHomeBtn = document.getElementById("playerHome");

  if (playerAwayBtn) {
    playerAwayBtn.onclick = () => {
      q1.player = "Away";
      q1.lockedPlayer = true;
      render();
    };
  }
  if (playerHomeBtn) {
    playerHomeBtn.onclick = () => {
      q1.player = "Home";
      q1.lockedPlayer = true;
      render();
    };
  }

  // House buttons exist only if not locked
  const houseAwayBtn = document.getElementById("houseAway");
  const houseHomeBtn = document.getElementById("houseHome");

  if (houseAwayBtn) {
    houseAwayBtn.onclick = () => {
      q1.house = "Away";
      q1.lockedHouse = true;
      render();
    };
  }
  if (houseHomeBtn) {
    houseHomeBtn.onclick = () => {
      q1.house = "Home";
      q1.lockedHouse = true;
      render();
    };
  }
}