/**
 * Opportunity Platform — vanilla SPA
 * Hash routes:
 *   Companies: #/  #/companies  #/company/{slug}
 *   Jobs: #/jobs  #/jobs/{id}
 */

(() => {
  "use strict";

  const STORAGE_KEY = "yc-s26-filters-v2";
  const WATCHLIST_KEY = "yc-s26-watchlist-v1";
  const JOBS_STORAGE_KEY = "opp-jobs-filters-v1";
  const JOBS_WATCHLIST_KEY = "opp-jobs-watchlist-v1";
  const TOP_TAGS_VISIBLE = 12;

  /** @type {null | {
   *   batches: Array<{batch: string, batch_short: string, company_count: number, hiring_count: number, rebrand_count: number, industry_summary: Record<string, number>, top_tags: Record<string, number>}>,
   *   default_batches: string[],
   *   batch: string, batch_short: string, pulled_at: string,
   *   company_count: number, hiring_count: number, rebrand_count: number,
   *   industry_summary: Record<string, number>,
   *   top_tags: Record<string, number>,
   *   companies: Company[]
   * }} */
  let data = null;

  /** @type {null | Job[]} */
  let jobsData = null;

  /** @typedef {{
   *   id: number, name: string, slug: string, one_liner: string, description: string,
   *   industry: string, subindustry: string, tags: string[], website: string, yc_url: string,
   *   logo: string, locations: string, team_size: number|null, status: string,
   *   is_hiring: boolean, stage: string, former_names: string[], has_rebrand: boolean,
   *   batch: string, batch_short: string, regions: string[]
   * }} Company */

  /** @typedef {{
   *   id: string, dateFound: string, company: string, role: string, roleFamily: string,
   *   fit: string, location: string, remote: string, compensation: string, source: string,
   *   url: string, status: string, whyItFits: string, watchouts: string, lastChecked: string,
   *   notes: string, briefUrl: string,
   *   companyBlurb?: string, website?: string, logoUrl?: string
   * }} Job */

  /** @type {{ q: string, sources: string[], batches: string[], industries: string[], tags: string[], rebrandOnly: boolean, watchlistOnly: boolean, tagsExpanded: boolean, tagQuery: string }} */
  let filters = {
    q: "",
    sources: [],
    batches: [],
    industries: [],
    tags: [],
    rebrandOnly: false,
    watchlistOnly: false,
    tagsExpanded: false,
    tagQuery: "",
  };

  /** @type {{ q: string, fits: string[], statuses: string[], remotes: string[], healthBadges: string[], watchlistOnly: boolean }} */
  let jobFilters = {
    q: "",
    fits: [],
    statuses: [],
    remotes: [],
    healthBadges: [],
    watchlistOnly: false,
  };

  /** @type {Set<string>} */
  let watchlist = new Set();

  /** @type {Set<string>} */
  let jobsWatchlist = new Set();

  const app = document.getElementById("app");

  // ——— Utils ———

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function initials(name) {
    const parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function formatPulledAt(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  function formatDate(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  }

  // ——— Company Watchlist ———

  function loadWatchlist() {
    try {
      const raw = localStorage.getItem(WATCHLIST_KEY);
      if (!raw) {
        watchlist = new Set();
        return;
      }
      const arr = JSON.parse(raw);
      watchlist = new Set(Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : []);
    } catch {
      watchlist = new Set();
    }
  }

  function saveWatchlist() {
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify([...watchlist]));
    } catch {
      /* ignore */
    }
  }


  function exportWatchlist() {
    const slugs = [...watchlist];
    const companies = (data && data.companies) || [];
    const bySlug = new Map(companies.map((c) => [c.slug, c]));
    const batchLabel = data && data.batches ? data.batches.map((b) => b.batch_short).join("+") : "YC";
    const payload = {
      version: 1,
      exported_at: new Date().toISOString(),
      batches: batchLabel,
      slugs,
      companies: slugs.map((slug) => {
        const c = bySlug.get(slug);
        return c
          ? { slug, name: c.name, one_liner: c.one_liner, industry: c.industry, batch_short: c.batch_short, yc_url: c.yc_url }
          : { slug };
      }),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `yc-watchlist-${batchLabel}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function applyImportedSlugs(slugs, mode) {
    const clean = [
      ...new Set(
        (slugs || [])
          .map((s) => (typeof s === "string" ? s.trim() : ""))
          .filter(Boolean)
      ),
    ];
    if (!clean.length) {
      alert("No company slugs found in that file.");
      return;
    }
    if (mode === "replace") {
      watchlist = new Set(clean);
    } else {
      clean.forEach((s) => watchlist.add(s));
    }
    saveWatchlist();
  }

  function importWatchlistFromFile(file, mode) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || "");
        let slugs = [];
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          slugs = parsed.map((x) =>
            typeof x === "string" ? x : x && x.slug
          );
        } else if (parsed && Array.isArray(parsed.slugs)) {
          slugs = parsed.slugs;
        } else if (parsed && Array.isArray(parsed.companies)) {
          slugs = parsed.companies.map((c) =>
            typeof c === "string" ? c : c && c.slug
          );
        } else {
          throw new Error("Unrecognized watchlist format");
        }
        applyImportedSlugs(slugs, mode);
        const r = parseRoute();
        if (r.name === "home") rerenderHomePreserving(null, false);
        else if (r.name === "company") renderDetail(r.slug);
        else route();
      } catch (err) {
        alert("Couldn’t import watchlist. Use a JSON export from this app.");
        console.error(err);
      }
    };
    reader.readAsText(file);
  }

  function isWatched(slug) {
    return watchlist.has(slug);
  }

  function toggleWatch(slug) {
    if (watchlist.has(slug)) watchlist.delete(slug);
    else watchlist.add(slug);
    saveWatchlist();
  }

  // ——— Jobs Watchlist ———

  function loadJobsWatchlist() {
    try {
      const raw = localStorage.getItem(JOBS_WATCHLIST_KEY);
      if (!raw) {
        jobsWatchlist = new Set();
        return;
      }
      const arr = JSON.parse(raw);
      jobsWatchlist = new Set(Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : []);
    } catch {
      jobsWatchlist = new Set();
    }
  }

  function saveJobsWatchlist() {
    try {
      localStorage.setItem(JOBS_WATCHLIST_KEY, JSON.stringify([...jobsWatchlist]));
    } catch {
      /* ignore */
    }
  }

  function isJobWatched(id) {
    return jobsWatchlist.has(id);
  }

  function toggleJobWatch(id) {
    if (jobsWatchlist.has(id)) jobsWatchlist.delete(id);
    else jobsWatchlist.add(id);
    saveJobsWatchlist();
  }

  function starSvg(filled) {
    if (filled) {
      return `<svg class="star-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5l2.9 6.1 6.7.7-5 4.6 1.4 6.6L12 17.8 5.99 20.5 7.4 13.9l-5-4.6 6.7-.7L12 2.5z"/></svg>`;
    }
    return `<svg class="star-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.7.7-5 4.6 1.4 6.6L12 17.8 5.99 20.5 7.4 13.9l-5-4.6 6.7-.7L12 2.5z"/></svg>`;
  }

  // ——— Company Filters ———

  function loadFilters() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      filters = {
        q: typeof parsed.q === "string" ? parsed.q : "",
        sources: Array.isArray(parsed.sources) ? parsed.sources : [],
        batches: Array.isArray(parsed.batches) ? parsed.batches : [],
        industries: Array.isArray(parsed.industries) ? parsed.industries : [],
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        rebrandOnly: !!parsed.rebrandOnly,
        watchlistOnly: !!parsed.watchlistOnly,
        tagsExpanded: !!parsed.tagsExpanded,
        tagQuery: typeof parsed.tagQuery === "string" ? parsed.tagQuery : "",
      };
    } catch {
      /* ignore */
    }
  }

  function saveFilters() {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          q: filters.q,
          sources: filters.sources,
          batches: filters.batches,
          industries: filters.industries,
          tags: filters.tags,
          rebrandOnly: filters.rebrandOnly,
          watchlistOnly: filters.watchlistOnly,
          tagsExpanded: filters.tagsExpanded,
          tagQuery: filters.tagQuery,
          scrollY: window.scrollY,
        })
      );
    } catch {
      /* ignore */
    }
  }

  function restoreScroll() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed.scrollY === "number") {
        requestAnimationFrame(() => {
          window.scrollTo(0, parsed.scrollY);
        });
      }
    } catch {
      /* ignore */
    }
  }

  function hasActiveFilters() {
    const allBatches = data && data.batches ? data.batches.map((b) => b.batch_short) : [];
    const allSources = data && data.sources ? data.sources.map((s) => s.id) : [];
    const batchesActive = filters.batches.length > 0 && filters.batches.length < allBatches.length;
    const sourcesActive = filters.sources.length > 0 && filters.sources.length < allSources.length;
    return (
      filters.q.trim() !== "" ||
      sourcesActive ||
      batchesActive ||
      filters.industries.length > 0 ||
      filters.tags.length > 0 ||
      filters.rebrandOnly ||
      filters.watchlistOnly
    );
  }

  // ——— Jobs Filters ———

  function loadJobFilters() {
    try {
      const raw = sessionStorage.getItem(JOBS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      jobFilters = {
        q: typeof parsed.q === "string" ? parsed.q : "",
        fits: Array.isArray(parsed.fits) ? parsed.fits : [],
        statuses: Array.isArray(parsed.statuses) ? parsed.statuses : [],
        remotes: Array.isArray(parsed.remotes) ? parsed.remotes : [],
        healthBadges: Array.isArray(parsed.healthBadges) ? parsed.healthBadges : [],
        watchlistOnly: !!parsed.watchlistOnly,
      };
    } catch {
      /* ignore */
    }
  }

  function saveJobFilters() {
    try {
      sessionStorage.setItem(
        JOBS_STORAGE_KEY,
        JSON.stringify({
          q: jobFilters.q,
          fits: jobFilters.fits,
          statuses: jobFilters.statuses,
          remotes: jobFilters.remotes,
          healthBadges: jobFilters.healthBadges,
          watchlistOnly: jobFilters.watchlistOnly,
          scrollY: window.scrollY,
        })
      );
    } catch {
      /* ignore */
    }
  }

  function restoreJobsScroll() {
    try {
      const raw = sessionStorage.getItem(JOBS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed.scrollY === "number") {
        requestAnimationFrame(() => {
          window.scrollTo(0, parsed.scrollY);
        });
      }
    } catch {
      /* ignore */
    }
  }

  function hasActiveJobFilters() {
    return (
      jobFilters.q.trim() !== "" ||
      jobFilters.fits.length > 0 ||
      jobFilters.statuses.length > 0 ||
      jobFilters.remotes.length > 0 ||
      jobFilters.healthBadges.length > 0 ||
      jobFilters.watchlistOnly
    );
  }

  // ——— Router ———

  function parseRoute() {
    const hash = (location.hash || "#/").replace(/^#/, "") || "/";
    const path = hash.split("?")[0];

    // Jobs routes
    const jobMatch = path.match(/^\/jobs\/([^/]+)\/?$/);
    if (jobMatch) {
      return { name: "job", id: decodeURIComponent(jobMatch[1]) };
    }
    if (path === "/jobs" || path === "/jobs/") {
      return { name: "jobs" };
    }

    // Company routes
    const companyMatch = path.match(/^\/company\/([^/]+)\/?$/);
    if (companyMatch) {
      return { name: "company", slug: decodeURIComponent(companyMatch[1]) };
    }
    if (path === "/" || path === "/companies" || path === "") {
      return { name: "home" };
    }
    return { name: "notfound" };
  }

  function logoHtml(company, sizeClass = "") {
    const cls = sizeClass ? `logo ${sizeClass}` : "logo";
    const monoCls = sizeClass ? `monogram ${sizeClass}` : "monogram";
    const ini = escapeHtml(initials(company.name));
    const alt = escapeHtml(company.name);
    if (company.logo) {
      return `<img class="${cls}" src="${escapeHtml(company.logo)}" alt="${alt} logo" loading="lazy" decoding="async" data-fallback="${ini}" onerror="this.onerror=null;const m=document.createElement('div');m.className='${monoCls}';m.textContent=this.dataset.fallback;m.setAttribute('aria-hidden','true');this.replaceWith(m);" />`;
    }
    return `<div class="${monoCls}" aria-hidden="true">${ini}</div>`;
  }

  function jobLogoHtml(job, sizeClass = "") {
    const cls = sizeClass ? `job-logo ${sizeClass}` : "job-logo";
    const monoCls = sizeClass ? `job-monogram ${sizeClass}` : "job-monogram";
    const ini = escapeHtml(initials(job.company));
    const alt = escapeHtml(job.company);
    if (job.logoUrl) {
      return `<img class="${cls}" src="${escapeHtml(job.logoUrl)}" alt="${alt} logo" loading="lazy" decoding="async" data-fallback="${ini}" onerror="this.onerror=null;const m=document.createElement('div');m.className='${monoCls}';m.textContent=this.dataset.fallback;m.setAttribute('aria-hidden','true');this.replaceWith(m);" />`;
    }
    return `<div class="${monoCls}" aria-hidden="true">${ini}</div>`;
  }

  // ——— Tab Navigation ———

  function renderTabNav(activeTab) {
    const companiesActive = activeTab === "companies";
    const jobsActive = activeTab === "jobs";
    return `
      <nav class="tab-nav" role="tablist" aria-label="Main navigation">
        <a href="#/" class="tab-link ${companiesActive ? "active" : ""}" role="tab" aria-selected="${companiesActive}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1"/>
            <rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/>
            <rect x="14" y="14" width="7" height="7" rx="1"/>
          </svg>
          Companies
        </a>
        <a href="#/jobs" class="tab-link ${jobsActive ? "active" : ""}" role="tab" aria-selected="${jobsActive}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
          </svg>
          Jobs
        </a>
      </nav>
    `;
  }

  // ——— Filtering: Companies ———

  function getSelectedSources() {
    if (!data || !data.sources) return [];
    const allSources = data.sources.map((s) => s.id);
    if (filters.sources.length === 0) return allSources;
    return filters.sources;
  }

  function getSelectedBatches() {
    if (!data || !data.batches) return [];
    const allBatches = data.batches.map((b) => b.batch_short);
    if (filters.batches.length === 0) return allBatches;
    return filters.batches;
  }

  function computeStats(selectedSources, selectedBatches) {
    if (!data || !data.companies) {
      return { company_count: 0, hiring_count: 0, rebrand_count: 0, industry_summary: {}, top_tags: {} };
    }
    const sourceSet = new Set(selectedSources);
    const batchSet = new Set(selectedBatches);
    
    const companies = data.companies.filter((c) => {
      if (!sourceSet.has(c.source)) return false;
      if (c.source === "yc" && !batchSet.has(c.batch_short)) return false;
      return true;
    });
    
    const industry_summary = {};
    const tagCounts = {};
    let hiring_count = 0;
    let rebrand_count = 0;

    for (const c of companies) {
      if (c.industry) {
        industry_summary[c.industry] = (industry_summary[c.industry] || 0) + 1;
      }
      for (const t of c.tags || []) {
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      }
      if (c.is_hiring) hiring_count++;
      if (c.has_rebrand) rebrand_count++;
    }

    const top_tags = Object.fromEntries(
      Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 40)
    );

    return {
      company_count: companies.length,
      hiring_count,
      rebrand_count,
      industry_summary,
      top_tags,
    };
  }

  function applyFilters(companies) {
    const q = filters.q.trim().toLowerCase();
    const selectedSources = getSelectedSources();
    const selectedBatches = getSelectedBatches();
    const sourceSet = new Set(selectedSources);
    const batchSet = new Set(selectedBatches);
    const indSet = new Set(filters.industries);
    const tagSet = new Set(filters.tags);

    return companies.filter((c) => {
      if (!sourceSet.has(c.source)) return false;
      if (c.source === "yc" && !batchSet.has(c.batch_short)) return false;
      if (filters.watchlistOnly && !watchlist.has(c.slug)) return false;
      if (filters.rebrandOnly && !c.has_rebrand) return false;
      if (indSet.size && !indSet.has(c.industry)) return false;
      if (tagSet.size) {
        const ct = c.tags || [];
        for (const t of tagSet) {
          if (!ct.includes(t)) return false;
        }
      }
      if (q) {
        const hay = [
          c.name,
          c.one_liner,
          ...(c.tags || []),
          c.industry,
          c.subindustry,
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  // ——— Filtering: Jobs ———

  function applyJobFilters(jobs) {
    const q = jobFilters.q.trim().toLowerCase();
    const fitSet = new Set(jobFilters.fits);
    const statusSet = new Set(jobFilters.statuses);
    const remoteSet = new Set(jobFilters.remotes);
    const healthSet = new Set(jobFilters.healthBadges);

    return jobs.filter((j) => {
      if (jobFilters.watchlistOnly && !jobsWatchlist.has(j.id)) return false;
      if (fitSet.size && !fitSet.has(j.fit)) return false;
      if (statusSet.size && !statusSet.has(j.status)) return false;
      if (remoteSet.size && !remoteSet.has(j.remote)) return false;
      if (healthSet.size) {
        const badge = j.healthBadge || "Unknown";
        if (!healthSet.has(badge)) return false;
      }
      if (q) {
        const hay = [
          j.company,
          j.role,
          j.roleFamily,
          j.location,
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  // ——— Render: Companies Home ———

  function renderHome() {
    const selectedSources = getSelectedSources();
    const selectedBatches = getSelectedBatches();
    const stats = computeStats(selectedSources, selectedBatches);

    const industries = Object.entries(stats.industry_summary).sort(
      (a, b) => b[1] - a[1]
    );
    const topTags = Object.entries(stats.top_tags).sort((a, b) => b[1] - a[1]);
    const filtered = applyFilters(data.companies);
    const active = hasActiveFilters();
    const watchCount = watchlist.size;

    const allSources = data.sources || [];
    const sourceChips = allSources
      .map((s) => {
        const pressed = filters.sources.length === 0 || filters.sources.includes(s.id);
        return `<button type="button" class="chip chip-source" data-filter="source" data-value="${escapeHtml(s.id)}" aria-pressed="${pressed}">${escapeHtml(s.label)}<span class="chip-count">${s.count}</span></button>`;
      })
      .join("");

    const allBatches = data.batches || [];
    const ycSelected = filters.sources.length === 0 || filters.sources.includes("yc");
    const batchChips = allBatches
      .map((b) => {
        const pressed = filters.batches.length === 0 || filters.batches.includes(b.batch_short);
        return `<button type="button" class="chip" data-filter="batch" data-value="${escapeHtml(b.batch_short)}" aria-pressed="${pressed}">${escapeHtml(b.batch)}<span class="chip-count">${b.company_count}</span></button>`;
      })
      .join("");

    const industryChips = industries
      .map(([name, count]) => {
        const pressed = filters.industries.includes(name);
        return `<button type="button" class="chip" data-filter="industry" data-value="${escapeHtml(name)}" aria-pressed="${pressed}">${escapeHtml(name)}<span class="chip-count">${count}</span></button>`;
      })
      .join("");

    const visibleTags = filters.tagsExpanded
      ? topTags
      : topTags.slice(0, TOP_TAGS_VISIBLE);
    const tagQuery = filters.tagQuery.trim().toLowerCase();
    const shownTags = tagQuery
      ? topTags.filter(([t]) => t.toLowerCase().includes(tagQuery))
      : visibleTags;

    const selectedExtra = filters.tags.filter(
      (t) => !shownTags.some(([n]) => n === t)
    );

    const tagChips =
      shownTags
        .map(([name, count]) => {
          const pressed = filters.tags.includes(name);
          return `<button type="button" class="chip" data-filter="tag" data-value="${escapeHtml(name)}" aria-pressed="${pressed}">${escapeHtml(name)}<span class="chip-count">${count}</span></button>`;
        })
        .join("") +
      selectedExtra
        .map((name) => {
          return `<button type="button" class="chip" data-filter="tag" data-value="${escapeHtml(name)}" aria-pressed="true">${escapeHtml(name)}</button>`;
        })
        .join("");

    const moreBtn =
      !tagQuery && topTags.length > TOP_TAGS_VISIBLE
        ? `<button type="button" class="tags-more-btn" data-action="toggle-tags">${filters.tagsExpanded ? "Show less" : `+${topTags.length - TOP_TAGS_VISIBLE} more`}</button>`
        : "";

    let cards;
    if (filtered.length === 0) {
      const emptyWatch =
        filters.watchlistOnly && watchCount === 0
          ? `<div class="empty" role="status">
            <h2>Your watchlist is empty</h2>
            <p>Star companies from the grid or a detail page, or import a JSON export from another device.</p>
            <div class="empty-actions">
              <button type="button" class="btn btn-secondary" data-action="import-watchlist">Import watchlist</button>
              <button type="button" class="btn btn-secondary" data-action="clear-watchlist-filter">Show all companies</button>
            </div>
          </div>`
          : `<div class="empty" role="status">
            <h2>No companies match</h2>
            <p>Try clearing filters or adjusting your search.</p>
            <button type="button" class="btn btn-secondary" data-action="clear">Clear filters</button>
          </div>`;
      cards = emptyWatch;
    } else {
      cards = `<div class="grid" role="list">${filtered.map(renderCard).join("")}</div>`;
    }

    const sourceLabel = selectedSources.length === allSources.length 
      ? "All sources" 
      : selectedSources.map(id => allSources.find(s => s.id === id)?.label || id).join(", ");

    app.innerHTML = `
      <div class="shell">
        <header class="topbar">
          <div class="topbar-inner">
            <div class="brand">
              <div class="brand-title">
                <h1>Opportunity Platform</h1>
              </div>
              <div class="brand-sub">
                ${escapeHtml(sourceLabel)} · Updated ${escapeHtml(formatPulledAt(data.pulled_at))}
              </div>
            </div>
            ${renderTabNav("companies")}
          </div>
        </header>

        <main class="main">
          <div class="page-header">
            <h2 class="page-title">Companies</h2>
            <div class="stat-chips" aria-label="Stats">
              <span class="stat-chip"><strong>${stats.company_count}</strong> companies</span>
              <span class="stat-chip"><strong>${industries.length}</strong> industries</span>
              <span class="stat-chip"><strong>${stats.rebrand_count}</strong> rebrands</span>
              <span class="stat-chip secondary"><strong>${stats.hiring_count}</strong> hiring</span>
              <button type="button" class="stat-chip watchlist-stat ${filters.watchlistOnly ? "active" : ""}" data-action="watchlist" aria-pressed="${filters.watchlistOnly}" title="Show watchlist">
                ${starSvg(true)}<strong>${watchCount}</strong> watchlist
              </button>
            </div>
          </div>

          <section class="filters" aria-label="Filters">
            <div class="filters-row">
              <div class="search-wrap">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
                <input type="search" class="search-input" id="search" placeholder="Search name, one-liner, tags…" value="${escapeHtml(filters.q)}" autocomplete="off" spellcheck="false" aria-label="Search companies" />
                <span class="kbd-hint" aria-hidden="true">/</span>
              </div>
              <button type="button" class="toggle-pill ${filters.watchlistOnly ? "is-on" : ""}" data-action="watchlist" aria-pressed="${filters.watchlistOnly}">
                ${starSvg(filters.watchlistOnly)}
                Watchlist${watchCount ? ` (${watchCount})` : ""}
              </button>
              <button type="button" class="btn btn-secondary btn-compact" data-action="export-watchlist" ${watchCount ? "" : "disabled"} title="Download watchlist JSON">Export</button>
              <button type="button" class="btn btn-secondary btn-compact" data-action="import-watchlist" title="Import watchlist JSON">Import</button>
              <input type="file" id="watchlist-file" accept="application/json,.json" hidden />
              <button type="button" class="toggle-pill" data-action="rebrand" aria-pressed="${filters.rebrandOnly}">
                <span class="toggle-dot" aria-hidden="true"></span>
                Rebrand / pivot
              </button>
              <button type="button" class="clear-btn" data-action="clear" ${active ? "" : "hidden"}>Clear filters</button>
            </div>

            <div class="filter-section">
              <div class="filter-label">Source</div>
              <div class="chip-scroll" role="group" aria-label="Filter by source">${sourceChips}</div>
            </div>

            <div class="filter-section ${ycSelected ? "" : "filter-section-disabled"}" ${ycSelected ? "" : 'title="Select Y Combinator source to filter by batch"'}>
              <div class="filter-label">Batch <span class="filter-label-note">(YC only)</span></div>
              <div class="chip-scroll" role="group" aria-label="Filter by batch">${batchChips}</div>
            </div>

            <div class="filter-section">
              <div class="filter-label">Industry</div>
              <div class="chip-scroll" role="group" aria-label="Filter by industry">${industryChips}</div>
            </div>

            <div class="filter-section">
              <div class="filter-label">Tags</div>
              <div class="tags-panel">
                <div class="tag-search-wrap">
                  <input type="search" class="tag-search" id="tag-search" placeholder="Find tags…" value="${escapeHtml(filters.tagQuery)}" autocomplete="off" aria-label="Search tags" />
                </div>
                ${tagChips}
                ${moreBtn}
              </div>
            </div>
          </section>

          <div class="results-bar">
            <span>Showing <strong>${filtered.length}</strong> of ${filters.watchlistOnly ? watchCount + " watched" : stats.company_count}</span>
          </div>

          ${cards}
        </main>

        <p class="footer-stub">Browse ${data.company_count.toLocaleString()} companies across ${allSources.length} accelerators</p>
      </div>
    `;

    bindHomeEvents();
  }

  function getSourceBadgeClass(source) {
    switch (source) {
      case "yc": return "badge-source-yc";
      case "techstars": return "badge-source-techstars";
      case "ef": return "badge-source-ef";
      case "antler": return "badge-source-antler";
      case "a16z-speedrun": return "badge-source-speedrun";
      default: return "badge-source";
    }
  }

  function getSourceShortLabel(source) {
    switch (source) {
      case "yc": return "YC";
      case "techstars": return "TS";
      case "ef": return "EF";
      case "antler": return "Antler";
      case "a16z-speedrun": return "Speedrun";
      default: return source;
    }
  }

  function renderCard(c) {
    const tags = (c.tags || []).slice(0, 3);
    const watched = isWatched(c.slug);
    const sourceBadgeClass = getSourceBadgeClass(c.source);
    const sourceLabel = getSourceShortLabel(c.source);
    const badges = [
      c.source
        ? `<span class="badge ${sourceBadgeClass}">${escapeHtml(sourceLabel)}</span>`
        : "",
      c.source === "yc" && c.batch_short
        ? `<span class="badge badge-batch">${escapeHtml(c.batch_short)}</span>`
        : "",
      c.has_rebrand
        ? `<span class="badge badge-rebrand">Rebrand</span>`
        : "",
      c.is_hiring
        ? `<span class="badge badge-hiring"><span class="hiring-dot" aria-hidden="true"></span>Hiring</span>`
        : "",
    ]
      .filter(Boolean)
      .join("");

    const pills = [
      c.industry
        ? `<span class="pill pill-industry">${escapeHtml(c.industry)}</span>`
        : "",
      ...tags.map((t) => `<span class="pill">${escapeHtml(t)}</span>`),
    ]
      .filter(Boolean)
      .join("");

    return `
      <div class="card-wrap" role="listitem">
        <button type="button" class="watch-btn ${watched ? "is-watched" : ""}" data-watch-slug="${escapeHtml(c.slug)}" aria-pressed="${watched}" aria-label="${watched ? "Remove from watchlist" : "Add to watchlist"}" title="${watched ? "Remove from watchlist" : "Add to watchlist"}">
          ${starSvg(watched)}
        </button>
        <a class="card" href="#/company/${encodeURIComponent(c.slug)}" data-slug="${escapeHtml(c.slug)}">
          <div class="card-top">
            ${logoHtml(c)}
            <div class="card-meta">
              <div class="card-name-row">
                <h2 class="card-name">${escapeHtml(c.name)}</h2>
                ${badges}
              </div>
              <p class="card-one-liner">${escapeHtml(c.one_liner || "")}</p>
            </div>
          </div>
          <div class="card-pills">${pills}</div>
        </a>
      </div>
    `;
  }

  function rerenderHomePreserving(focusId, selectEnd) {
    const y = window.scrollY;
    saveFilters();
    renderHome();
    window.scrollTo(0, y);
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) {
        el.focus();
        if (selectEnd && typeof el.setSelectionRange === "function") {
          const len = el.value.length;
          el.setSelectionRange(len, len);
        }
      }
    }
  }

  function bindHomeEvents() {
    const search = document.getElementById("search");
    if (search) {
      let t = null;
      search.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(() => {
          filters.q = search.value;
          rerenderHomePreserving("search", true);
        }, 120);
      });
    }

    const tagSearch = document.getElementById("tag-search");
    if (tagSearch) {
      let t = null;
      tagSearch.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(() => {
          filters.tagQuery = tagSearch.value;
          rerenderHomePreserving("tag-search", true);
        }, 100);
      });
    }

    app.querySelectorAll('[data-filter="source"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = btn.getAttribute("data-value");
        const allSources = data.sources ? data.sources.map((s) => s.id) : [];
        if (filters.sources.length === 0) {
          filters.sources = allSources.filter((s) => s !== v);
        } else {
          const idx = filters.sources.indexOf(v);
          if (idx >= 0) {
            filters.sources.splice(idx, 1);
            if (filters.sources.length === 0) {
              filters.sources = [];
            }
          } else {
            filters.sources.push(v);
            if (filters.sources.length === allSources.length) {
              filters.sources = [];
            }
          }
        }
        filters.industries = [];
        filters.tags = [];
        rerenderHomePreserving(null, false);
      });
    });

    app.querySelectorAll('[data-filter="batch"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = btn.getAttribute("data-value");
        const allBatches = data.batches ? data.batches.map((b) => b.batch_short) : [];
        if (filters.batches.length === 0) {
          filters.batches = allBatches.filter((b) => b !== v);
        } else {
          const idx = filters.batches.indexOf(v);
          if (idx >= 0) {
            filters.batches.splice(idx, 1);
            if (filters.batches.length === 0) {
              filters.batches = [];
            }
          } else {
            filters.batches.push(v);
            if (filters.batches.length === allBatches.length) {
              filters.batches = [];
            }
          }
        }
        filters.industries = [];
        filters.tags = [];
        rerenderHomePreserving(null, false);
      });
    });

    app.querySelectorAll('[data-filter="industry"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = btn.getAttribute("data-value");
        const idx = filters.industries.indexOf(v);
        if (idx >= 0) filters.industries.splice(idx, 1);
        else filters.industries.push(v);
        rerenderHomePreserving(null, false);
      });
    });

    app.querySelectorAll('[data-filter="tag"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = btn.getAttribute("data-value");
        const idx = filters.tags.indexOf(v);
        if (idx >= 0) filters.tags.splice(idx, 1);
        else filters.tags.push(v);
        rerenderHomePreserving(null, false);
      });
    });

    app.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-action");
        if (action === "rebrand") {
          filters.rebrandOnly = !filters.rebrandOnly;
          rerenderHomePreserving(null, false);
        } else if (action === "watchlist") {
          filters.watchlistOnly = !filters.watchlistOnly;
          rerenderHomePreserving(null, false);
        } else if (action === "export-watchlist") {
          exportWatchlist();
        } else if (action === "import-watchlist") {
          const input = document.getElementById("watchlist-file");
          if (input) {
            input.value = "";
            input.click();
          }
        } else if (action === "clear-watchlist-filter") {
          filters.watchlistOnly = false;
          rerenderHomePreserving(null, false);
        } else if (action === "clear") {
          filters.q = "";
          filters.sources = [];
          filters.batches = [];
          filters.industries = [];
          filters.tags = [];
          filters.rebrandOnly = false;
          filters.watchlistOnly = false;
          filters.tagQuery = "";
          rerenderHomePreserving(null, false);
        } else if (action === "toggle-tags") {
          filters.tagsExpanded = !filters.tagsExpanded;
          rerenderHomePreserving(null, false);
        }
      });
    });

    app.querySelectorAll("[data-watch-slug]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const slug = btn.getAttribute("data-watch-slug");
        toggleWatch(slug);
        rerenderHomePreserving(null, false);
      });
    });


    const fileInput = document.getElementById("watchlist-file");
    if (fileInput && !fileInput.dataset.bound) {
      fileInput.dataset.bound = "1";
      fileInput.addEventListener("change", () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        let mode = "replace";
        if (watchlist.size > 0) {
          const merge = confirm(
            "You already have starred companies.\n\nOK = merge with import\nCancel = replace watchlist"
          );
          mode = merge ? "merge" : "replace";
        }
        importWatchlistFromFile(file, mode);
      });
    }

    app.querySelectorAll("a.card").forEach((a) => {
      a.addEventListener("click", () => {
        saveFilters();
      });
    });
  }

  // ——— Render: Company Detail ———

  function renderDetail(slug) {
    const company = data.companies.find((c) => c.slug === slug);
    if (!company) {
      app.innerHTML = `
        <div class="shell">
          <header class="topbar">
            <div class="topbar-inner">
              <div class="brand">
                <div class="brand-title"><h1>Opportunity Platform</h1></div>
              </div>
              ${renderTabNav("companies")}
            </div>
          </header>
          <main class="main">
            <div class="not-found">
              <h1>Company not found</h1>
              <p>No company matches <code>${escapeHtml(slug)}</code> in the database.</p>
              <a class="btn btn-primary" href="#/">Back to companies</a>
            </div>
          </main>
        </div>
      `;
      return;
    }

    const watched = isWatched(company.slug);
    const tags = (company.tags || [])
      .map((t) => `<span class="pill">${escapeHtml(t)}</span>`)
      .join("");

    const sourceBadgeClass = getSourceBadgeClass(company.source);
    const sourceLabel = company.source_label || getSourceShortLabel(company.source);
    
    const getProfileLinkLabel = (source) => {
      switch (source) {
        case "yc": return "YC profile";
        case "techstars": return "Techstars profile";
        case "ef": return "EF profile";
        case "antler": return "Antler profile";
        case "a16z-speedrun": return "Speedrun page";
        default: return "Profile";
      }
    };

    const former =
      company.former_names && company.former_names.length
        ? `<section class="section">
            <h2>History / rebrand</h2>
            <ul class="former-list">
              ${company.former_names.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}
            </ul>
          </section>`
        : "";

    const about =
      company.description && company.description.trim()
        ? escapeHtml(company.description.trim())
        : `<span class="muted">No description available yet.</span>`;

    const teamSize =
      company.team_size != null && company.team_size !== ""
        ? String(company.team_size)
        : "—";

    app.innerHTML = `
      <div class="shell">
        <header class="topbar">
          <div class="topbar-inner">
            <div class="brand">
              <div class="brand-title"><h1>Opportunity Platform</h1></div>
              <div class="brand-sub">Company detail</div>
            </div>
            ${renderTabNav("companies")}
          </div>
        </header>

        <main class="main">
          <a class="detail-back" href="#/" id="back-link">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
            All companies
          </a>

          <div class="detail-header">
            ${logoHtml(company, "lg")}
            <div class="detail-header-text">
              <h1>${escapeHtml(company.name)}</h1>
              <p class="detail-one-liner">${escapeHtml(company.one_liner || "")}</p>
              <div class="detail-pills">
                ${company.source ? `<span class="badge ${sourceBadgeClass}">${escapeHtml(sourceLabel)}</span>` : ""}
                ${company.source === "yc" && company.batch_short ? `<span class="badge badge-batch">${escapeHtml(company.batch_short)}</span>` : ""}
                ${company.cohort && company.source !== "yc" ? `<span class="badge badge-cohort">${escapeHtml(company.cohort)}</span>` : ""}
                ${company.industry ? `<span class="pill pill-industry">${escapeHtml(company.industry)}</span>` : ""}
                ${tags}
                ${company.has_rebrand ? `<span class="badge badge-rebrand">Rebrand</span>` : ""}
                ${company.is_hiring ? `<span class="badge badge-hiring"><span class="hiring-dot" aria-hidden="true"></span>Hiring</span>` : ""}
              </div>
              <div class="detail-actions">
                <button type="button" class="btn ${watched ? "btn-watch-on" : "btn-secondary"}" data-watch-slug="${escapeHtml(company.slug)}" aria-pressed="${watched}">
                  ${starSvg(watched)}
                  ${watched ? "On watchlist" : "Add to watchlist"}
                </button>
                ${company.website ? `<a class="btn btn-primary" href="${escapeHtml(company.website)}" target="_blank" rel="noopener noreferrer">Website<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg></a>` : ""}
                ${company.yc_url ? `<a class="btn btn-secondary" href="${escapeHtml(company.yc_url)}" target="_blank" rel="noopener noreferrer">${getProfileLinkLabel(company.source)}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg></a>` : ""}
              </div>
            </div>
          </div>

          <div class="sections">
            <section class="section">
              <h2>About</h2>
              <div class="section-body">${about}</div>
            </section>

            <section class="section">
              <h2>Positioning</h2>
              <dl class="meta-grid">
                <div class="meta-item"><dt>Source</dt><dd>${escapeHtml(company.source_label || company.source || "—")}</dd></div>
                <div class="meta-item"><dt>Cohort / Batch</dt><dd>${escapeHtml(company.cohort || company.batch || "—")}</dd></div>
                <div class="meta-item"><dt>Industry</dt><dd>${escapeHtml(company.industry || "—")}</dd></div>
                <div class="meta-item"><dt>Subindustry</dt><dd>${escapeHtml(company.subindustry || "—")}</dd></div>
                <div class="meta-item"><dt>Stage</dt><dd>${escapeHtml(company.stage || "—")}</dd></div>
                <div class="meta-item"><dt>Status</dt><dd>${escapeHtml(company.status || "—")}</dd></div>
                <div class="meta-item"><dt>Team size</dt><dd>${escapeHtml(teamSize)}</dd></div>
                <div class="meta-item"><dt>Locations</dt><dd>${escapeHtml(company.locations || "—")}</dd></div>
                <div class="meta-item"><dt>Tags</dt><dd>${(company.tags || []).length ? escapeHtml((company.tags || []).join(", ")) : "—"}</dd></div>
              </dl>
            </section>

            ${former}

            <section class="section">
              <h2>Signals</h2>
              <div class="section-body">
                Hiring: <strong>${company.is_hiring ? "Yes" : "No"}</strong>
                ${company.has_rebrand ? " · Rebrand / pivot detected" : ""}
                · Watchlist: <strong>${watched ? "Saved" : "Not saved"}</strong>
              </div>
              <p class="signals-note">Raises &amp; pivots tracking comes later — this is a quiet placeholder for v1.</p>
            </section>
          </div>
        </main>
      </div>
    `;

    window.scrollTo(0, 0);

    const watchBtn = app.querySelector("[data-watch-slug]");
    if (watchBtn) {
      watchBtn.addEventListener("click", () => {
        toggleWatch(company.slug);
        renderDetail(company.slug);
      });
    }
  }

  // ——— Render: Jobs List ———

  function getJobStats() {
    if (!jobsData) return { total: 0, fits: {}, statuses: {}, remotes: {}, healthBadges: {} };
    const fits = {};
    const statuses = {};
    const remotes = {};
    const healthBadges = {};
    for (const j of jobsData) {
      fits[j.fit] = (fits[j.fit] || 0) + 1;
      statuses[j.status] = (statuses[j.status] || 0) + 1;
      remotes[j.remote] = (remotes[j.remote] || 0) + 1;
      const badge = j.healthBadge || "Unknown";
      healthBadges[badge] = (healthBadges[badge] || 0) + 1;
    }
    return { total: jobsData.length, fits, statuses, remotes, healthBadges };
  }

  function renderJobs() {
    const stats = getJobStats();
    const filtered = applyJobFilters(jobsData);
    const active = hasActiveJobFilters();
    const watchCount = jobsWatchlist.size;

    const fitOrder = ["Very High", "High", "Medium", "Low", "Very Low"];
    const fitEntries = Object.entries(stats.fits).sort((a, b) => {
      const ai = fitOrder.indexOf(a[0]);
      const bi = fitOrder.indexOf(b[0]);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    const statusOrder = ["Watch", "Applied", "Closed", "Passed"];
    const statusEntries = Object.entries(stats.statuses).sort((a, b) => {
      const ai = statusOrder.indexOf(a[0]);
      const bi = statusOrder.indexOf(b[0]);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    const remoteOrder = ["Yes", "Hybrid", "No"];
    const remoteEntries = Object.entries(stats.remotes).sort((a, b) => {
      const ai = remoteOrder.indexOf(a[0]);
      const bi = remoteOrder.indexOf(b[0]);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    const healthOrder = ["Healthy", "Watch", "Caution", "Unknown"];
    const healthEntries = Object.entries(stats.healthBadges).sort((a, b) => {
      const ai = healthOrder.indexOf(a[0]);
      const bi = healthOrder.indexOf(b[0]);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    const fitChips = fitEntries
      .map(([name, count]) => {
        const pressed = jobFilters.fits.includes(name);
        return `<button type="button" class="chip" data-filter="fit" data-value="${escapeHtml(name)}" aria-pressed="${pressed}">${escapeHtml(name)}<span class="chip-count">${count}</span></button>`;
      })
      .join("");

    const statusChips = statusEntries
      .map(([name, count]) => {
        const pressed = jobFilters.statuses.includes(name);
        return `<button type="button" class="chip" data-filter="status" data-value="${escapeHtml(name)}" aria-pressed="${pressed}">${escapeHtml(name)}<span class="chip-count">${count}</span></button>`;
      })
      .join("");

    const remoteChips = remoteEntries
      .map(([name, count]) => {
        const pressed = jobFilters.remotes.includes(name);
        const label = name === "Yes" ? "Remote" : name === "No" ? "On-site" : name;
        return `<button type="button" class="chip" data-filter="remote" data-value="${escapeHtml(name)}" aria-pressed="${pressed}">${escapeHtml(label)}<span class="chip-count">${count}</span></button>`;
      })
      .join("");

    const healthChips = healthEntries
      .map(([name, count]) => {
        const pressed = jobFilters.healthBadges.includes(name);
        const cls = `chip chip-health chip-health-${name.toLowerCase()}`;
        return `<button type="button" class="${cls}" data-filter="health" data-value="${escapeHtml(name)}" aria-pressed="${pressed}">${escapeHtml(name)}<span class="chip-count">${count}</span></button>`;
      })
      .join("");

    let cards;
    if (filtered.length === 0) {
      const emptyWatch =
        jobFilters.watchlistOnly && watchCount === 0
          ? `<div class="empty" role="status">
            <h2>Your jobs watchlist is empty</h2>
            <p>Star jobs from the grid or a detail page to save them here.</p>
            <button type="button" class="btn btn-secondary" data-action="clear-watchlist-filter">Show all jobs</button>
          </div>`
          : `<div class="empty" role="status">
            <h2>No jobs match</h2>
            <p>Try clearing filters or adjusting your search.</p>
            <button type="button" class="btn btn-secondary" data-action="clear">Clear filters</button>
          </div>`;
      cards = emptyWatch;
    } else {
      cards = `<div class="grid" role="list">${filtered.map(renderJobCard).join("")}</div>`;
    }

    app.innerHTML = `
      <div class="shell">
        <header class="topbar">
          <div class="topbar-inner">
            <div class="brand">
              <div class="brand-title">
                <h1>Opportunity Platform</h1>
              </div>
              <div class="brand-sub">
                Discovered roles
              </div>
            </div>
            ${renderTabNav("jobs")}
          </div>
        </header>

        <main class="main">
          <div class="page-header">
            <h2 class="page-title">Jobs</h2>
            <div class="stat-chips" aria-label="Job stats">
              <span class="stat-chip"><strong>${stats.total}</strong> jobs</span>
              <span class="stat-chip"><strong>${fitEntries.filter(([f]) => f === "Very High" || f === "High").reduce((s, [, c]) => s + c, 0)}</strong> high fit</span>
              <button type="button" class="stat-chip watchlist-stat ${jobFilters.watchlistOnly ? "active" : ""}" data-action="watchlist" aria-pressed="${jobFilters.watchlistOnly}" title="Show watchlist">
                ${starSvg(true)}<strong>${watchCount}</strong> watchlist
              </button>
            </div>
          </div>

          <section class="filters" aria-label="Filters">
            <div class="filters-row">
              <div class="search-wrap">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
                <input type="search" class="search-input" id="job-search" placeholder="Search company, role…" value="${escapeHtml(jobFilters.q)}" autocomplete="off" spellcheck="false" aria-label="Search jobs" />
                <span class="kbd-hint" aria-hidden="true">/</span>
              </div>
              <button type="button" class="toggle-pill ${jobFilters.watchlistOnly ? "is-on" : ""}" data-action="watchlist" aria-pressed="${jobFilters.watchlistOnly}">
                ${starSvg(jobFilters.watchlistOnly)}
                Watchlist${watchCount ? ` (${watchCount})` : ""}
              </button>
              <button type="button" class="clear-btn" data-action="clear" ${active ? "" : "hidden"}>Clear filters</button>
            </div>

            <div class="filter-section">
              <div class="filter-label">Fit</div>
              <div class="chip-scroll" role="group" aria-label="Filter by fit">${fitChips}</div>
            </div>

            <div class="filter-section">
              <div class="filter-label">Status</div>
              <div class="chip-scroll" role="group" aria-label="Filter by status">${statusChips}</div>
            </div>

            <div class="filter-section">
              <div class="filter-label">Remote</div>
              <div class="chip-scroll" role="group" aria-label="Filter by remote">${remoteChips}</div>
            </div>

            <div class="filter-section">
              <div class="filter-label">Company Health</div>
              <div class="chip-scroll" role="group" aria-label="Filter by company health">${healthChips}</div>
            </div>
          </section>

          <div class="results-bar">
            <span>Showing <strong>${filtered.length}</strong> of ${jobFilters.watchlistOnly ? watchCount + " watched" : stats.total}</span>
          </div>

          ${cards}
        </main>

        <p class="footer-stub">Browse-only</p>
      </div>
    `;

    bindJobsEvents();
  }

  function getFitClass(fit) {
    switch (fit) {
      case "Very High":
        return "fit-very-high";
      case "High":
        return "fit-high";
      case "Medium":
        return "fit-medium";
      case "Low":
        return "fit-low";
      default:
        return "";
    }
  }

  function getStatusClass(status) {
    switch (status) {
      case "Watch":
        return "status-watch";
      case "Applied":
        return "status-applied";
      case "Closed":
        return "status-closed";
      case "Passed":
        return "status-passed";
      default:
        return "";
    }
  }

  function getHealthBadgeClass(badge) {
    switch (badge) {
      case "Healthy":
        return "health-healthy";
      case "Watch":
        return "health-watch";
      case "Caution":
        return "health-caution";
      default:
        return "health-unknown";
    }
  }

  function getHealthSummaryLine(job) {
    if (job.layoff && job.layoff.flag && job.layoff.summary) {
      return job.layoff.summary;
    }
    if (job.funding && job.funding.summary) {
      return job.funding.summary;
    }
    return null;
  }

  function renderHealthSection(job) {
    const badge = job.healthBadge || "Unknown";
    const badgeClass = getHealthBadgeClass(badge);

    let fundingHtml = "";
    if (job.funding && job.funding.summary) {
      const fundingDate = job.funding.date ? ` (${escapeHtml(job.funding.date)})` : "";
      fundingHtml = `
        <div class="health-row">
          <span class="health-label">Funding</span>
          <span class="health-value">${escapeHtml(job.funding.summary)}${fundingDate}</span>
          ${job.funding.sourceUrl ? `<a class="health-link" href="${escapeHtml(job.funding.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg></a>` : ""}
        </div>
      `;
    }

    let layoffHtml = "";
    if (job.layoff && job.layoff.flag) {
      const layoffDate = job.layoff.date ? ` (${escapeHtml(job.layoff.date)})` : "";
      layoffHtml = `
        <div class="health-row health-row-layoff">
          <span class="health-label">Layoff</span>
          <span class="health-value">${escapeHtml(job.layoff.summary || "Reported")}${layoffDate}</span>
          ${job.layoff.sourceUrl ? `<a class="health-link" href="${escapeHtml(job.layoff.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg></a>` : ""}
        </div>
      `;
    }

    let headcountHtml = "";
    if (job.headcount && job.headcount.summary) {
      headcountHtml = `
        <div class="health-row">
          <span class="health-label">Headcount</span>
          <span class="health-value">${escapeHtml(job.headcount.summary)}${job.headcount.source ? ` (${escapeHtml(job.headcount.source)})` : ""}</span>
        </div>
      `;
    }

    let checkedHtml = "";
    if (job.healthCheckedAt) {
      checkedHtml = `
        <div class="health-row health-row-meta">
          <span class="health-label">Last checked</span>
          <span class="health-value">${escapeHtml(formatDate(job.healthCheckedAt))}</span>
        </div>
      `;
    }

    let evidenceHtml = "";
    if (job.healthEvidence && job.healthEvidence.length > 0) {
      const links = job.healthEvidence.map((url, i) => 
        `<a class="health-evidence-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Evidence ${i + 1}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg></a>`
      ).join("");
      evidenceHtml = `
        <div class="health-row health-row-evidence">
          <span class="health-label">Evidence</span>
          <div class="health-evidence-links">${links}</div>
        </div>
      `;
    }

    const hasContent = fundingHtml || layoffHtml || headcountHtml || checkedHtml || evidenceHtml;

    return `
      <section class="section section-health">
        <h2>Company Health</h2>
        <div class="health-content">
          <div class="health-badge-row">
            <span class="badge badge-health badge-health-lg ${badgeClass}">${escapeHtml(badge)}</span>
          </div>
          ${hasContent ? `
          <div class="health-details">
            ${fundingHtml}
            ${layoffHtml}
            ${headcountHtml}
            ${checkedHtml}
            ${evidenceHtml}
          </div>
          ` : `<p class="health-no-data">No detailed health data available for this company.</p>`}
        </div>
      </section>
    `;
  }

  function renderJobCard(j) {
    const watched = isJobWatched(j.id);
    const fitClass = getFitClass(j.fit);
    const statusClass = getStatusClass(j.status);
    const healthBadge = j.healthBadge || "Unknown";
    const healthClass = getHealthBadgeClass(healthBadge);
    const healthSummary = getHealthSummaryLine(j);

    const remoteBadge = j.remote === "Yes"
      ? `<span class="badge badge-remote">Remote</span>`
      : j.remote === "Hybrid"
      ? `<span class="badge badge-hybrid">Hybrid</span>`
      : "";

    const blurbHtml = j.companyBlurb
      ? `<p class="card-blurb">${escapeHtml(j.companyBlurb)}</p>`
      : "";

    const healthStripHtml = `
      <div class="health-strip">
        <span class="badge badge-health ${healthClass}">${escapeHtml(healthBadge)}</span>
        ${healthSummary ? `<span class="health-summary">${escapeHtml(healthSummary)}</span>` : ""}
      </div>
    `;

    return `
      <div class="card-wrap" role="listitem">
        <button type="button" class="watch-btn ${watched ? "is-watched" : ""}" data-watch-job="${escapeHtml(j.id)}" aria-pressed="${watched}" aria-label="${watched ? "Remove from watchlist" : "Add to watchlist"}" title="${watched ? "Remove from watchlist" : "Add to watchlist"}">
          ${starSvg(watched)}
        </button>
        <a class="card job-card" href="#/jobs/${encodeURIComponent(j.id)}" data-job-id="${escapeHtml(j.id)}">
          <div class="card-top">
            ${jobLogoHtml(j)}
            <div class="card-meta">
              <div class="card-name-row">
                <h2 class="card-name">${escapeHtml(j.company)}</h2>
                ${remoteBadge}
              </div>
              ${blurbHtml}
              <p class="card-one-liner job-role">${escapeHtml(j.role)}</p>
            </div>
          </div>
          ${healthStripHtml}
          <div class="card-pills">
            <span class="pill pill-fit ${fitClass}">${escapeHtml(j.fit)}</span>
            <span class="pill pill-status ${statusClass}">${escapeHtml(j.status)}</span>
            ${j.location ? `<span class="pill">${escapeHtml(j.location)}</span>` : ""}
          </div>
        </a>
      </div>
    `;
  }

  function rerenderJobsPreserving(focusId, selectEnd) {
    const y = window.scrollY;
    saveJobFilters();
    renderJobs();
    window.scrollTo(0, y);
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) {
        el.focus();
        if (selectEnd && typeof el.setSelectionRange === "function") {
          const len = el.value.length;
          el.setSelectionRange(len, len);
        }
      }
    }
  }

  function bindJobsEvents() {
    const search = document.getElementById("job-search");
    if (search) {
      let t = null;
      search.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(() => {
          jobFilters.q = search.value;
          rerenderJobsPreserving("job-search", true);
        }, 120);
      });
    }

    app.querySelectorAll('[data-filter="fit"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = btn.getAttribute("data-value");
        const idx = jobFilters.fits.indexOf(v);
        if (idx >= 0) jobFilters.fits.splice(idx, 1);
        else jobFilters.fits.push(v);
        rerenderJobsPreserving(null, false);
      });
    });

    app.querySelectorAll('[data-filter="status"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = btn.getAttribute("data-value");
        const idx = jobFilters.statuses.indexOf(v);
        if (idx >= 0) jobFilters.statuses.splice(idx, 1);
        else jobFilters.statuses.push(v);
        rerenderJobsPreserving(null, false);
      });
    });

    app.querySelectorAll('[data-filter="remote"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = btn.getAttribute("data-value");
        const idx = jobFilters.remotes.indexOf(v);
        if (idx >= 0) jobFilters.remotes.splice(idx, 1);
        else jobFilters.remotes.push(v);
        rerenderJobsPreserving(null, false);
      });
    });

    app.querySelectorAll('[data-filter="health"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = btn.getAttribute("data-value");
        const idx = jobFilters.healthBadges.indexOf(v);
        if (idx >= 0) jobFilters.healthBadges.splice(idx, 1);
        else jobFilters.healthBadges.push(v);
        rerenderJobsPreserving(null, false);
      });
    });

    app.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-action");
        if (action === "watchlist") {
          jobFilters.watchlistOnly = !jobFilters.watchlistOnly;
          rerenderJobsPreserving(null, false);
        } else if (action === "clear-watchlist-filter") {
          jobFilters.watchlistOnly = false;
          rerenderJobsPreserving(null, false);
        } else if (action === "clear") {
          jobFilters.q = "";
          jobFilters.fits = [];
          jobFilters.statuses = [];
          jobFilters.remotes = [];
          jobFilters.healthBadges = [];
          jobFilters.watchlistOnly = false;
          rerenderJobsPreserving(null, false);
        }
      });
    });

    app.querySelectorAll("[data-watch-job]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute("data-watch-job");
        toggleJobWatch(id);
        rerenderJobsPreserving(null, false);
      });
    });

    app.querySelectorAll("a.job-card").forEach((a) => {
      a.addEventListener("click", () => {
        saveJobFilters();
      });
    });
  }

  // ——— Render: Job Detail ———

  function renderJobDetail(id) {
    const job = jobsData.find((j) => j.id === id);
    if (!job) {
      app.innerHTML = `
        <div class="shell">
          <header class="topbar">
            <div class="topbar-inner">
              <div class="brand">
                <div class="brand-title"><h1>Opportunity Platform</h1></div>
              </div>
              ${renderTabNav("jobs")}
            </div>
          </header>
          <main class="main">
            <div class="not-found">
              <h1>Job not found</h1>
              <p>No job matches <code>${escapeHtml(id)}</code>.</p>
              <a class="btn btn-primary" href="#/jobs">Back to jobs</a>
            </div>
          </main>
        </div>
      `;
      return;
    }

    const watched = isJobWatched(job.id);
    const fitClass = getFitClass(job.fit);
    const statusClass = getStatusClass(job.status);

    const remoteBadge = job.remote === "Yes"
      ? `<span class="badge badge-remote">Remote</span>`
      : job.remote === "Hybrid"
      ? `<span class="badge badge-hybrid">Hybrid</span>`
      : job.remote === "No"
      ? `<span class="badge badge-onsite">On-site</span>`
      : "";

    const blurbSection = job.companyBlurb
      ? `<p class="detail-blurb">${escapeHtml(job.companyBlurb)}</p>`
      : "";

    app.innerHTML = `
      <div class="shell">
        <header class="topbar">
          <div class="topbar-inner">
            <div class="brand">
              <div class="brand-title"><h1>Opportunity Platform</h1></div>
              <div class="brand-sub">Job detail</div>
            </div>
            ${renderTabNav("jobs")}
          </div>
        </header>

        <main class="main">
          <a class="detail-back" href="#/jobs" id="back-link">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
            All jobs
          </a>

          <div class="detail-header">
            ${jobLogoHtml(job, "lg")}
            <div class="detail-header-text">
              <p class="detail-company-name">${escapeHtml(job.company)}</p>
              ${blurbSection}
              <h1>${escapeHtml(job.role)}</h1>
              <p class="detail-one-liner">${job.location ? escapeHtml(job.location) : ""}${job.location && job.compensation ? " · " : ""}${job.compensation ? escapeHtml(job.compensation) : ""}</p>
              <div class="detail-pills">
                <span class="pill pill-fit ${fitClass}">${escapeHtml(job.fit)} Fit</span>
                <span class="pill pill-status ${statusClass}">${escapeHtml(job.status)}</span>
                ${remoteBadge}
              </div>
              <div class="detail-actions">
                <button type="button" class="btn ${watched ? "btn-watch-on" : "btn-secondary"}" data-watch-job="${escapeHtml(job.id)}" aria-pressed="${watched}">
                  ${starSvg(watched)}
                  ${watched ? "On watchlist" : "Add to watchlist"}
                </button>
                ${job.website ? `<a class="btn btn-secondary" href="${escapeHtml(job.website)}" target="_blank" rel="noopener noreferrer">Website<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg></a>` : ""}
                ${job.url ? `<a class="btn btn-primary" href="${escapeHtml(job.url)}" target="_blank" rel="noopener noreferrer">Apply on ${escapeHtml(job.source || "ATS")}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg></a>` : ""}
                ${job.briefUrl ? `<a class="btn btn-secondary" href="${escapeHtml(job.briefUrl)}" target="_blank" rel="noopener noreferrer">Job Brief<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg></a>` : ""}
              </div>
            </div>
          </div>

          <div class="sections">
            ${job.whyItFits ? `
            <section class="section">
              <h2>Why It Fits</h2>
              <div class="section-body">${escapeHtml(job.whyItFits)}</div>
            </section>
            ` : ""}

            ${job.watchouts ? `
            <section class="section">
              <h2>Watchouts</h2>
              <div class="section-body">${escapeHtml(job.watchouts)}</div>
            </section>
            ` : ""}

            ${renderHealthSection(job)}

            <section class="section">
              <h2>Details</h2>
              <dl class="meta-grid">
                <div class="meta-item"><dt>Company</dt><dd>${escapeHtml(job.company || "—")}</dd></div>
                <div class="meta-item"><dt>Role</dt><dd>${escapeHtml(job.role || "—")}</dd></div>
                <div class="meta-item"><dt>Role Family</dt><dd>${escapeHtml(job.roleFamily || "—")}</dd></div>
                <div class="meta-item"><dt>Fit</dt><dd><span class="pill pill-fit ${fitClass}">${escapeHtml(job.fit || "—")}</span></dd></div>
                <div class="meta-item"><dt>Location</dt><dd>${escapeHtml(job.location || "—")}</dd></div>
                <div class="meta-item"><dt>Remote</dt><dd>${escapeHtml(job.remote || "—")}</dd></div>
                <div class="meta-item"><dt>Compensation</dt><dd>${escapeHtml(job.compensation || "—")}</dd></div>
                <div class="meta-item"><dt>Source</dt><dd>${escapeHtml(job.source || "—")}</dd></div>
                <div class="meta-item"><dt>Status</dt><dd><span class="pill pill-status ${statusClass}">${escapeHtml(job.status || "—")}</span></dd></div>
                <div class="meta-item"><dt>Date Found</dt><dd>${escapeHtml(formatDate(job.dateFound))}</dd></div>
                <div class="meta-item"><dt>Last Checked</dt><dd>${escapeHtml(formatDate(job.lastChecked))}</dd></div>
              </dl>
            </section>

            ${job.notes ? `
            <section class="section">
              <h2>Notes</h2>
              <div class="section-body">${escapeHtml(job.notes)}</div>
            </section>
            ` : ""}
          </div>
        </main>
      </div>
    `;

    window.scrollTo(0, 0);

    const watchBtn = app.querySelector("[data-watch-job]");
    if (watchBtn) {
      watchBtn.addEventListener("click", () => {
        toggleJobWatch(job.id);
        renderJobDetail(job.id);
      });
    }
  }

  // ——— Router ———

  function route() {
    if (!data || !jobsData) return;
    const r = parseRoute();
    if (r.name === "home") {
      renderHome();
      restoreScroll();
    } else if (r.name === "company") {
      renderDetail(r.slug);
    } else if (r.name === "jobs") {
      renderJobs();
      restoreJobsScroll();
    } else if (r.name === "job") {
      renderJobDetail(r.id);
    } else {
      app.innerHTML = `
        <div class="shell">
          <header class="topbar">
            <div class="topbar-inner">
              <div class="brand">
                <div class="brand-title"><h1>Opportunity Platform</h1></div>
              </div>
              ${renderTabNav("")}
            </div>
          </header>
          <main class="main">
            <div class="not-found">
              <h1>Page not found</h1>
              <p>That route doesn't exist.</p>
              <a class="btn btn-primary" href="#/">Back to companies</a>
            </div>
          </main>
        </div>
      `;
    }
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) {
        return;
      }
      const search = document.getElementById("search") || document.getElementById("job-search");
      if (search) {
        e.preventDefault();
        search.focus();
        search.select();
      }
    }
  });

  window.addEventListener("hashchange", route);

  async function boot() {
    loadFilters();
    loadWatchlist();
    loadJobFilters();
    loadJobsWatchlist();

    try {
      const [dataRes, jobsRes] = await Promise.all([
        fetch("./data.json", { cache: "no-cache" }),
        fetch("./jobs.json", { cache: "no-cache" }),
      ]);

      if (!dataRes.ok) throw new Error(`Companies HTTP ${dataRes.status}`);
      if (!jobsRes.ok) throw new Error(`Jobs HTTP ${jobsRes.status}`);

      data = await dataRes.json();
      jobsData = await jobsRes.json();

      if (!location.hash || location.hash === "#") {
        location.replace("#/");
      }
      route();
    } catch (err) {
      app.innerHTML = `
        <div class="error-state">
          <h1>Couldn't load data</h1>
          <p>Serve this folder over HTTP (e.g. <code>python -m http.server</code>) so <code>data.json</code> and <code>jobs.json</code> can be fetched. ${escapeHtml(err && err.message)}</p>
        </div>
      `;
      console.error(err);
    }
  }

  boot();
})();
