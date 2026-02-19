const state = JSON.parse(localStorage.getItem("botd_state"));

const gameEl = document.getElementById("game");

if (!state) {
  gameEl.textContent = "No game state found. Go back to setup.";
} else {
  gameEl.innerHTML = `
    <h2>${state.teamA} vs ${state.teamB}</h2>
    <p><strong>Kid:</strong> ${state.player1}</p>
    <p><strong>House:</strong> ${state.scorekeeper}</p>
    <p><strong>ANTE:</strong> ${state.ante}</p>
  `;
}