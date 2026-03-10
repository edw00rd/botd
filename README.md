# botd
# Beware of the Dog (Cave Canem)

**Beware of the Dog (BOTD)** is a hockey-themed, head-to-head prediction game you play while watching a real hockey game.  
Players make quick yes/no predictions each period, score points based on correctness, and use **DOGs 🐶** to “scratch” (disable) an opponent’s question. The goal is simple: **score more points than your opponent by the end of the game.**

This project is a lightweight web app designed to run in a browser (perfect for a couch game night).

---

## What You Need

- A real hockey game to watch (NHL, college, beer league… anything with a scoreboard)
- 2 players (or 1 player vs the “House” scorekeeper)
- A fun **ANTE** (optional): chores, push-ups, snacks, bragging rights, etc.
- **Optional:** a **D6 (six-sided die)** for the **Good Boy (FETCH!!)** roll (you can also use any dice app or RNG)

---

## Game Modes

### HOUSE Mode

- **Player 1** plays against the **House** (a scorekeeper / referee).
- The House also makes picks and enters the end-of-period results.
- There is **one DOG pool** that belongs to Player 1, if Player wins they receive
  a dog, if house wins a dog is removed. (legacy BOTD rules, very kid friendly).

### VS Mode

- **Player 1 vs Player 2** (fully symmetric).
- Each player has their **own DOG pool**.
- Either player can win a dog and use it to scratch/burry questions (as long as they haven’t locked any picks yet that period).

---

## Core Rules (How Points Work)

### Pre-Game (2 points total)

Before the puck drops, both sides answer:

1) **Who will win the game?** (1 point)  
2) **Will there be a power-play goal in the game?** (1 point)

**Important:** These points are awarded after the real game winner and PP goal outcome are known  
(after Regulation, or after OT/SO if the real game goes beyond regulation).

---

## Period Play (3 points per period)

Each period has **three questions**. Both sides answer all three and lock them in.

### Period Questions

1) **Goal this period?** (Yes/No)  
2) **Penalty this period?** (Yes/No)  
3) **Will each team record at least 5 shots on goal this period?** (Yes/No)

### Locking / Turn Structure

- Picks are made and locked before results are entered.
- The period results are then entered using:
  - **Goal?** Yes/No  
  - **Penalty?** Yes/No  
  - **End-of-period total SOG** for Away and Home (totals, not just that period)

The app calculates and validates the truth of Question 3 using the change in total SOG for each team.

---

## DOGs 🐶 (Burry Mechanic)

DOGs are a limited resource you can spend to scratch/burry an opponent’s question for that period.

### What burrying a question Does

- Spend **1 DOG** to scratch **one opponent question** (Q1, Q2, or Q3) for the current period.
- A scratched or "burried" question is marked with **🦴** and is no longer available for the opposing
  player to score a point on that question.

### When You Can Scratch

- **Period 2:** up to **1 scratch**   "SICK 'EM BOY!"
- **Period 3:** up to **2 scratches**  "RELEASE THE HOUNDS!"
- You must spend your dog(s) **before** making any picks that period.

### DOG Gains/Losses (End of Period 1 & 2)

- DOGs are adjusted based on the period winner:
  - In HOUSE mode, Player 1’s DOG pool goes **up/down** based on who won the period.
  - In VS mode, the **winner** of the period gains **+1 DOG**.

### Period 3 DOG Rule

Once Period 3 begins:

- You can spend DOGs at the start of P3,
- but **as soon as you lock your first P3 pick**, any leftover DOGs for that player become **void**.

---

## Good Boy (FETCH!!) 🦴🐶

Winning Period 3 can earn a **Good Boy** dog.

> **Tip:** You can roll a physical **D6**, use a dice app, or use any random number generator from 1–6.

### How It Works

- If you win Period 3, you earn a special dog called the **Good Boy**.
- You roll a **D6** which targets one of your opponent’s Period 1–2 questions:
  - 1 = P1 Q1, 2 = P1 Q2, 3 = P1 Q3  
  - 4 = P2 Q1, 5 = P2 Q2, 6 = P2 Q3
- If your opponent was correct on the targeted question, they lose **1 point**.
- If they were incorrect, nothing happens.

---

## Regulation / OT / Shootout (BOTD Endgame)

After Period 3:

1) Enter the **regulation score** (Away goals, Home goals)  
2) Enter whether there was a **power-play goal** (Yes/No)

### If the Real Game is NOT tied after Regulation

- BOTD awards pre-game points immediately and ends the game.

### If the Real Game IS tied after Regulation

BOTD continues with:

- **OT question (1 point):** Will the game end in OT?
- If it goes to a shootout:
  - **SO question (1 point):** Will the shootout last longer than 3 rounds?

After the real game ends, BOTD awards:

- OT / SO points (as applicable)
- Pre-game points
- Then displays the Postgame Summary and final BOTD winner.

---

## How to Play (Quick Start)

1) Open the setup page  
2) Enter:
   - Away team, Home team
   - Mode (HOUSE or VS)
   - Player names
   - Optional ANTE
3) Click **Start Game**
4) Complete Pre-Game Q1 and Q2 (both sides lock in)
5) For each period:
   - (If you have DOGs and it’s P2 or P3) burry questions first
   - Lock answers for Q1–Q3
   - Enter period results (Goals?, Penalty?, and end-of-period SOG totals)
   - Lock results, continue to next period
6) After Period 3, follow the prompts for:
   - Good Boy (if earned)
   - Regulation result
   - OT/SO (if needed)
7) Read the **Postgame Summary** and crown the BOTD champion.

---

## Local Storage

BOTD stores the current game state in your browser using `localStorage`.  
If something gets weird or you want to fully reset:

- Use **Start Over** in the UI, or
- Clear site data in your browser.

---

## Testing / “Bomb-Proof” Mode

This repo includes Playwright end-to-end tests that validate the full game flow in:

- HOUSE mode
- VS mode
- randomized fuzz runs (deterministic seed)

Check the GitHub **Actions** tab for E2E test runs and downloadable Playwright reports.

---

## License

This project is licensed under the MIT License. You are free to use, modify, and distribute this software in accordance with the terms of the MIT License. See the LICENSE file in the root of this repo for the full license text.
