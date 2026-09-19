# Opportunity Platform

Browse-first dashboard with two tabs:

1. **Companies** — YC Summer 2026 batch with industry/tags/rebrand filters
2. **Jobs** — Curated job opportunities with fit/status/remote filters

Static site: card grids, hash routes for detail views, local watchlists (browser `localStorage`).

## Routes

| Route | View |
|-------|------|
| `#/` or `#/companies` | Companies list |
| `#/company/{slug}` | Company detail |
| `#/jobs` | Jobs list |
| `#/jobs/{id}` | Job detail |

## Local

```bash
python3 -m http.server 8765
# open http://127.0.0.1:8765/
```

## Deploy

Import this folder (or GitHub repo) on Vercel as a static project. No build command; output is the repo root.

## Data

- `data.json` — YC S26 companies. Refresh by regenerating from the YC watch agent.
- `jobs.json` — Discovered roles export. Replace the file with a fresh export to update.

### Refreshing jobs.json

1. Export roles from your discovery tracker as JSON
2. Ensure each job has these fields: `id`, `dateFound`, `company`, `role`, `roleFamily`, `fit`, `location`, `remote`, `compensation`, `source`, `url`, `status`, `whyItFits`, `watchouts`, `lastChecked`, `notes`, `briefUrl`
3. Replace `jobs.json` in the repo root
4. Commit and push (Vercel auto-deploys)

### Company enrichment fields (optional)

Jobs can include additional company-level fields for a company-first experience:

| Field | Description |
|-------|-------------|
| `logoUrl` | URL to company logo image (renders fallback initials avatar if missing/broken) |
| `companyBlurb` | One-sentence company description shown under the company name |
| `website` | Company homepage URL (separate from the ATS apply link) |

These fields are optional. If empty or missing, the UI gracefully falls back to initials avatar and omits blurb/website. JMBot will push enriched data with these fields populated.
