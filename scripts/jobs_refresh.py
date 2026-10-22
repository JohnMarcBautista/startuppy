#!/usr/bin/env python3
"""
Jobs refresh script for the Opportunity Platform.
- Verifies job URLs using proper APIs (Ashby job board, Greenhouse API)
- Updates status (Closed/Open) based on actual listing status
- Updates lastChecked dates
"""

import json
import re
import time
import urllib.request
import urllib.error
import ssl
from datetime import datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict

JOBS_FILE = Path(__file__).parent.parent / "jobs.json"
TODAY = datetime.now().strftime("%Y-%m-%d")
REQUEST_TIMEOUT = 20
CONCURRENCY = 5

ssl_context = ssl.create_default_context()
ssl_context.check_hostname = False
ssl_context.verify_mode = ssl.CERT_NONE


def make_request(url, headers=None):
    """Make an HTTP request."""
    if headers is None:
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "application/json",
        }
    
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT, context=ssl_context) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return resp.status, body
    except urllib.error.HTTPError as e:
        return e.code, None
    except urllib.error.URLError as e:
        return None, f"URLError: {e.reason}"
    except Exception as e:
        return None, f"Error: {e}"


def get_ashby_listed_jobs(org_slug):
    """Get all listed job IDs for an Ashby organization."""
    api_url = f"https://api.ashbyhq.com/posting-api/job-board/{org_slug}"
    status, body = make_request(api_url)
    
    if status == 200 and body:
        try:
            data = json.loads(body)
            jobs = data.get("jobs", [])
            return {j.get("id") for j in jobs if j.get("id")}
        except json.JSONDecodeError:
            return None
    elif status == 404:
        return set()
    return None


def check_ashby_posting(url, org_cache):
    """
    Check if an Ashby posting is live using the job board API.
    org_cache is a dict mapping org_slug -> set of listed job IDs (or None if not fetched)
    Returns (is_live, new_url, error)
    """
    match = re.search(r'jobs\.ashbyhq\.com/([^/]+)/([a-f0-9-]+)', url)
    if not match:
        return None, None, "Invalid Ashby URL"
    
    org_slug = match.group(1)
    posting_id = match.group(2)
    
    if org_slug not in org_cache:
        org_cache[org_slug] = get_ashby_listed_jobs(org_slug)
    
    listed_jobs = org_cache[org_slug]
    
    if listed_jobs is None:
        return None, None, "Could not fetch job board"
    
    if posting_id in listed_jobs:
        return True, None, None
    else:
        return False, None, None


def check_greenhouse_posting(url):
    """
    Check if a Greenhouse posting is live using the API.
    Returns (is_live, new_url, error)
    """
    match = re.search(r'greenhouse\.io/([^/]+)/jobs/(\d+)', url)
    if not match:
        return None, None, "Invalid Greenhouse URL format"
    
    org_slug = match.group(1)
    job_id = match.group(2)
    
    api_url = f"https://boards-api.greenhouse.io/v1/boards/{org_slug}/jobs/{job_id}"
    status, body = make_request(api_url)
    
    if status == 200 and body:
        try:
            data = json.loads(body)
            if data.get("id") or data.get("title"):
                return True, None, None
        except json.JSONDecodeError:
            pass
        return True, None, None
    
    if status == 404:
        return False, None, None
    
    return None, None, f"HTTP {status}"


def check_lever_posting(url):
    """
    Check if a Lever posting is live.
    Returns (is_live, new_url, error)
    """
    status, body = make_request(url)
    
    if status == 200 and body:
        if 'This position is no longer available' in body:
            return False, None, None
        return True, None, None
    elif status == 404 or status == 410:
        return False, None, None
    elif status is None:
        return None, None, body
    else:
        return None, None, f"HTTP {status}"


def check_generic_url(url):
    """
    Check if a generic URL is live via HTTP GET.
    Returns (is_live, new_url, error)
    """
    status, body = make_request(url)
    
    if status == 200:
        if body:
            lower_body = body.lower()
            if ('no longer' in lower_body and ('available' in lower_body or 'accepting' in lower_body)):
                return False, None, None
            if 'job not found' in lower_body or 'position closed' in lower_body:
                return False, None, None
        return True, None, None
    elif status in [404, 410]:
        return False, None, None
    elif status == 403:
        return None, None, "HTTP 403 Forbidden"
    elif status is None:
        return None, None, body
    else:
        return None, None, f"HTTP {status}"


