# BOTD automated testing (E2E)

This folder adds a repeatable end-to-end test suite for the Beware of the Dog game.

## Local run

From your repo root:

```bash
npm install
npx playwright install
npm test
```

Or run with a built-in local server:

```bash
node ./scripts/run-local-e2e.mjs
```

## What is covered

- HOUSE mode: end-to-end flow from Setup → Pre-game → Periods 1–3 → Regulation → Postgame
- VS mode: same
- Smoke fuzz: multiple randomized runs to catch crashes / dead buttons / bad wiring

## CI

A GitHub Actions workflow is included at `.github/workflows/e2e.yml`.
It runs on every push and PR and uploads a Playwright HTML report artifact.
