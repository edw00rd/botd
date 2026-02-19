document.getElementById("startBtn").addEventListener("click", () => {
  const state = {
    league: document.getElementById("league").value,
    live: document.getElementById("liveToggle").checked,
    away: document.getElementById("away").value.trim(),
    home: document.getElementById("home").value.trim(),
    player1: document.getElementById("player1").value.trim(),
    scorekeeper: document.getElementById("scorekeeper").value.trim(),
    ante: document.getElementById("ante").value.trim(),
    startedAt: new Date().toISOString()
  };

  if (!state.teamA || !state.teamB || !state.player1 || !state.scorekeeper) {
    alert("Fill Team A, Team B, Player, and Scorekeeper.");
    return;
  }

  localStorage.setItem("botd_state", JSON.stringify(state));
  window.location.href = "game.html";
});
