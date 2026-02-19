const state = JSON.parse(localStorage.getItem("botd_state"));
const gameEl = document.getElementById("game");

if (!state) {
  gameEl.textContent = "No game state found. Go back to setup.";
} else {
  // Canon: away/home
  state.score = state.score ?? { kid: 0, house: 0 };
  state.dogs = state.dogs ?? 0;

  // Where we store answers for Q1
  state.pre = state.pre ?? {};
  state.pre.q1 = state.pre.q1 ?? { kid: null, house: null, lockedKid: false, lockedHouse: false };

  render();
}

function render() {
  const away = state.away;
  const home = state.home;

  const q1 = state.pre.q1;

  gameEl.innerHTML = `
    <div style="border:1px solid #ccc; padding:12px; max-width:520px;">
      <h2 style="margin-top:0;">${away} @ ${home}</h2>
      <p style="margin:6px 0;"><strong>Kid:</strong> ${state.player1} &nbsp; | &nbsp; <strong>House:</strong> ${state.house}</p>
      <p style="margin:6px 0;"><strong>Score:</strong> Kid ${state.score.kid} — House ${state.score.house} &nbsp; | &nbsp; <strong>DOGs:</strong> ${state.dogs}</p>
      <p style="margin:6px 0;"><strong>ANTE:</strong> ${state.ante || "(none)"} </p>
    </div>

    <div style="margin-top:16px; border:1px solid #ccc; padding:12px; max-width:520px;">
      <h3 style="margin-top:0;">Pre-Game Q1 (1 pt)</h3>
      <p><strong>Who will win the game?</strong></p>

      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
        <button id="kidAway" ${q1.lockedKid ? "disabled" : ""}>Kid: Away</button>
        <button id="kidHome" ${q1.lockedKid ? "disabled" : ""}>Kid: Home</button>
      </div>

      <div style="margin:6px 0;">
        <strong>Kid pick:</strong> ${q1.kid ?? "—"} ${q1.lockedKid ? "🔒" : ""}
      </div>

      <hr />

      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
        <button id="houseAway" ${(!q1.lockedKid || q1.lockedHouse) ? "disabled" : ""}>House: Away</button>
        <button id="houseHome" ${(!q1.lockedKid || q1.lockedHouse) ? "disabled" : ""}>House: Home</button>
      </div>

      <div style="margin:6px 0;">
        <strong>House pick:</strong> ${q1.lockedHouse ? (q1.house ?? "—") : "Hidden"} ${q1.lockedHouse ? "🔒" : ""}
      </div>

      <p style="font-size:0.95rem; opacity:0.8; margin-top:10px;">
        House picks are hidden until locked. Kid must lock first.
      </p>
    </div>
  `;

  wireQ1Buttons();
  localStorage.setItem("botd_state", JSON.stringify(state));
}

function wireQ1Buttons() {
  const q1 = state.pre.q1;

  // Kid buttons
  document.getElementById("kidAway").onclick = () => {
    q1.kid = "Away";
    q1.lockedKid = true;
    render();
  };
  document.getElementById("kidHome").onclick = () => {
    q1.kid = "Home";
    q1.lockedKid = true;
    render();
  };

  // House buttons (only enabled after kid locks)
  document.getElementById("houseAway").onclick = () => {
    q1.house = "Away";
    q1.lockedHouse = true;
    render();
  };
  document.getElementById("houseHome").onclick = () => {
    q1.house = "Home";
    q1.lockedHouse = true;
    render();
  };
}