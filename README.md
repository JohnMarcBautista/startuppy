# Opportunity Platform

Browse-first dashboard for YC S26 companies and discovered job opportunities.

Static site: card grid, filters, detail pages, local watchlist (browser `localStorage`).

## Features

### Companies Tab
- Browse YC S26 companies
- Filter by industry, tags, rebrand status
- Search by name, one-liner, tags
- Watchlist via localStorage (`yc-s26-watchlist-v1`)

### Jobs Tab
- Browse discovered job opportunities
- Filter by fit level, status, remote
- Search by company, role
- Watchlist via localStorage (`opp-jobs-watchlist-v1`)

## Routes

| Route | Description |
|-------|-------------|
| `#/` or `#/companies` | Companies list (default) |
| `#/company/{slug}` | Company detail |
| `#/jobs` | Jobs list |
| `#/jobs/{id}` | Job detail |

## Local Development

```bash
python3 -m http.server 8765
# open http://127.0.0.1:8765/
```

## Deploy

Import this folder (or GitHub repo) on Vercel as a static project. No build command; output is the repo root.

## Data Files

### `data.json`
Company data from the YC company directory. Refresh by regenerating from the YC watch agent.

### `jobs.json`
Discovered job opportunities export. To refresh:

1. Export new jobs data from your job discovery source
2. Replace `jobs.json` with the new export
3. Ensure the JSON array follows this schema:

```json
[
  {
    "id": "unique-job-id",
    "dateFound": "2026-08-31",
    "company": "Company Name",
    "role": "Role Title",
    "roleFamily": "Role Family Description",
    "fit": "Very High|High|Medium|Exploratory",
    "location": "City, State/Country",
    "remote": "Yes|No|Hybrid",
    "compensation": "$XXX–$XXX + equity",
    "source": "Source Name",
    "url": "https://ats-link.com/...",
    "status": "Watch|Applied|Closed",
    "whyItFits": "Why this role is a good fit",
    "watchouts": "Potential concerns or requirements",
    "lastChecked": "2026-08-31",
    "notes": "Additional notes",
    "briefUrl": "https://optional-brief-link.com/..."
  }
]
```

## Tech Stack

- Vanilla HTML/CSS/JS
- No build step required
- Light theme
- Hash-based routing
