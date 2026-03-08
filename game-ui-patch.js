(function () {
  function rightSideName() {
    return state.mode === "VS" ? state.player2 : state.house;
  }

  window.render = function render() {
    const away = state.away;
    const home = state.home;
    const rightName = rightSideName();

    const dogsLine = (state.mode === "VS")
      ? `${state.player1}: ${renderDogs(state.dogs.player)} &nbsp; | &nbsp; ${rightName}: ${renderDogs(state.dogs.house)}`
      : renderDogs(state.dogs);

    const headerHTML = `
      <section class="game-header">
        <h2 class="game-header-title">${away} @ ${home}</h2>
        <div class="game-header-grid">
          <div class="header-meta">
            <p><strong>${state.player1}</strong> vs <strong>${rightName}</strong></p>
            <p id="scoreBar" class="score-pill">
              <strong>Score:</strong> ${state.player1} ${state.score.player} — ${rightName} ${state.score.house}
              &nbsp; | &nbsp; <strong>DOGs:</strong> ${dogsLine}
            </p>
            <p><strong>ANTE:</strong> ${state.ante || "(none)"}</p>
          </div>
          <div class="header-controls">
            <p><strong>LIVE:</strong> ${state.live ? "ON" : "OFF"}</p>
            <div class="button-row">
              <button type="button" id="restartNow">Start Over</button>
              ${state.live ? `<button type="button" id="disableLive">Disable LIVE (House Override)</button>` : ""}
            </div>
            <p class="subtle-text">${state.live ? "Stats will come from API later." : "House enters period stats manually."}</p>
          </div>
        </div>
      </section>
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
    else screenHTML = `<section class="empty-panel">Unknown screen: ${state.screen}</section>`;

    gameEl.innerHTML = `<div class="game-stack">${headerHTML}${screenHTML}</div>`;

    const screenChanged = state.screen !== _lastScreen;
    _lastScreen = state.screen;

    try { wireHandlers(); } catch (e) { console.error("wireHandlers failed", e); }
    if (screenChanged && !_pendingScrollTargetId) setPendingScrollTarget(chooseScrollTargetForScreen(state.screen));
    saveState();
    try { performPendingScroll(); } catch (e) { console.warn("performPendingScroll failed", e); }
  };

  window.renderSideBySideQuestion = function renderSideBySideQuestion({ title, questionText, leftName, rightName, leftSectionHTML, rightSectionHTML, backHTML = "", continueHTML = "" }) {
    return `
      <section class="screen-panel">
        <h3 class="screen-title">${title}</h3>
        <p class="question-text"><strong>${questionText}</strong></p>

        <div class="split-layout">
          <div class="split-col">
            <div class="side-title">${leftName}</div>
            ${leftSectionHTML}
          </div>
          <div class="split-divider"></div>
          <div class="split-col">
            <div class="side-title">${rightName}</div>
            ${rightSectionHTML}
          </div>
        </div>

        <div class="action-row">
          ${backHTML}
          ${continueHTML}
        </div>
      </section>
    `;
  };

  window.sealedYesNoSection = function sealedYesNoSection({ idPrefix, lockedSelf, lockedOther, requireOtherLock, disabledAll = false, helperText = "Player locks first." }) {
    if (disabledAll) return `<div class="scratched-badge">🦴 Scratched</div>`;
    if (lockedSelf) return `<div class="locked-badge">🔒 Locked</div>`;

    const disabled = (requireOtherLock && !lockedOther) ? "disabled" : "";
    const helper = (requireOtherLock && !lockedOther)
      ? `<div class="helper-text">${helperText}</div>`
      : "";

    return `
      <div class="choice-row">
        <button type="button" id="${idPrefix}_Yes" ${disabled}>Yes</button>
        <button type="button" id="${idPrefix}_No" ${disabled}>No</button>
      </div>
      ${helper}
    `;
  };

  window.renderPreQ2 = function renderPreQ2() {
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

    const backHTML = `<button type="button" id="backToQ1">Back</button>`;
    const canContinue = q2.lockedPlayer && q2.lockedHouse;
    const continueHTML = `
      <button type="button" id="toP1" ${canContinue ? "" : "disabled"}>Start Period 1</button>
      ${canContinue ? "" : `<div class="helper-text">Lock both answers to start Period 1.</div>`}
    `;

    return renderSideBySideQuestion({
      title: "Pre-Game Q2 (1 pt)",
      questionText: "Will there be a power-play goal in the game?",
      leftName: state.player1,
      rightName: rightSideName(),
      leftSectionHTML: playerSection,
      rightSectionHTML: houseSection,
      backHTML,
      continueHTML
    });
  };

  window.renderPeriod = function renderPeriod(key, opts = {}) {
    const p = state.periods[key];
    const picks = p.picks;
    const r = p.results;
    const isP2 = key === "p2";
    const isP3 = key === "p3";
    const isVS = state.mode === "VS";
    const rightName = rightSideName();
    const allLockedPlayerPicks = picks.q1_goal.lockedPlayer && picks.q2_penalty.lockedPlayer && picks.q3_both5sog.lockedPlayer;
    const maxScratches = isP3 ? 2 : (isP2 ? 1 : 0);

    p.dogSpend = p.dogSpend ?? {};
    if (!isVS) {
      p.dogSpend.scratchedList = p.dogSpend.scratchedList ?? (p.dogSpend.scratched ? [p.dogSpend.scratched] : []);
    } else {
      p.dogSpend.player = p.dogSpend.player ?? { used: false, scratchedList: [], voided: false };
      p.dogSpend.house = p.dogSpend.house ?? { used: false, scratchedList: [], voided: false };
      if (Array.isArray(p.dogSpend.scratchedList) && p.dogSpend.scratchedList.length && p.dogSpend.player.scratchedList.length === 0) {
        p.dogSpend.player.scratchedList = [...p.dogSpend.scratchedList];
        delete p.dogSpend.scratchedList;
      }
    }

    const anyLockedBySide = (side) =>
      picks.q1_goal[`locked${side === "player" ? "Player" : "House"}`] ||
      picks.q2_penalty[`locked${side === "player" ? "Player" : "House"}`] ||
      picks.q3_both5sog[`locked${side === "player" ? "Player" : "House"}`];

    const scratchedList = (side) => !isVS ? (p.dogSpend.scratchedList ?? []) : ((side === "player" ? p.dogSpend.player.scratchedList : p.dogSpend.house.scratchedList) ?? []);
    const isScratchedBy = (side, qid) => scratchedList(side).includes(qid);
    const isScratchedAgainst = (side, qid) => isVS ? isScratchedBy(side === "player" ? "house" : "player", qid) : (side === "house" ? isScratchedBy("player", qid) : false);
    const dogsCount = (side) => !isVS ? (state.dogs ?? 0) : (side === "player" ? (state.dogs.player ?? 0) : (state.dogs.house ?? 0));

    const scratchButtonsHTML = (side) => {
      const sideLabel = side === "player" ? state.player1 : rightName;
      const canSpend = (isP2 || isP3) && dogsCount(side) > 0 && !p.lockedResults && !anyLockedBySide(side) && (side === "player" || allLockedPlayerPicks) && !(isVS ? p.dogSpend[side].voided : p.dogSpend.voided) && (scratchedList(side).length < maxScratches);
      if (!canSpend) return "";
      const prefix = isVS ? `${side}_` : "";
      const scratchesNow = scratchedList(side).length;
      const tileId = isVS ? `dogsSpendTile_${side}` : "dogsSpendTile";
      return `
        <section id="${tileId}" class="dog-tile">
          <div class="tile-title">${sideLabel}: Spend DOGs 🐶</div>
          <div class="subtle-text">
            Spend <strong>1 DOG</strong> to scratch <strong>one opponent question</strong> this period.
            ${isP3 ? `You may scratch up to <strong>2</strong> questions in Period 3.` : `Period 2 allows <strong>1</strong> scratch.`}
            Must choose before ${sideLabel} locks any picks.
          </div>
          ${isP3 ? `<div class="note-text">Once Period 3 starts, leftover DOGs become void for that player.</div>` : ""}
          <div class="choice-row">
            ${isScratchedBy(side,"q1_goal") ? "" : (`<button type="button" id="scratch_${prefix}q1">Scratch Q1 (Goal?)</button>`)}
            ${isScratchedBy(side,"q2_penalty") ? "" : (`<button type="button" id="scratch_${prefix}q2">Scratch Q2 (Penalty?)</button>`)}
            ${isScratchedBy(side,"q3_both5sog") ? "" : (`<button type="button" id="scratch_${prefix}q3">Scratch Q3 (Both 5+ SOG?)</button>`)}
          </div>
          <div class="note-text">DOGs: ${renderDogs(dogsCount(side))} &nbsp; | &nbsp; Scratches: ${scratchesNow}/${maxScratches}</div>
        </section>
      `;
    };

    const scratchPanel = (isP2 || isP3) ? (isVS ? `${scratchButtonsHTML("player")}${scratchButtonsHTML("house")}` : scratchButtonsHTML("player")) : "";

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
        lockedOther: allLockedPlayerPicks,
        requireOtherLock: true,
        helperText: `${state.player1} locks Q1–Q3 first.`,
        disabledAll: (isP2 || isP3) && isScratchedAgainst("house", qid)
      });
      const ready = pickState.lockedPlayer && pickState.lockedHouse;
      const scratchBadges = (isP2 || isP3) ? `
        <div class="note-text">
          ${isVS && isScratchedBy("player", qid) ? `<span>${state.player1} scratched ${prettyQ(qid)} ✅</span>` : ``}
          ${isVS && isScratchedBy("house", qid) ? `<span>${rightName} scratched ${prettyQ(qid)} ✅</span>` : ``}
          ${!isVS && isScratchedBy("player", qid) ? `<span>Scratched (House disabled) ✅</span>` : ``}
        </div>` : "";
      return `
        <section class="question-card">
          <div class="question-card-title">${label}</div>
          <div class="split-layout">
            <div class="split-col">
              <div class="side-title">${state.player1}</div>
              ${playerSection}
            </div>
            <div class="split-divider"></div>
            <div class="split-col">
              <div class="side-title">${rightName}</div>
              ${houseSection}
            </div>
          </div>
          ${ready ? `<div class="ready-badge">Ready ✅</div>` : ""}
          ${scratchBadges}
        </section>
      `;
    };

    const allLocked = picks.q1_goal.lockedPlayer && picks.q1_goal.lockedHouse && picks.q2_penalty.lockedPlayer && picks.q2_penalty.lockedHouse && picks.q3_both5sog.lockedPlayer && picks.q3_both5sog.lockedHouse;
    const resultsNote = state.live ? `<div class="note-text">LIVE is ON (API later). House can still enter results now.</div>` : `<div class="note-text">House enters end-of-period totals.</div>`;

    const resultsPanel = allLocked ? `
      <section class="results-panel">
        <div class="section-title">Period ${p.n} Results (${rightName})</div>
        ${resultsNote}
        ${p.lockedResults ? `
          <div class="locked-badge">🔒 Period ${p.n} results locked</div>
        ` : `
          <div class="results-grid">
            <div></div><div class="section-title">Y</div><div class="section-title">N</div>
            <div class="section-title">Goals?</div>
            <label class="inline-row"><input type="checkbox" id="${key}_r_goal_y" ${r.goal === "Yes" ? "checked" : ""} /><span>Yes</span></label>
            <label class="inline-row"><input type="checkbox" id="${key}_r_goal_n" ${r.goal === "No" ? "checked" : ""} /><span>No</span></label>
            <div class="section-title">Penalty?</div>
            <label class="inline-row"><input type="checkbox" id="${key}_r_pen_y" ${r.penalty === "Yes" ? "checked" : ""} /><span>Yes</span></label>
            <label class="inline-row"><input type="checkbox" id="${key}_r_pen_n" ${r.penalty === "No" ? "checked" : ""} /><span>No</span></label>
          </div>
          <div class="section-title" style="margin-top:12px;">Period ${p.n} SOG</div>
          <div class="sog-grid">
            <div>
              <div class="section-title">${state.away}</div>
              <input id="${key}_r_sog_away" type="number" min="0" inputmode="numeric" value="${r.endSogAway ?? ""}" placeholder="End of period total SOG" />
            </div>
            <div>
              <div class="section-title">${state.home}</div>
              <input id="${key}_r_sog_home" type="number" min="0" inputmode="numeric" value="${r.endSogHome ?? ""}" placeholder="End of period total SOG" />
            </div>
          </div>
          <div class="action-row"><button type="button" id="${key}_lockResults">Lock Period ${p.n} Results</button></div>
          <div class="note-text">Start SOG this period: Away ${state.sog.start.away ?? 0}, Home ${state.sog.start.home ?? 0}.</div>
        `}
        ${p.computed ? renderPeriodComputedSummary(key) : ""}
      </section>
    ` : `<div class="helper-text">Lock all picks to enter results.</div>`;

    const backBtnId = key === "p1" ? "backToQ2" : (key === "p2" ? "backToP1" : "backToP2");
    const continueId = key === "p1" ? "toP2" : (key === "p2" ? "toP3" : "toGoodBoy");
    const continueLabel = key === "p1" ? "Continue to Period 2" : (key === "p2" ? "Continue to Period 3" : "Continue");
    const continueHTML = (p.computed && p.lockedResults) ? `<button type="button" id="${continueId}">${continueLabel}</button>` : "";
    const p3Banner = opts.p3Mode ? `<section class="banner-note"><strong>Period 3 note:</strong> Spend DOGs <em>before</em> locking your first pick. Once you lock any Period 3 pick, your leftover DOGs become <strong>void</strong>. If you win Period 3, you earn <strong>Good Boy!</strong></section>` : "";

    return `
      <section class="screen-panel">
        <h3 class="screen-title">Period ${p.n} (3 pts possible)</h3>
        <div class="period-stack">
          ${scratchPanel}
          ${p3Banner}
          ${qCard("Q1: Will there be a goal this period?", picks.q1_goal, `${key}q1`, "q1_goal")}
          ${qCard("Q2: Will there be a penalty this period?", picks.q2_penalty, `${key}q2`, "q2_penalty")}
          ${qCard("Q3: Will each team record at least 5 shots on goal this period?", picks.q3_both5sog, `${key}q3`, "q3_both5sog")}
          ${resultsPanel}
        </div>
        <div class="action-row">
          <button type="button" id="${backBtnId}">Back</button>
          ${continueHTML}
        </div>
      </section>
    `;
  };

  window.renderPeriodComputedSummary = function renderPeriodComputedSummary(key) {
    const p = state.periods[key];
    const c = p.computed;
    if (!c) return "";
    const dot = (isCorrect) => (isCorrect ? "🟢" : "⚪️");
    const rowDots = (side) => `${dot(!!c.correct?.q1?.[side])}${dot(!!c.correct?.q2?.[side])}${dot(!!c.correct?.q3?.[side])}`;
    const winnerText = c.periodWinner === "player" ? `${state.player1} wins Period ${p.n} ✅` : c.periodWinner === "house" ? `${rightSideName()} wins Period ${p.n} ✅` : `Period ${p.n} is a tie (no winner)`;
    const scratchedList = p.dogSpend?.scratchedList ?? [];
    const scratchedLine = scratchedList.length ? `<div class="note-text"><strong>Scratched:</strong> ${scratchedList.map(prettyQ).join(", ")} (House disabled)</div>` : "";
    return `
      <section class="summary-panel">
        <div class="section-title">Scoring Summary</div>
        ${scratchedLine}
        <div class="summary-row"><div style="min-width:140px; font-weight:700;">${state.player1} correct:</div><div style="min-width:70px;">${c.playerCorrect}/3</div><div>${rowDots("player")}</div></div>
        <div class="summary-row"><div style="min-width:140px; font-weight:700;">${rightSideName()} correct:</div><div style="min-width:70px;">${c.houseCorrect}/3</div><div>${rowDots("house")}</div></div>
        <hr class="summary-sep" />
        <div><strong>Period Winner:</strong> ${winnerText}</div>
        ${renderDogsDeltaLine(key)}
      </section>
    `;
  };

  window.renderGoodBoy = function renderGoodBoy() {
    const gb = state.goodBoy;
    const isVS = state.mode === "VS";
    const ownerName = (isVS && gb.owner === "house") ? state.player2 : state.player1;
    const opponentName = (isVS && gb.owner === "house") ? state.player1 : state.player2;
    const mapping = `
      <section class="info-card">
        <div class="section-title">🦴 D6 Mapping</div>
        <div>1 = P1 Q1 (Goal?)</div>
        <div>2 = P1 Q2 (Penalty?)</div>
        <div>3 = P1 Q3 (Both 5+ SOG?)</div>
        <div>4 = P2 Q1 (Goal?)</div>
        <div>5 = P2 Q2 (Penalty?)</div>
        <div>6 = P2 Q3 (Both 5+ SOG?)</div>
      </section>
    `;
    const status = gb.resolved ? `
      <section class="summary-panel">
        <div class="section-title">FETCH!! Result</div>
        <div>Roll: <strong>${gb.roll}</strong> → Target: <strong>${gb.target}</strong></div>
        <div>Effect: ${gb.housePointRemoved ? `<strong>${opponentName} -1 point ✅</strong>` : `<strong>No effect</strong>`}</div>
      </section>
    ` : "";
    return `
      <section class="screen-panel">
        <h3 class="screen-title">Good Boy! 🐶 — FETCH!!</h3>
        <p class="question-text"><strong>${ownerName}</strong> won Period 3, so they earned a <strong>Good Boy</strong>. Roll 🎲 to target one of <strong>${opponentName}</strong>’s Period 1–2 questions. If <strong>${opponentName}</strong> was correct on that target, they lose <strong>1 point</strong>.</p>
        <div class="choice-row">
          <button type="button" id="gbRoll" ${gb.resolved ? "disabled" : ""}>FETCH!! (Roll 🎲)</button>
          <label class="inline-row">
            <span>Manual roll:</span>
            <input id="gbManual" type="number" min="1" max="6" inputmode="numeric" style="width:90px;" ${gb.resolved ? "disabled" : ""}/>
            <button type="button" id="gbSetManual" ${gb.resolved ? "disabled" : ""}>Set</button>
          </label>
        </div>
        ${mapping}
        ${status}
        <div class="action-row">
          <button type="button" id="backToP3">Back</button>
          <button type="button" id="toPostgame">Continue</button>
        </div>
      </section>
    `;
  };

  window.renderRegulation = function renderRegulation() {
    ensureRegulationState();
    const reg = state.regulation;
    const lockedView = reg.locked ? `
      <div class="locked-badge">🔒 Regulation locked</div>
      <div><strong>Regulation score:</strong> ${state.away} ${reg.awayGoals} — ${state.home} ${reg.homeGoals}</div>
      <div><strong>PP goal:</strong> ${reg.ppGoal}</div>
      <div class="action-row">${reg.awayGoals === reg.homeGoals ? `<button type="button" id="toOT">BOTD → OT</button>` : `<button type="button" id="awardPregame">Award Pre-Game Points</button>`}</div>
    ` : `
      <p class="question-text">Enter the score at the <strong>end of Period 3</strong> (REGULATION). If tied, BOTD goes to OT and we’ll score pre-game questions after the real game ends.</p>
      <div class="sog-grid">
        <div>
          <div class="section-title">${state.away} (Away)</div>
          <input id="regAwayGoals" type="number" min="0" inputmode="numeric" value="${(reg.draftAwayGoals ?? reg.awayGoals) ?? ""}" placeholder="Reg goals" />
        </div>
        <div>
          <div class="section-title">${state.home} (Home)</div>
          <input id="regHomeGoals" type="number" min="0" inputmode="numeric" value="${(reg.draftHomeGoals ?? reg.homeGoals) ?? ""}" placeholder="Reg goals" />
        </div>
      </div>
      <div class="section-title" style="margin-top:12px;">Was there a power-play goal in the game?</div>
      <div class="choice-row">
        <button type="button" id="regPPYes">Yes</button>
        <button type="button" id="regPPNo">No</button>
        <div class="subtle-text">Selected: <strong>${reg.ppGoal ?? "—"}</strong></div>
      </div>
      <div class="action-row"><button type="button" id="lockRegulation">Lock Regulation</button></div>
    `;
    return `
      <section class="screen-panel">
        <h3 class="screen-title">Regulation Result (${rightSideName()})</h3>
        ${lockedView}
        <div class="action-row"><button type="button" id="backFromRegulation">Back</button></div>
      </section>
    `;
  };

  window.renderOT = function renderOT() {
    ensureRegulationState();
    const ot = state.ot;
    const lockedP = ot.picks.lockedPlayer;
    const lockedH = ot.picks.lockedHouse;
    const houseName = rightSideName();
    const playerSection = lockedP ? `<div class="locked-badge">🔒 Locked</div>` : `<div class="choice-row"><button type="button" id="ot_playerYes">Yes</button><button type="button" id="ot_playerNo">No</button></div>`;
    const houseSection = lockedH ? `<div class="locked-badge">🔒 Locked</div>` : `<div class="choice-row"><button type="button" id="ot_houseYes" ${!lockedP ? "disabled" : ""}>Yes</button><button type="button" id="ot_houseNo" ${!lockedP ? "disabled" : ""}>No</button></div>${!lockedP ? `<div class="helper-text">Player locks first.</div>` : ""}`;
    const picksReady = lockedP && lockedH;
    const truthPanel = picksReady ? `
      <section class="results-panel">
        <div class="section-title">OT Outcome (${houseName})</div>
        ${ot.lockedTruth ? `<div class="locked-badge">🔒 OT outcome locked: ${ot.truth}</div>` : `<div class="choice-row"><button type="button" id="ot_truthYes">Yes (ended in OT)</button><button type="button" id="ot_truthNo">No (went to SO)</button></div><div class="subtle-text">Selected: <strong>${ot.truth ?? "—"}</strong></div><div class="action-row"><button type="button" id="ot_lockTruth">Lock OT Outcome</button></div>`}
        ${ot.lockedTruth && ot.truth === "Yes" ? `<div class="summary-panel"><div class="section-title">Final Winner (${houseName})</div><div class="choice-row"><button type="button" id="finalWinnerAway">${state.away}</button><button type="button" id="finalWinnerHome">${state.home}</button></div><div class="subtle-text">Selected: <strong>${state.final.winner ?? "—"}</strong></div><div class="action-row"><button type="button" id="finalizeFromOT" ${state.final.winner ? "" : "disabled"}>Finalize Game</button></div></div>` : ""}
        ${ot.lockedTruth && ot.truth === "No" ? `<div class="action-row"><button type="button" id="toSO">Continue to Shootout</button></div>` : ""}
      </section>` : `<div class="helper-text">Lock both picks to enter OT outcome.</div>`;
    return `
      <section class="screen-panel">
        <h3 class="screen-title">BOTD Overtime (1 pt)</h3>
        <p class="question-text"><strong>Question:</strong> Will the game end in OT?</p>
        <div class="split-layout">
          <div class="split-col"><div class="side-title">${state.player1}</div>${playerSection}<div class="subtle-text">Selected: <strong>${yn(ot.picks.player)}</strong></div></div>
          <div class="split-divider"></div>
          <div class="split-col"><div class="side-title">${houseName}</div>${houseSection}<div class="subtle-text">Selected: <strong>${yn(ot.picks.house)}</strong></div></div>
        </div>
        ${truthPanel}
        <div class="action-row"><button type="button" id="backToRegulation">Back</button></div>
      </section>
    `;
  };

  window.renderSO = function renderSO() {
    ensureRegulationState();
    const so = state.so;
    const lockedP = so.picks.lockedPlayer;
    const lockedH = so.picks.lockedHouse;
    const houseName = rightSideName();
    const playerSection = lockedP ? `<div class="locked-badge">🔒 Locked</div>` : `<div class="choice-row"><button type="button" id="so_playerYes">Yes</button><button type="button" id="so_playerNo">No</button></div>`;
    const houseSection = lockedH ? `<div class="locked-badge">🔒 Locked</div>` : `<div class="choice-row"><button type="button" id="so_houseYes" ${!lockedP ? "disabled" : ""}>Yes</button><button type="button" id="so_houseNo" ${!lockedP ? "disabled" : ""}>No</button></div>${!lockedP ? `<div class="helper-text">Player locks first.</div>` : ""}`;
    const picksReady = lockedP && lockedH;
    const truthPanel = picksReady ? `
      <section class="results-panel">
        <div class="section-title">Shootout Outcome (${houseName})</div>
        ${so.lockedTruth ? `<div class="locked-badge">🔒 Shootout outcome locked: ${so.truth}</div>` : `<div class="choice-row"><button type="button" id="so_truthYes">Yes (longer than 3 rounds)</button><button type="button" id="so_truthNo">No (3 rounds or fewer)</button></div><div class="subtle-text">Selected: <strong>${so.truth ?? "—"}</strong></div><div class="action-row"><button type="button" id="so_lockTruth">Lock Shootout Outcome</button></div>`}
        ${so.lockedTruth ? `<div class="summary-panel"><div class="section-title">Final Winner (${houseName})</div><div class="choice-row"><button type="button" id="finalWinnerAwaySO">${state.away}</button><button type="button" id="finalWinnerHomeSO">${state.home}</button></div><div class="subtle-text">Selected: <strong>${state.final.winner ?? "—"}</strong></div><div class="action-row"><button type="button" id="finalizeFromSO" ${state.final.winner ? "" : "disabled"}>Finalize Game</button></div></div>` : ""}
      </section>` : `<div class="helper-text">Lock both picks to enter shootout outcome.</div>`;
    return `
      <section class="screen-panel">
        <h3 class="screen-title">BOTD Shootout (1 pt)</h3>
        <p class="question-text"><strong>Question:</strong> Will the shootout last longer than 3 rounds?</p>
        <div class="split-layout">
          <div class="split-col"><div class="side-title">${state.player1}</div>${playerSection}<div class="subtle-text">Selected: <strong>${yn(so.picks.player)}</strong></div></div>
          <div class="split-divider"></div>
          <div class="split-col"><div class="side-title">${houseName}</div>${houseSection}<div class="subtle-text">Selected: <strong>${yn(so.picks.house)}</strong></div></div>
        </div>
        ${truthPanel}
        <div class="action-row"><button type="button" id="backToOT">Back</button></div>
      </section>
    `;
  };

  window.renderTwoColRow = function renderTwoColRow({ leftLabel, leftVal, leftMark, rightVal, rightMark }) {
    return `
      <div class="two-col-grid compact">
        <div class="value-card"><div class="value-card-label">${leftLabel}</div><div class="value-card-value"><strong>${leftVal}</strong> &nbsp; ${leftMark}</div></div>
        <div class="value-card"><div class="value-card-label">${rightSideName()}</div><div class="value-card-value"><strong>${rightVal}</strong> &nbsp; ${rightMark}</div></div>
      </div>
    `;
  };

  window.renderPeriodSection = function renderPeriodSection(periodKey, title) {
    const p = state.periods?.[periodKey];
    if (!p?.computed) return `<section class="period-section"><h4>${title}</h4><div class="subtle-text">(No period results found.)</div></section>`;
    const q1 = periodQCorrect(periodKey, "q1");
    const q2 = periodQCorrect(periodKey, "q2");
    const q3 = periodQCorrect(periodKey, "q3");
    const q1Scr = isScratched(periodKey, "q1_goal");
    const q2Scr = isScratched(periodKey, "q2_penalty");
    const q3Scr = isScratched(periodKey, "q3_both5sog");
    const scrLine = (s) => s ? ` <span class="subtle-text">(SCRATCHED 🐶)</span>` : "";
    const picks = p.picks;
    const p1 = yn(picks.q1_goal.player), h1 = q1Scr ? "—" : yn(picks.q1_goal.house);
    const p2 = yn(picks.q2_penalty.player), h2 = q2Scr ? "—" : yn(picks.q2_penalty.house);
    const p3 = yn(picks.q3_both5sog.player), h3 = q3Scr ? "—" : yn(picks.q3_both5sog.house);
    const winnerText = p.computed.periodWinner === "player" ? state.player1 : p.computed.periodWinner === "house" ? rightSideName() : "Tie";
    return `
      <section class="period-section">
        <h4>${title}</h4>
        <div class="summary-stack">
          <div><div class="section-title">Q1: Will there be a goal this period?${scrLine(q1Scr)}</div>${renderTwoColRow({ leftLabel: state.player1, leftVal: p1, leftMark: mark(q1.player), rightVal: h1, rightMark: q1Scr ? "❌" : mark(q1.house) })}</div>
          <div><div class="section-title">Q2: Will there be a penalty this period?${scrLine(q2Scr)}</div>${renderTwoColRow({ leftLabel: state.player1, leftVal: p2, leftMark: mark(q2.player), rightVal: h2, rightMark: q2Scr ? "❌" : mark(q2.house) })}</div>
          <div><div class="section-title">Q3: Will each team record at least 5 SOG this period?${scrLine(q3Scr)}</div><div class="subtle-text">Truth: <strong>${yn(q3.truth)}</strong></div>${renderTwoColRow({ leftLabel: state.player1, leftVal: p3, leftMark: mark(q3.player), rightVal: h3, rightMark: q3Scr ? "❌" : mark(q3.house) })}</div>
          <div><strong>Period ${p.n} winner:</strong> ${winnerText}</div>
          ${renderDogsLinePostgame(periodKey)}
        </div>
      </section>
    `;
  };

  window.renderPostgameSummary = function renderPostgameSummary() {
    ensureRegulationState();
    let winner = state.final?.winner;
    if (!winner && state.regulation?.locked) {
      if (state.regulation.awayGoals > state.regulation.homeGoals) winner = "Away";
      else if (state.regulation.homeGoals > state.regulation.awayGoals) winner = "Home";
    }
    const winnerTeam = winner === "Away" ? state.away : winner === "Home" ? state.home : null;
    const playerWins = state.score.player > state.score.house;
    const houseWins = state.score.house > state.score.player;
    const headline = playerWins ? `${state.player1} WINS!!!!!` : houseWins ? `${rightSideName()} WINS!!!!!` : `It’s a TIE!!!!!`;
    const preQ1 = state.pre?.q1, preQ2 = state.pre?.q2;
    const preQ1Truth = winner;
    const preQ1PlayerOk = preQ1Truth ? (preQ1?.player === preQ1Truth) : false;
    const preQ1HouseOk = preQ1Truth ? (preQ1?.house === preQ1Truth) : false;
    const ppTruth = state.regulation?.ppGoal;
    const preQ2PlayerOk = (ppTruth === "Yes" || ppTruth === "No") ? (preQ2?.player === ppTruth) : false;
    const preQ2HouseOk = (ppTruth === "Yes" || ppTruth === "No") ? (preQ2?.house === ppTruth) : false;
    const endedIn = state.final?.endedIn ? state.final.endedIn : (state.regulation?.locked && state.regulation.awayGoals !== state.regulation.homeGoals ? "REG" : null);
    const otPlayed = state.ot?.lockedTruth;
    const soPlayed = state.so?.lockedTruth;
    const otPlayerOk = otPlayed ? (state.ot.picks.player === state.ot.truth) : false;
    const otHouseOk = otPlayed ? (state.ot.picks.house === state.ot.truth) : false;
    const soPlayerOk = soPlayed ? (state.so.picks.player === state.so.truth) : false;
    const soHouseOk = soPlayed ? (state.so.picks.house === state.so.truth) : false;
    const goodBoyLine = state.goodBoy?.earned ? `<section class="banner-note"><strong>Good Boy:</strong> ${state.goodBoy.resolved ? `Roll ${state.goodBoy.roll} → ${state.goodBoy.target}. ${state.goodBoy.housePointRemoved ? `${rightSideName()} -1 ✅` : "No effect."}` : `Earned but not resolved.`}</section>` : "";
    return `
      <section class="screen-panel">
        <div class="postgame-header">
          <div class="postgame-kicker">BEWARE OF THE DOG</div>
          <div class="section-title">Postgame Summary</div>
          <div class="postgame-headline">${headline}</div>
          <div><strong>Final points:</strong> ${state.player1} ${state.score.player} — ${rightSideName()} ${state.score.house}</div>
          <div class="subtle-text"><strong>Real game winner:</strong> ${winnerTeam ?? "—"} &nbsp; | &nbsp; <strong>Ended in:</strong> ${endedIn ?? "—"}</div>
        </div>
        ${goodBoyLine}
        <section class="period-section">
          <h4>PreGame</h4>
          <div class="summary-stack">
            <div><div class="section-title">Q1: Who will win?</div><div class="subtle-text">Truth: <strong>${winnerTeam ?? "—"}</strong></div>${renderTwoColRow({ leftLabel: state.player1, leftVal: pickTextPreQ1(preQ1?.player), leftMark: preQ1Truth ? mark(preQ1PlayerOk) : "—", rightVal: pickTextPreQ1(preQ1?.house), rightMark: preQ1Truth ? mark(preQ1HouseOk) : "—" })}</div>
            <div><div class="section-title">Q2: Will there be a power-play goal?</div><div class="subtle-text">Truth: <strong>${ppTruth ?? "—"}</strong></div>${renderTwoColRow({ leftLabel: state.player1, leftVal: yn(preQ2?.player), leftMark: (ppTruth === "Yes" || ppTruth === "No") ? mark(preQ2PlayerOk) : "—", rightVal: yn(preQ2?.house), rightMark: (ppTruth === "Yes" || ppTruth === "No") ? mark(preQ2HouseOk) : "—" })}</div>
          </div>
        </section>
        ${renderPeriodSection("p1", "Period 1")}
        ${renderPeriodSection("p2", "Period 2")}
        ${renderPeriodSection("p3", "Period 3")}
        ${otPlayed ? `<section class="period-section"><h4>Overtime (1 pt)</h4><div class="section-title">Q: Will the game end in OT?</div><div class="subtle-text">Truth: <strong>${state.ot.truth}</strong></div>${renderTwoColRow({ leftLabel: state.player1, leftVal: yn(state.ot.picks.player), leftMark: mark(otPlayerOk), rightVal: yn(state.ot.picks.house), rightMark: mark(otHouseOk) })}</section>` : ""}
        ${soPlayed ? `<section class="period-section"><h4>Shootout (1 pt)</h4><div class="section-title">Q: Will the shootout last longer than 3 rounds?</div><div class="subtle-text">Truth: <strong>${state.so.truth}</strong></div>${renderTwoColRow({ leftLabel: state.player1, leftVal: yn(state.so.picks.player), leftMark: mark(soPlayerOk), rightVal: yn(state.so.picks.house), rightMark: mark(soHouseOk) })}</section>` : ""}
        <div class="action-row"><button type="button" id="restartGame">New Game</button></div>
      </section>
    `;
  };

  if (typeof render === "function") {
    try { render(); } catch (e) { console.error("game-ui-patch render failed", e); }
  }
})();
