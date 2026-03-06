// Minimal setup page logic for BOTD
(() => {
  const startBtn = document.getElementById("startBtn");
  startBtn?.addEventListener("click", () => {
    const away = (document.getElementById("away").value || "Away").trim();
    const home = (document.getElementById("home").value || "Home").trim();
    const mode = (document.getElementById("mode").value || "HOUSE").trim().toUpperCase();
    const player1 = (document.getElementById("player1").value || "Player 1").trim();
    const house = (document.getElementById("house").value || (mode === "VS" ? "Player 2" : "House")).trim();
    const state = {
      away,
      home,
      mode,
      player1,
      house,
      ante: "",
      screen: "pre_q1",
      live: false,
      dogs: 0,
      pre: {},
      periods: {},
      // Additional defaults will be set in game.js
    };
    localStorage.setItem("botd_state", JSON.stringify(state));
    window.location.href = "game.html";
  });
})();