def main():
    print(f"Loading {JOBS_FILE}...")
    with open(JOBS_FILE) as f:
        jobs = json.load(f)
    
    print(f"Loaded {len(jobs)} jobs")
    
    open_before = sum(1 for j in jobs if j.get("status") != "Closed")
    closed_before = sum(1 for j in jobs if j.get("status") == "Closed")
    print(f"Before: {open_before} open, {closed_before} closed")
    
    ashby_jobs = [j for j in jobs if "ashby" in j.get("url", "").lower()]
    greenhouse_jobs = [j for j in jobs if "greenhouse" in j.get("url", "").lower()]
    lever_jobs = [j for j in jobs if "lever" in j.get("url", "").lower()]
    other_jobs = [j for j in jobs if not any(x in j.get("url", "").lower() for x in ["ashby", "greenhouse", "lever"])]
    
    print(f"\nJob sources: {len(ashby_jobs)} Ashby, {len(greenhouse_jobs)} Greenhouse, {len(lever_jobs)} Lever, {len(other_jobs)} Other")
    
    newly_closed = []
    reopened = []
    url_rotations = []
    errors = []
    
    ashby_orgs = defaultdict(set)
    for j in ashby_jobs:
        match = re.search(r'jobs\.ashbyhq\.com/([^/]+)/([a-f0-9-]+)', j.get("url", ""))
        if match:
            ashby_orgs[match.group(1)].add((jobs.index(j), match.group(2)))
    
    print(f"\nFetching {len(ashby_orgs)} Ashby job boards...")
    org_cache = {}
    for org_slug in ashby_orgs.keys():
        org_cache[org_slug] = get_ashby_listed_jobs(org_slug)
        time.sleep(0.2)
    
    print(f"Processing {len(ashby_jobs)} Ashby jobs...")
    for idx, job in enumerate(jobs):
        if "ashby" not in job.get("url", "").lower():
            continue
        
        was_closed = job.get("status") == "Closed"
        is_live, new_url, error = check_ashby_posting(job["url"], org_cache)
        
        jobs[idx]["lastChecked"] = TODAY
        
        if error:
            errors.append((job["company"], job["role"], error))
        elif is_live is True:
            if was_closed:
                jobs[idx]["status"] = "Open"
                reopened.append((job["company"], job["role"]))
                print(f"  REOPENED: {job['company']} - {job['role']}")
            if new_url:
                url_rotations.append((job["company"], job["role"], job["url"], new_url))
                jobs[idx]["url"] = new_url
        elif is_live is False:
            if not was_closed:
                jobs[idx]["status"] = "Closed"
                newly_closed.append((job["company"], job["role"]))
                print(f"  CLOSED: {job['company']} - {job['role']}")
    
    print(f"\nProcessing {len(greenhouse_jobs)} Greenhouse jobs...")
    for idx, job in enumerate(jobs):
        if "greenhouse" not in job.get("url", "").lower():
            continue
        
        was_closed = job.get("status") == "Closed"
        is_live, new_url, error = check_greenhouse_posting(job["url"])
        
        jobs[idx]["lastChecked"] = TODAY
        
        if error:
            errors.append((job["company"], job["role"], error))
        elif is_live is True:
            if was_closed:
                jobs[idx]["status"] = "Open"
                reopened.append((job["company"], job["role"]))
                print(f"  REOPENED: {job['company']} - {job['role']}")
        elif is_live is False:
            if not was_closed:
                jobs[idx]["status"] = "Closed"
                newly_closed.append((job["company"], job["role"]))
                print(f"  CLOSED: {job['company']} - {job['role']}")
        
        time.sleep(0.15)
    
    print(f"\nProcessing {len(lever_jobs)} Lever jobs...")
    for idx, job in enumerate(jobs):
        if "lever" not in job.get("url", "").lower():
            continue
        
        was_closed = job.get("status") == "Closed"
        is_live, new_url, error = check_lever_posting(job["url"])
        
        jobs[idx]["lastChecked"] = TODAY
        
        if error:
            errors.append((job["company"], job["role"], error))
        elif is_live is True:
            if was_closed:
                jobs[idx]["status"] = "Open"
                reopened.append((job["company"], job["role"]))
                print(f"  REOPENED: {job['company']} - {job['role']}")
        elif is_live is False:
            if not was_closed:
                jobs[idx]["status"] = "Closed"
                newly_closed.append((job["company"], job["role"]))
                print(f"  CLOSED: {job['company']} - {job['role']}")
        
        time.sleep(0.15)
    
    print(f"\nProcessing {len(other_jobs)} other jobs...")
    for idx, job in enumerate(jobs):
        if any(x in job.get("url", "").lower() for x in ["ashby", "greenhouse", "lever"]):
            continue
        
        was_closed = job.get("status") == "Closed"
        is_live, new_url, error = check_generic_url(job["url"])
        
        jobs[idx]["lastChecked"] = TODAY
        
        if error:
            errors.append((job["company"], job["role"], error))
        elif is_live is True:
            if was_closed:
                jobs[idx]["status"] = "Open"
                reopened.append((job["company"], job["role"]))
                print(f"  REOPENED: {job['company']} - {job['role']}")
        elif is_live is False:
            if not was_closed:
                jobs[idx]["status"] = "Closed"
                newly_closed.append((job["company"], job["role"]))
                print(f"  CLOSED: {job['company']} - {job['role']}")
        
        time.sleep(0.15)
    
    print(f"\n{'='*50}")
    print(f"URL verification complete:")
    print(f"  Newly closed: {len(newly_closed)}")
    print(f"  Reopened: {len(reopened)}")
    print(f"  URL rotations: {len(url_rotations)}")
    print(f"  Errors (inconclusive): {len(errors)}")
    
    if newly_closed:
        print("\nNewly closed roles:")
        for c, r in newly_closed:
            print(f"  - {c}: {r}")
    
    if reopened:
        print("\nReopened roles:")
        for c, r in reopened:
            print(f"  - {c}: {r}")
    
    open_after = sum(1 for j in jobs if j.get("status") != "Closed")
    closed_after = sum(1 for j in jobs if j.get("status") == "Closed")
    print(f"\nAfter verification: {open_after} open, {closed_after} closed")
    
    print(f"\nWriting updated jobs to {JOBS_FILE}...")
    with open(JOBS_FILE, "w") as f:
        json.dump(jobs, f, indent=2)
    
    print("Done!")
    
    return {
        "total": len(jobs),
        "open": open_after,
        "closed": closed_after,
        "newly_closed": newly_closed,
        "reopened": reopened,
        "url_rotations": url_rotations,
        "errors": errors
    }


if __name__ == "__main__":
    main()
