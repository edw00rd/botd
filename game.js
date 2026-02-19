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
  const q1 = state.pre.q1;

  const playerSection = q1.lockedPlayer
    ? `<div style="margin:8px 0;"><strong>🔒 Locked</strong></div>`
    : `
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;">
        <button id="playerAway">${away}</button>
        <button id="playerHome">${home}</button>
      </div>
    `;

  // House can’t act until player locks. Also hide house buttons after house locks.
  const houseSection = q1.lockedHouse
    ? `<div style="margin:8px 0;"><strong>🔒 Locked</strong></div>`
    : `
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;">
        <button id="houseAway" ${!q1.lockedPlayer ? "disabled" : ""}>${away}</button>
        <button id="houseHome" ${!q1.lockedPlayer ? "disabled" : ""}>${home}</button>
      </div>
      <div style="font-size:0.95rem; opacity:0.8;">
        House picks are hidden. Player must lock first.
      </div>
    `;

  gameEl.innerHTML = `
    <div style="border:1px solid #ccc; padding:12px; max-width:520px;">
      <h2 style="margin-top:0;">${away} @ ${home}</h2>
      <p style="margin:6px 0;"><strong>${state.player1}</strong> vs <strong>${state.house}</strong></p>
      <p style="margin:6px 0;">
        <strong>Score:</strong> ${state.player1} ${state.score.player} — ${state.house} ${state.score.house}
        &nbsp; | &nbsp; <strong>DOGs:</strong> ${state.dogs}
      </p>
      <p style="margin:6px 0;"><strong>ANTE:</strong> ${state.ante || "(none)"} </p>
    </div>

    <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:520px;">
  <h3 style="margin-top:0;">Pre-Game Q1 (1 pt)</h3>
  <p><strong>Who will win the game?</strong></p>

  <div style="display:flex; gap:12px; align-items:flex-start;">
    <!-- PLAYER COLUMN -->
    <div style="flex:1; border-top:1px solid #eee; padding-top:10px;">
      <div style="font-weight:700; margin-bottom:6px;">${state.player1}</div>
      ${playerSection}
    </div>

    <!-- DIVIDER -->
    <div style="width:1px; background:#eee; align-self:stretch;"></div>

    <!-- HOUSE COLUMN -->
    <div style="flex:1; border-top:1px solid #eee; padding-top:10px;">
      <div style="font-weight:700; margin-bottom:6px;">${state.house}</div>
      ${houseSection}
    </div>
  </div>
 </div>
  `;

  wireQ1Buttons();
  localStorage.setItem("botd_state", JSON.stringify(state));
}

function wireQ1Buttons() {
  const q1 = state.pre.q1;

  // Player buttons (exist only if not locked)
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

  // House buttons (exist only if not locked)
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