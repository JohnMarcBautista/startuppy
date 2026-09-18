# YC S26 Watch

Browse-first dashboard for the Y Combinator Summer 2026 batch.

Static site: card grid, industry/tags/rebrand filters, company detail pages, local watchlist (browser `localStorage`).

## Local

```bash
cd yc-s26-dashboard
python3 -m http.server 8765
# open http://127.0.0.1:8765/
```

## Deploy

Import this folder (or GitHub repo) on Vercel as a static project. No build command; output is the repo root.

## Data

`data.json` is generated from the public YC company directory mirror. Refresh by regenerating from the YC watch agent.
