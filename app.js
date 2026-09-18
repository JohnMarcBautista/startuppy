/**
 * YC S26 Company Watch — vanilla SPA
 * Hash routes: #/  #/companies  #/company/{slug}
 */

(() => {
  "use strict";

  const STORAGE_KEY = "yc-s26-filters-v1";
  const WATCHLIST_KEY = "yc-s26-watchlist-v1";
  const TOP_TAGS_VISIBLE = 12;

  /** @type {null | {
   *   batch: string, batch_short: string, pulled_at: string,
   *   company_count: number, hiring_count: number, rebrand_count: number,
   *   industry_summary: Record<string, number>,
   *   top_tags: Record<string, number>,
   *   companies: Company[]
   * }} */
  let data = null;

  /** @typedef {{
   *   id: number, name: string, slug: string, one_liner: string, description: string,
   *   industry: string, subindustry: string, tags: string[], website: string, yc_url: string,
   *   logo: string, locations: string, team_size: number|null, status: string,
   *   is_hiring: boolean, stage: string, former_names: string[], has_rebrand: boolean,
   *   batch: string, regions: string[]
   * }} Company */

  /** @type {{ q: string, industries: string[], tags: string[], rebrandOnly: boolean, watchlistOnly: boolean, tagsExpanded: boolean, tagQuery: string }} */
  let filters = {
    q: "",
    industries: [],
    tags: [],
    rebrandOnly: false,
    watchlistOnly: false,
    tagsExpanded: false,
    tagQuery: "",
  };

  /** @type {Set<string>} */
  let watchlist = new Set();

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
    const payload = {
      version: 1,
      exported_at: new Date().toISOString(),
      batch: (data && data.batch_short) || "S26",
      slugs,
      companies: slugs.map((slug) => {
        const c = bySlug.get(slug);
        return c
          ? { slug, name: c.name, one_liner: c.one_liner, industry: c.industry, yc_url: c.yc_url }
          : { slug };
      }),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `yc-s26-watchlist-${new Date().toISOString().slice(0, 10)}.json`;
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

  function starSvg(filled) {
    if (filled) {
      return `<svg class="star-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5l2.9 6.1 6.7.7-5 4.6 1.4 6.6L12 17.8 5.99 20.5 7.4 13.9l-5-4.6 6.7-.7L12 2.5z"/></svg>`;
    }
    return `<svg class="star-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.7.7-5 4.6 1.4 6.6L12 17.8 5.99 20.5 7.4 13.9l-5-4.6 6.7-.7L12 2.5z"/></svg>`;
  }

  function loadFilters() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      filters = {
        q: typeof parsed.q === "string" ? parsed.q : "",
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
    return (
      filters.q.trim() !== "" ||
      filters.industries.length > 0 ||
      filters.tags.length > 0 ||
      filters.rebrandOnly ||
      filters.watchlistOnly
    );
  }

  function parseRoute() {
    const hash = (location.hash || "#/").replace(/^#/, "") || "/";
    const path = hash.split("?")[0];
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

  // ——— Filtering ———

  function applyFilters(companies) {
    const q = filters.q.trim().toLowerCase();
    const indSet = new Set(filters.industries);
    const tagSet = new Set(filters.tags);

    return companies.filter((c) => {
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

  // ——— Render: Home ———

  function renderHome() {
    const industries = Object.entries(data.industry_summary).sort(
      (a, b) => b[1] - a[1]
    );
    const topTags = Object.entries(data.top_tags).sort((a, b) => b[1] - a[1]);
    const filtered = applyFilters(data.companies);
    const active = hasActiveFilters();
    const watchCount = watchlist.size;

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

    app.innerHTML = `
      <div class="shell">
        <header class="topbar">
          <div class="topbar-inner">
            <div class="brand">
              <div class="brand-title">
                <h1>YC S26</h1>
                <span class="brand-badge">${escapeHtml(data.batch_short)}</span>
              </div>
              <div class="brand-sub">
                <strong>${data.company_count}</strong> companies · Updated ${escapeHtml(formatPulledAt(data.pulled_at))}
              </div>
            </div>
            <div class="stat-chips" aria-label="Batch stats">
              <span class="stat-chip"><strong>${data.company_count}</strong> companies</span>
              <span class="stat-chip"><strong>${industries.length}</strong> industries</span>
              <span class="stat-chip"><strong>${data.rebrand_count}</strong> rebrands</span>
              <span class="stat-chip secondary"><strong>${data.hiring_count}</strong> hiring</span>
              <button type="button" class="stat-chip watchlist-stat ${filters.watchlistOnly ? "active" : ""}" data-action="watchlist" aria-pressed="${filters.watchlistOnly}" title="Show watchlist">
                ${starSvg(true)}<strong>${watchCount}</strong> watchlist
              </button>
            </div>
          </div>
        </header>

        <main class="main">
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
            <span>Showing <strong>${filtered.length}</strong> of ${filters.watchlistOnly ? watchCount + " watched" : data.company_count}</span>
          </div>

          ${cards}
        </main>

        <p class="footer-stub">Trends &amp; compare coming later · Browse-only for S26</p>
      </div>
    `;

    bindHomeEvents();
  }

  function renderCard(c) {
    const tags = (c.tags || []).slice(0, 3);
    const watched = isWatched(c.slug);
    const badges = [
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

  // ——— Render: Detail ———

  function renderDetail(slug) {
    const company = data.companies.find((c) => c.slug === slug);
    if (!company) {
      app.innerHTML = `
        <div class="shell">
          <main class="main">
            <div class="not-found">
              <h1>Company not found</h1>
              <p>No company matches <code>${escapeHtml(slug)}</code> in the S26 batch.</p>
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
              <div class="brand-title">
                <h1>YC S26</h1>
                <span class="brand-badge">${escapeHtml(data.batch_short)}</span>
              </div>
              <div class="brand-sub">Company detail</div>
            </div>
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
                ${company.yc_url ? `<a class="btn btn-secondary" href="${escapeHtml(company.yc_url)}" target="_blank" rel="noopener noreferrer">YC profile<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg></a>` : ""}
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
                <div class="meta-item"><dt>Industry</dt><dd>${escapeHtml(company.industry || "—")}</dd></div>
                <div class="meta-item"><dt>Subindustry</dt><dd>${escapeHtml(company.subindustry || "—")}</dd></div>
                <div class="meta-item"><dt>Stage</dt><dd>${escapeHtml(company.stage || "—")}</dd></div>
                <div class="meta-item"><dt>Status</dt><dd>${escapeHtml(company.status || "—")}</dd></div>
                <div class="meta-item"><dt>Team size</dt><dd>${escapeHtml(teamSize)}</dd></div>
                <div class="meta-item"><dt>Locations</dt><dd>${escapeHtml(company.locations || "—")}</dd></div>
                <div class="meta-item"><dt>Batch</dt><dd>${escapeHtml(company.batch || data.batch)}</dd></div>
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

  // ——— Router ———

  function route() {
    if (!data) return;
    const r = parseRoute();
    if (r.name === "home") {
      renderHome();
      restoreScroll();
    } else if (r.name === "company") {
      renderDetail(r.slug);
    } else {
      app.innerHTML = `
        <div class="shell">
          <main class="main">
            <div class="not-found">
              <h1>Page not found</h1>
              <p>That route doesn’t exist.</p>
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
      const search = document.getElementById("search");
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
    try {
      const res = await fetch("./data.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
      if (!location.hash || location.hash === "#") {
        location.replace("#/");
      }
      route();
    } catch (err) {
      app.innerHTML = `
        <div class="error-state">
          <h1>Couldn’t load data</h1>
          <p>Serve this folder over HTTP (e.g. <code>python -m http.server</code>) so <code>data.json</code> can be fetched. ${escapeHtml(err && err.message)}</p>
        </div>
      `;
      console.error(err);
    }
  }

  boot();
})();
