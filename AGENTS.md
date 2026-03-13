# Repository Guidelines

## Project Structure & Module Organization
This repository is a small Vite-powered dashboard for monitoring credit stress from FRED data. Application code lives in `src/`: `index.html` is the entry point, `index.js` contains data loading, calculations, and D3 rendering, and `index.scss` is currently unused. Static assets and generated data live in `public/`, especially `public/data/fred.json`. Build output goes to `dist/`. Supporting documentation is in `docs/`, and the daily data refresh/deploy workflow is defined in `.github/workflows/fetch-fred.yml`.

## Build, Test, and Development Commands
- `npm install`: install dependencies.
- `npm run dev`: start the local Vite server from `src/` with browser auto-open.
- `npm run build`: create the production bundle in `dist/`.
- `npm run preview`: serve the built app locally for a final check.
- `npm run deploy`: publish `dist/` to GitHub Pages via `gh-pages`.

There is no dedicated test or lint command yet, so `npm run build` is the required validation step before submitting changes.

## Coding Style & Naming Conventions
Follow the existing style in `src/index.js` and `src/index.html`: 2-space indentation, semicolons, and concise section comments for larger blocks only. Keep identifiers descriptive and consistent with the current domain naming such as `HY`, `BB`, `CCC`, and `renderAlerts()`. Preserve the current architecture: D3 is loaded from CDN in `src/index.html`, and Vite uses `src/` as the project root.

Repository-facing docs, comments, and commit messages should stay in Japanese. Use conventional prefixes already present in history, for example: `feat:`, `fix:`, `docs:`, `style:`, and `chore:`.

## Testing Guidelines
Because automated tests are not configured, contributors should verify changes by:
- running `npm run build`
- checking the affected UI locally with `npm run dev`
- confirming that `public/data/fred.json` still renders without console errors

If you add tests later, place them next to the relevant module or under a new `tests/` directory and use clear names such as `render-alerts.test.js`.

## Commit & Pull Request Guidelines
Keep commits focused and small. Follow the repo’s existing pattern: `type: 短い説明` in Japanese, for example `fix: x軸ラベルの重なりを解消`. Pull requests should include a short summary, impacted screens or metrics, linked issues if any, and screenshots for UI changes. Note any data, workflow, or GitHub Pages deployment impact explicitly.
