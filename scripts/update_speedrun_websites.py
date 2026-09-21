#!/usr/bin/env python3
"""
Update Speedrun companies in data.json with website URLs and fix logo URLs.

Fetches website_url from https://speedrun.a16z.com/companies/{slug} __NEXT_DATA__
and updates the 'website' field in data.json for a16z-speedrun source companies.

Also converts logo URLs from inaccessible GCS direct URLs to the Speedrun proxy format:
  https://storage.googleapis.com/speedrun-prod-media/...
  -> https://speedrun.a16z.com/api/gcs-media/speedrun-prod-media/...
"""

import json
import re
import time
import urllib.request
import urllib.error
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed


BASE_URL = "https://speedrun.a16z.com/companies"
DATA_FILE = Path(__file__).parent.parent / "data.json"
CONCURRENCY = 5
DELAY_BETWEEN_BATCHES = 1.0  # seconds between batches
REQUEST_TIMEOUT = 15  # seconds

GCS_BUCKET_PREFIX = "https://storage.googleapis.com/speedrun-prod-media/"
PROXY_PREFIX = "https://speedrun.a16z.com/api/gcs-media/speedrun-prod-media/"


def extract_speedrun_slug(yc_url: str) -> str:
    """Extract the Speedrun slug from the yc_url field."""
    if "/companies/" in yc_url:
        return yc_url.split("/companies/")[-1].rstrip("/")
    return ""


def convert_logo_url(logo_url: str) -> str:
    """Convert GCS direct URL to Speedrun proxy URL if needed."""
    if logo_url and logo_url.startswith(GCS_BUCKET_PREFIX):
        return PROXY_PREFIX + logo_url[len(GCS_BUCKET_PREFIX):]
    return logo_url


def fetch_website_url(slug: str) -> tuple[str, str | None, str | None]:
    """
    Fetch the website_url from a Speedrun company detail page.
    Returns (slug, website_url, error_message)
    """
    url = f"{BASE_URL}/{slug}"
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Startuppy-Ingest/1.0 (polite bot; respects rate limits)"}
        )
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            html = resp.read().decode("utf-8")
        
        match = re.search(
            r'<script id="__NEXT_DATA__" type="application/json">(.+?)</script>',
            html,
            re.DOTALL
        )
        if not match:
            return slug, None, "No __NEXT_DATA__ found"
        
        try:
            data = json.loads(match.group(1))
            company = data.get("props", {}).get("pageProps", {}).get("company", {})
            website_url = company.get("website_url", "")
            return slug, website_url if website_url else None, None
        except json.JSONDecodeError as e:
            return slug, None, f"JSON parse error: {e}"
    
    except urllib.error.HTTPError as e:
        return slug, None, f"HTTP {e.code}"
    except urllib.error.URLError as e:
        return slug, None, f"URL error: {e.reason}"
    except Exception as e:
        return slug, None, f"Error: {e}"


def main():
    print(f"Loading {DATA_FILE}...")
    with open(DATA_FILE) as f:
        data = json.load(f)
    
    speedrun_companies = [
        c for c in data["companies"]
        if c.get("source") == "a16z-speedrun"
    ]
    
    print(f"Found {len(speedrun_companies)} Speedrun companies")
    
    # Build a map of speedrun_slug -> index in companies list
    slug_to_idx = {}
    for idx, c in enumerate(data["companies"]):
        if c.get("source") == "a16z-speedrun":
            speedrun_slug = extract_speedrun_slug(c.get("yc_url", ""))
            if speedrun_slug:
                slug_to_idx[speedrun_slug] = idx
    
    slugs = list(slug_to_idx.keys())
    print(f"Fetching website URLs for {len(slugs)} companies (concurrency={CONCURRENCY})...")
    
    results = {}
    errors = []
    
    # Process in batches to be polite
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
        future_to_slug = {
            executor.submit(fetch_website_url, slug): slug
            for slug in slugs
        }
        
        completed = 0
        for future in as_completed(future_to_slug):
            slug, website_url, error = future.result()
            completed += 1
            
            if error:
                errors.append((slug, error))
                print(f"  [{completed}/{len(slugs)}] {slug}: ERROR - {error}")
            elif website_url:
                results[slug] = website_url
                print(f"  [{completed}/{len(slugs)}] {slug}: {website_url}")
            else:
                print(f"  [{completed}/{len(slugs)}] {slug}: (no website)")
            
            # Small delay between completions to be polite
            if completed % CONCURRENCY == 0:
                time.sleep(DELAY_BETWEEN_BATCHES)
    
    # Update data.json - websites and logo URLs
    website_updated_count = 0
    logo_updated_count = 0
    
    for slug, website_url in results.items():
        if slug in slug_to_idx:
            idx = slug_to_idx[slug]
            old_website = data["companies"][idx].get("website", "")
            if old_website != website_url:
                data["companies"][idx]["website"] = website_url
                website_updated_count += 1
    
    # Fix logo URLs for all Speedrun companies
    for idx, c in enumerate(data["companies"]):
        if c.get("source") == "a16z-speedrun":
            old_logo = c.get("logo", "")
            new_logo = convert_logo_url(old_logo)
            if old_logo != new_logo:
                data["companies"][idx]["logo"] = new_logo
                logo_updated_count += 1
    
    print(f"\nSummary:")
    print(f"  Total Speedrun companies: {len(speedrun_companies)}")
    print(f"  Websites found: {len(results)}")
    print(f"  Websites updated: {website_updated_count}")
    print(f"  Logo URLs converted: {logo_updated_count}")
    print(f"  Errors: {len(errors)}")
    
    if errors:
        print("\nErrors:")
        for slug, err in errors[:10]:
            print(f"  {slug}: {err}")
        if len(errors) > 10:
            print(f"  ... and {len(errors) - 10} more")
    
    # Write updated data
    print(f"\nWriting updated data to {DATA_FILE}...")
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    
    print("Done!")
    return website_updated_count, logo_updated_count, len(errors)


if __name__ == "__main__":
    main()
