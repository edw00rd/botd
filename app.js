// app.js — Start screen logic with HOUSE vs VS mode

document.getElementById("mode").addEventListener("change", (e) => {
  const mode = e.target.value;
  document.getElementById("p1Label").textContent = mode === "vs" ? "Player 1" : "Player";
  document.getElementById("p2Label").textContent = mode === "vs" ? "Player 2" : "House";
});

document.getElementById("startBtn").addEventListener("click", () => {
  const state = {
    mode: document.getElementById("mode").value,
    league: document.getElementById("league").value,
    live: document.getElementById("liveToggle").checked,
    away: document.getElementById("away").value.trim(),
    home: document.getElementById("home").value.trim(),
    player1: document.getElementById("player1").value.trim() || "Player 1",
    house: document.getElementById("house").value.trim() || "House",
    ante: document.getElementById("ante").value.trim(),
    screen: "pre_q1"
  };

  if (!state.away || !state.home) {
    alert("Enter both Away and Home teams.");
    return;
  }

  localStorage.setItem("botd_state", JSON.stringify(state));
  window.location.href = "game.html";
});
