// -*- coding: utf-8 -*-
// app.js - table-style list + click-to-view images

let allEntries = [];
let filteredEntries = [];
let filteredEntriesAll = [];
let selectedEntryId = null;
let suggestionsContainer = null;

// Paging-ish clamp for giant result sets
let filteredTotalCount = 0;   // how many entries actually matched filters
let filteredClamped = false;  // true if we're in the "default clamp" state
let suppressSuggestionsOnce = false;

// pagination config
// pagination config
const DEFAULT_PAGE_SIZE = 50;   // normal "page" size
const MAX_ROWS_PER_PAGE = 100;  // HARD cap: never render more than this many rows at once

let pageSize = DEFAULT_PAGE_SIZE;
let currentPage = 1;

// --- Sync backend config ----------------------------------------------------

// Set this to wherever FastAPI is deployed.
// For local dev use: "http://localhost:8000"
const SYNC_API_BASE = "https://anime-va-profile-server.onrender.com";
const IMAGE_BASE_URL = "https://raw.githubusercontent.com/cjw525/anime-va-images/main";
const IMAGE_VERSION = "2025-12-12_13-33-40"; // for cache-busting if needed

// Later we'll let users pick this; for now, just "jades"
let activeProfileId = null;
let activeProfileLabel = null;

// Remote per-entry state keyed by "LANG-id"
let activeProfileState = {};

let langButtonsWired = false;

const SYNC_API_KEY = "";

function setActiveTab(tab) {
  if ((tab === "search" || tab === "list") && !activeProfileId) {
    const summary = document.getElementById("resultsSummary");
    if (summary) summary.textContent = "Choose a profile first (Profile tab).";
    tab = "profile";
  }

  const tabProfile = document.getElementById("tabProfile");
  const tabSearch = document.getElementById("tabSearch");
  const tabList = document.getElementById("tabList");

  const profileView = document.getElementById("profileView");
  const searchView = document.getElementById("searchView");
  const listView = document.getElementById("listView");

  const isProfile = tab === "profile";
  const isSearch = tab === "search";
  const isList = tab === "list";

  // Tabs UI
  if (tabProfile) {
    tabProfile.classList.toggle("selected", isProfile);
    tabProfile.setAttribute("aria-selected", isProfile ? "true" : "false");
  }
  if (tabSearch) {
    tabSearch.classList.toggle("selected", isSearch);
    tabSearch.setAttribute("aria-selected", isSearch ? "true" : "false");
  }
  if (tabList) {
    tabList.classList.toggle("selected", isList);
    tabList.setAttribute("aria-selected", isList ? "true" : "false");
  }

  // Views
  if (profileView) profileView.style.display = isProfile ? "block" : "none";
  if (searchView) searchView.style.display = isSearch ? "block" : "none";
  if (listView) listView.style.display = isList ? "block" : "none";

  // If they open List and we have data, render it
  if (isList) renderAnimeListView();

  // If they open Search with no profile chosen, be nice about it
  if (isSearch && !activeProfileId) {
    const summary = document.getElementById("resultsSummary");
    if (summary) summary.textContent = "Choose a profile first (Profile tab).";
  }
}

function renderAnimeListView() {
  const container = document.getElementById("animeListContainer");
  if (!container) return;

  if (!allEntries.length) {
    container.innerHTML = "<p class='summary-text'>No database loaded yet.</p>";
    return;
  }

  // Build unique anime list with simple seen aggregation
  const map = new Map(); // anime -> { anime, total, seenCount }
  for (const entry of allEntries) {
    const anime = getField(entry, ["anime"], "Unknown anime");
    if (!map.has(anime)) {
      map.set(anime, { anime, total: 0, seenCount: 0 });
    }
    const rec = map.get(anime);
    rec.total += 1;

    const seenRaw = getSeenValue(entry);
    const seenNorm = normalizeSeen(seenRaw);
    if (seenNorm === "seen") rec.seenCount += 1;
  }

  const rows = Array.from(map.values()).sort((a, b) =>
    a.anime.toLowerCase().localeCompare(b.anime.toLowerCase())
  );

  container.innerHTML = "";

  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "result-row";

    const main = document.createElement("div");
    main.className = "result-main";

    const title = document.createElement("span");
    title.className = "result-title";
    title.textContent = r.anime;

    const meta = document.createElement("div");
    meta.className = "result-meta";

    const pct =
      r.total > 0 ? Math.round((r.seenCount / r.total) * 100) : 0;

    meta.textContent = `${r.seenCount}/${r.total} entries seen (${pct}%)`;

    main.appendChild(title);
    row.appendChild(main);
    row.appendChild(meta);

    row.addEventListener("click", () => {
      // Jump to Search tab filtered to this anime
      setActiveTab("search");
      quickSearchFromText(r.anime);
    });

    container.appendChild(row);
  }
}

function wireLanguageButtonsOnce() {
  if (langButtonsWired) return;
  langButtonsWired = true;

  const engBtn = document.getElementById("langEng");
  const jpnBtn = document.getElementById("langJpn");
  const bothBtn = document.getElementById("langBoth");

  if (engBtn)
    engBtn.addEventListener("click", () => {
      markLangSelected("ENG");
      loadDataFor("ENG");
    });

  if (jpnBtn)
    jpnBtn.addEventListener("click", () => {
      markLangSelected("JPN");
      loadDataFor("JPN");
    });

  if (bothBtn)
    bothBtn.addEventListener("click", () => {
      markLangSelected("BOTH");
      loadDataFor("BOTH");
    });
}

function markLangSelected(lang) {
  const engBtn = document.getElementById("langEng");
  const jpnBtn = document.getElementById("langJpn");
  const bothBtn = document.getElementById("langBoth");

  [engBtn, jpnBtn, bothBtn].forEach((b) => b && b.classList.remove("selected"));

  if (lang === "ENG" && engBtn) engBtn.classList.add("selected");
  if (lang === "JPN" && jpnBtn) jpnBtn.classList.add("selected");
  if (lang === "BOTH" && bothBtn) bothBtn.classList.add("selected");
}

function updateProfileUi() {
  const label = document.getElementById("activeProfileLabel");
  const pill = document.getElementById("profilePill");

  const hasProfile = !!activeProfileId;

  const displayName = hasProfile
    ? activeProfileLabel || activeProfileId
    : null;

  if (label) {
    label.textContent = hasProfile
      ? `Profile: ${displayName}`
      : "Choose a profile to begin.";
  }

  if (pill) {
    pill.textContent = hasProfile ? displayName : "No profile";
    pill.classList.toggle("is-empty", !hasProfile);
  }
}

// --- Cache / SW helpers -----------------------------------------------------

async function clearPwaCacheAndSw() {
  const result = {
    removedCaches: [],
    unregistered: false,
  };

  // Clear our caches
  if ("caches" in window) {
    const keys = await caches.keys();
    // Only nuke caches that belong to this app
    const ourKeys = keys.filter((k) => k.startsWith("anime-va-cache"));
    await Promise.all(
      ourKeys.map(async (k) => {
        const ok = await caches.delete(k);
        if (ok) result.removedCaches.push(k);
      })
    );
  }

  // Unregister service workers for this origin
  if ("serviceWorker" in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    if (regs.length > 0) {
      result.unregistered = true;
      await Promise.all(regs.map((r) => r.unregister()));
    }
  }

  return result;
}

function handleClearCacheClick() {
  const statusEl = document.getElementById("clearCacheStatus");
  if (statusEl) {
    statusEl.textContent = "Clearing app cache…";
  }

  clearPwaCacheAndSw()
    .then((info) => {
      console.log("Cache clear result:", info);
      if (statusEl) {
        if (info.removedCaches.length || info.unregistered) {
          statusEl.textContent = "Cache cleared. Reloading…";
        } else {
          statusEl.textContent =
            "No app cache found, reloading with fresh assets…";
        }
      }
      // Give the text a moment to show, then hard reload
      setTimeout(() => {
        window.location.reload();
      }, 500);
    })
    .catch((err) => {
      console.error("Error clearing cache", err);
      if (statusEl) {
        statusEl.textContent =
          "Error clearing cache. Check console for details.";
      }
    });
}

function getField(entry, possibleKeys, fallback = "") {
  for (const key of possibleKeys) {
    if (entry[key] !== undefined && entry[key] !== null) {
      return String(entry[key]);
    }
  }
  return fallback;
}

function normalizeSeen(valueRaw) {
  if (valueRaw === true || valueRaw === "true") return "seen";
  if (valueRaw === false || valueRaw === "false") return "unseen";

  const v = (valueRaw || "").toString().toLowerCase();
  if (!v) return "";
  if (v.startsWith("seen") || v === "y" || v === "yes") return "seen";
  if (v.startsWith("unseen") || v === "n" || v === "no") return "unseen";
  if (v.includes("plan") || v.includes("hold")) return "planning";
  return "";
}

function normalizeSearchText(s) {
  if (!s) return "";
  // Strip accents (NFKD decompose + remove combining marks)
  let out = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  out = out.toLowerCase();

  // Optional: basic romaji long-vowel collapse
  out = out.replace(/([ou])u/g, "$1")  // ou -> o, uu -> u
           .replace(/([ou])\1+/g, "$1"); // oo -> o, ooo -> o

  // Collapse whitespace
  out = out.trim().split(/\s+/).join(" ");
  return out;
}

function makeEntryKey(entry) {
  const lang = (entry.language || "").toString().toUpperCase() || "ENG";
  const id = entry.id != null ? String(entry.id) : "";
  return `${lang}-${id}`;
}

function getSeenValue(entry) {
  const key = makeEntryKey(entry);
  const remote = activeProfileState[key];

  if (remote && typeof remote.seen === "boolean") {
    // normalizeSeen already handles boolean true/false
    return remote.seen;
  }

  // Fallback to whatever is in the JSON
  return entry["seen"];
}

async function fetchProfileState(profileId) {
  try {
    const url = `${SYNC_API_BASE}/profiles/${encodeURIComponent(profileId)}/state`;
    const headers = {};
    if (SYNC_API_KEY) {
      headers["X-API-Key"] = SYNC_API_KEY;
    }

    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      console.error("Failed to load profile state", resp.status);
      activeProfileState = {};
      return;
    }

    const data = await resp.json();
    activeProfileState = data.entries || {};
    console.log("Loaded profile state for", profileId, activeProfileState);
  } catch (err) {
    console.error("Error fetching profile state", err);
    activeProfileState = {};
  }
}

async function updateProfileEntry(entry, updates) {
  const key = makeEntryKey(entry);

  const payload = {
    device_id: "mobile-pwa",
    updates: [
      {
        key,
        seen: updates.seen ?? false,
        tbr: updates.tbr ?? false,
        updated: new Date().toISOString()
      }
    ]
  };

  const headers = { "Content-Type": "application/json" };
  if (SYNC_API_KEY) headers["X-API-Key"] = SYNC_API_KEY;

  const resp = await fetch(
    `${SYNC_API_BASE}/profiles/${activeProfileId}/entries`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify(payload)
    }
  );

  if (!resp.ok) {
    console.error("Failed to update profile entry", await resp.text());
    return false;
  }

  // Optimistic local update
  activeProfileState[key] = {
    seen: payload.updates[0].seen,
    tbr: payload.updates[0].tbr,
    updated: payload.updates[0].updated,
    updated_by: payload.device_id
  };

  return true;
}

// No media type in mobile JSON yet; leave this as a stub.
function normalizeType(valueRaw) {
  return "";
}

function buildLocalImagePath(raw, entry) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";

  // Already a full/relative URL? Pass through unchanged.
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
    return trimmed;
  }

  // Normalize: strip old local prefixes like images/eng/ or eng/
  let filename = trimmed
    .replace(/^images\//i, "")
    .replace(/^eng\//i, "")
    .replace(/^jpn\//i, "");

  const lang = (entry.language || "").toString().toLowerCase();
  let folder = "eng";
  if (lang.includes("jpn") || lang === "jp") {
    folder = "jpn";
  }

  // Final URL into the new images repo
 return `${IMAGE_BASE_URL}/${folder}/${filename}?v=${encodeURIComponent(
    IMAGE_VERSION
  )}`;
}

function getCharacterImageUrl(entry) {
  const raw = getField(entry, ["characterImage"], "").trim();
  if (!raw) return "";

  // direct URL passthrough
  if (
    raw.startsWith("http://") ||
    raw.startsWith("https://") ||
    raw.startsWith("./") ||
    raw.startsWith("../")
  ) {
    return raw;
  }

  return buildLocalImagePath(raw, entry);
}

function getVaImageUrl(entry) {
  const raw = getField(entry, ["voiceActorImage"], "").trim();
  if (!raw) return "";

  // direct URL passthrough
  if (
    raw.startsWith("http://") ||
    raw.startsWith("https://") ||
    raw.startsWith("./") ||
    raw.startsWith("../")
  ) {
    return raw;
  }

  return buildLocalImagePath(raw, entry);
}

function applyFilters() {
  const searchInput = document.getElementById("searchInput");
  const seenFilter = document.getElementById("seenFilter");
  const typeFilter = document.getElementById("typeFilter");
  const hasImageFilter = document.getElementById("hasImageFilter");
  const sortSelect = document.getElementById("sortSelect");

  // NEW: when filters/search change, default back to list view on mobile
  const layout = document.querySelector(".results-layout");
  const isMobile = window.matchMedia("(max-width: 767px)").matches;
  if (layout && isMobile) {
    layout.classList.remove("detail-active");
  }

  const rawQuery = (searchInput.value || "").trim();
  updateSuggestions(rawQuery);

  const qNorm = normalizeSearchText(rawQuery);
  const qTokens = qNorm ? qNorm.split(" ") : [];

  const seenVal = seenFilter.value;
  const typeVal = typeFilter.value;
  const onlyWithImage = hasImageFilter.checked;
  const sortBy = sortSelect.value;

  let results = [...allEntries];

  // Search across anime, character, VA
  if (qTokens.length > 0) {
    results = results.filter((entry) => {
      const anime = getField(entry, ["anime"]);
      const character = getField(entry, ["character"]);
      const va = getField(entry, ["voiceActor", "voice_actor", "va"]);
      const haystackNorm = normalizeSearchText(`${anime} ${character} ${va}`);

      const hayTokens = new Set(haystackNorm.split(" "));

      if (qTokens.length === 1) {
        // Keep substring behavior for single-word fuzzy matches
        const q = qTokens[0];
        return haystackNorm.includes(q);
      }

      // Multi-word: require all query tokens to appear (order-agnostic)
      return qTokens.every((t) => hayTokens.has(t));
    });
  }

  // Seen filter
  if (seenVal !== "all") {
    results = results.filter((entry) => {
      const raw = getSeenValue(entry);
      return normalizeSeen(raw) === seenVal;
    });
  }

  // Type filter: no-op for now because mobile JSON has no type
  if (false && typeVal !== "all") {
    results = results.filter((entry) => {
      const raw = getField(entry, ["media_type", "type", "format"]);
      return normalizeType(raw) === typeVal;
    });
  }

  // Only entries that have at least one image
  if (onlyWithImage) {
    results = results.filter((entry) => {
      return !!(getCharacterImageUrl(entry) || getVaImageUrl(entry));
    });
  }

  // Sort
  results.sort((a, b) => {
    let aKey = "";
    let bKey = "";

    if (sortBy === "anime") {
      aKey = getField(a, ["anime"]);
      bKey = getField(b, ["anime"]);
    } else if (sortBy === "character") {
      aKey = getField(a, ["character"]);
      bKey = getField(b, ["character"]);
    } else if (sortBy === "va") {
      aKey = getField(a, ["voiceActor", "voice_actor", "va"]);
      bKey = getField(b, ["voiceActor", "voice_actor", "va"]);
    }

    aKey = aKey.toLowerCase();
    bKey = bKey.toLowerCase();
    return aKey.localeCompare(bKey);
  });

  // --- Finalize filtered results + pagination setup ---
  // How many entries actually matched all filters
  filteredTotalCount = results.length;

  filteredEntriesAll = results;

  // "Default" state = no search text, no special filters
  const isSearchBlank = !qNorm;
  const isDefaultFilters =
    seenVal === "all" &&
    typeVal === "all" &&
    !onlyWithImage;

  // Adjust this to taste
  const CLAMP_LIMIT = 250;

  // Decide clamp
  if (isSearchBlank && isDefaultFilters && results.length > CLAMP_LIMIT) {
    filteredClamped = true;

    // Clamp DISPLAY list to first CLAMP_LIMIT
    filteredEntries = results.slice(0, CLAMP_LIMIT);

    // Page size stays capped by your render safety limit
    pageSize = Math.min(DEFAULT_PAGE_SIZE, MAX_ROWS_PER_PAGE);
  } else {
    filteredClamped = false;
    filteredEntries = results;
    pageSize = Math.min(DEFAULT_PAGE_SIZE, MAX_ROWS_PER_PAGE);
  }

  // New filter/search = go back to first page and clear selection
  currentPage = 1;
  selectedEntryId = null;

  renderList();
  updateSummary();
  clearDetailPanelIfNeeded();

  // NEW: auto-open only when there is EXACTLY ONE result,
  // and the user actually searched or changed filters
  const shouldAutoOpenSingle =
    filteredEntries.length === 1 &&
    (!isSearchBlank || !isDefaultFilters);

  if (shouldAutoOpenSingle) {
    selectEntry(filteredEntries[0]);
  }
}

function updateSummary() {
  const summary = document.getElementById("resultsSummary");
  if (!summary) return;

  const totalInDb = allEntries.length;

  // No DB loaded yet
  if (!totalInDb) {
    summary.textContent = "Loading database...";
    return;
  }

  // Total matches across ALL filters (truth)
  const totalMatchesAll =
    (typeof filteredTotalCount === "number" && filteredTotalCount >= 0)
      ? filteredTotalCount
      : (Array.isArray(filteredEntriesAll) ? filteredEntriesAll.length : filteredEntries.length);

  // What we're actually paging through right now
  const totalForPaging = filteredClamped ? filteredEntries.length : totalMatchesAll;

  // DB loaded but nothing matches
  if (!totalMatchesAll) {
    summary.textContent =
      "Database loaded. Type in the search box or use filters to see entries.";
    return;
  }

  const effectivePageSize = Math.min(pageSize || DEFAULT_PAGE_SIZE, MAX_ROWS_PER_PAGE);

  const totalPages =
    effectivePageSize > 0
      ? Math.max(1, Math.ceil(totalForPaging / effectivePageSize))
      : 1;

  const safeCurrentPage = Math.min(Math.max(currentPage || 1, 1), totalPages);

  const startIndex = (safeCurrentPage - 1) * effectivePageSize;
  const endIndex = Math.min(startIndex + effectivePageSize, totalForPaging);
  const shownNow = Math.max(0, endIndex - startIndex);

  if (filteredClamped) {
    // We're paging through ONLY the clamped display slice (e.g. first 250)
    summary.textContent =
      `Showing ${shownNow} of the first ${totalForPaging} matching entries ` +
      `(page ${safeCurrentPage} of ${totalPages}). ` +
      `There are ${totalMatchesAll} total matches — click "Show All" to page through everything.`;
  } else {
    // Normal case: paging through all matches
    summary.textContent =
      `Showing ${shownNow} of ${totalInDb} entries ` +
      `(page ${safeCurrentPage} of ${totalPages}, ` +
      `${totalMatchesAll} match your filters).`;
  }
}

function quickSearchFromText(text) {
  const searchInput = document.getElementById("searchInput");
  if (!searchInput) return;

  const value = (text || "").toString().trim();
  if (!value) return;

  // Put it into the search box
  searchInput.value = value;

  // Optional: don't pop suggestions for this one programmatic change
  suppressSuggestionsOnce = true;

  // Run the normal filtering pipeline
  applyFilters();
}

function updateSuggestions(q) {
  if (!suggestionsContainer) return;

  suggestionsContainer.innerHTML = "";

  if (suppressSuggestionsOnce) {
    suggestionsContainer.style.display = "none";
    suggestionsContainer.innerHTML = "";
    suppressSuggestionsOnce = false;
    return;
  }

  const norm = normalizeSearchText(q);
  const qTokens = norm ? norm.split(" ") : [];

  // Hide suggestions if nothing typed or DB not ready
  if (!qTokens.length || !allEntries.length) {
    suggestionsContainer.style.display = "none";
    return;
  }

  const matches = [];

  for (const entry of allEntries) {
    const anime = getField(entry, ["anime"]);
    const character = getField(entry, ["character"]);
    const va = getField(entry, ["voiceActor", "voice_actor", "va"]);

    const candidates = [
      { label: character, type: "Character", entry },
      { label: anime, type: "Anime", entry },
      { label: va, type: "Voice Actor", entry },
    ];

    for (const cand of candidates) {
      if (!cand.label) continue;

      const labelNorm = normalizeSearchText(cand.label);
      if (!labelNorm) continue;

      if (qTokens.length === 1) {
        // single-word: substring for nice partial matching
        if (labelNorm.includes(qTokens[0])) {
          matches.push(cand);
        }
      } else {
        // multi-word: bag-of-words against this label
        const labelTokens = new Set(labelNorm.split(" "));
        if (qTokens.every((t) => labelTokens.has(t))) {
          matches.push(cand);
        }
      }
    }
  }

  // Deduplicate + limit to ~8 entries (same as you already had)
  const seen = new Set();
  const unique = [];
  for (const m of matches) {
    const key = `${m.type}:${m.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(m);
    if (unique.length >= 8) break;
  }

  if (!unique.length) {
    suggestionsContainer.style.display = "none";
    return;
  }

  for (const m of unique) {
    const item = document.createElement("div");
    item.className = "suggestion-item";
    item.textContent = `${m.label} · ${m.type}`;

    item.addEventListener("click", () => {
      const input = document.getElementById("searchInput");
      if (input) {
        input.value = m.label;
      }

      suppressSuggestionsOnce = true;
      suggestionsContainer.style.display = "none";

      // Run a normal filter on that text
      applyFilters();
    });

    suggestionsContainer.appendChild(item);
  }

  suggestionsContainer.style.display = "block";
}

function renderList() {
  const container = document.getElementById("cardsContainer");
  if (!container) return;

  container.innerHTML = "";

  const totalMatches = filteredEntries.length;

  if (!totalMatches) {
    const msg = document.createElement("p");
    msg.className = "summary-text";
    msg.textContent =
      "No entries match your filters yet. Try searching or adjusting filters.";
    container.appendChild(msg);
    updatePaginationControls(0, 1, 0, 0);
    return;
  }

  // Never render more than MAX_ROWS_PER_PAGE at once
  const effectivePageSize = Math.min(pageSize, MAX_ROWS_PER_PAGE);

  // For now we only really use page 1, but wire it correctly
  const totalPages =
    effectivePageSize > 0
      ? Math.max(1, Math.ceil(totalMatches / effectivePageSize))
      : 1;

  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const startIndex = (currentPage - 1) * effectivePageSize;
  const endIndex = Math.min(startIndex + effectivePageSize, totalMatches);
  const pageEntries = filteredEntries.slice(startIndex, endIndex);

  for (const entry of pageEntries) {
    const anime = getField(entry, ["anime"], "Unknown anime");
    const character = getField(entry, ["character"], "Unknown character");
    const va = getField(entry, ["voiceActor", "voice_actor", "va"], "Unknown VA");
    const seenRaw = getSeenValue(entry);
    const seenNorm = normalizeSeen(seenRaw);
    const year = getField(entry, ["year"], "");

    const row = document.createElement("div");
    row.className = "result-row";
    if (entry.id === selectedEntryId) {
      row.classList.add("selected");
    }

    const main = document.createElement("div");
    main.className = "result-main";

    // Character
    const titleSpan = document.createElement("span");
    titleSpan.className = "result-title result-clickable"; // <-- Make clickable
    titleSpan.textContent = character;

    // Anime
    const animeSpan = document.createElement("span");
    animeSpan.className = "result-anime result-clickable"; // <-- Make clickable
    animeSpan.textContent = anime;

    main.appendChild(titleSpan);
    main.appendChild(document.createElement("br"));
    main.appendChild(animeSpan);

    // VA row
    const meta = document.createElement("div");
    meta.className = "result-meta";

    // Label
    const vaLabel = document.createElement("span");
    vaLabel.textContent = "VA: ";

    // VA name (clickable)
    const vaSpan = document.createElement("span");
    vaSpan.className = "result-va-name result-clickable";
    vaSpan.textContent = va;

    meta.appendChild(vaLabel);
    meta.appendChild(vaSpan);

    row.appendChild(main);
    row.appendChild(meta);

    // Existing single-click: open detail panel
    row.addEventListener("click", () => {
      selectEntry(entry);
    });

    // NEW: double-click to quick-search

    titleSpan.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      quickSearchFromText(character);
    });

    animeSpan.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      quickSearchFromText(anime);
    });

    vaSpan.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      quickSearchFromText(va);
    });

    container.appendChild(row);
  }
  // If we later add prev/next buttons, we'd update them here
  updatePaginationControls(totalPages, currentPage, effectivePageSize, totalMatches);
}

function updatePaginationControls(totalPages, currentPage, effectivePageSize, totalMatches) {
  const controls = document.getElementById("paginationControls");
  const prevBtn = document.getElementById("prevPageBtn");
  const nextBtn = document.getElementById("nextPageBtn");
  const pageInfo = document.getElementById("pageInfo");

  if (!controls || !prevBtn || !nextBtn || !pageInfo) return;

  // If there are no matches or only one page, hide controls
  if (!totalMatches || totalPages <= 1) {
    controls.style.display = "none";
    return;
  }

  controls.style.display = "flex";   // or "block", depending on your CSS

  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;

  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
}

function clearDetailPanelIfNeeded() {
  if (selectedEntryId !== null) return;
  const panel = document.getElementById("detailPanel");
  if (!panel) return;
  panel.innerHTML =
    "<p class='summary-text'>Select an entry to see details and images.</p>";
}

function selectEntry(entry) {
  selectedEntryId = entry.id;

  // Re-render list so selected row is highlighted
  renderList();

  const panel = document.getElementById("detailPanel");
  if (!panel) return;

  const layout = document.querySelector(".results-layout");
  const isMobile = window.matchMedia("(max-width: 767px)").matches;

  // On mobile, switch to "detail view" (hide list, show panel)
  if (layout && isMobile) {
    layout.classList.add("detail-active");
  }

  const anime = getField(entry, ["anime"], "Unknown anime");
  const character = getField(entry, ["character"], "Unknown character");
  const va = getField(entry, ["voiceActor", "voice_actor", "va"], "Unknown VA");
  const seenRaw = getSeenValue(entry);
  const seenNorm = normalizeSeen(seenRaw);
  const year = getField(entry, ["year"], "");
  const appearsIn = getField(entry, ["appearsIn", "appears_in"], "");

  panel.innerHTML = "";

  // --- Back button (visible only on mobile via CSS) ---
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "detail-back-button";
  backBtn.textContent = "← Back to results";

  backBtn.addEventListener("click", () => {
    const layoutEl = document.querySelector(".results-layout");
    if (layoutEl) {
      layoutEl.classList.remove("detail-active");
    }

    // Clear selection highlight and reset detail panel text
    selectedEntryId = null;
    renderList();
    clearDetailPanelIfNeeded();

    const list = document.getElementById("cardsContainer");
    if (list) {
      list.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  panel.appendChild(backBtn);

  // --- Header / labels ---
  const header = document.createElement("div");
  header.className = "detail-header";

  // Character label block
  const charLabel = document.createElement("div");
  charLabel.className = "detail-label-block";

  const charLabelTitle = document.createElement("div");
  charLabelTitle.className = "detail-label-title";
  charLabelTitle.textContent = "Character";

  const charValue = document.createElement("div");
  charValue.className = "detail-label-value";
  charValue.textContent = character;

  charLabel.appendChild(charLabelTitle);
  charLabel.appendChild(charValue);
  header.appendChild(charLabel);

  // Anime label block
  const animeLabel = document.createElement("div");
  animeLabel.className = "detail-label-block";

  const animeLabelTitle = document.createElement("div");
  animeLabelTitle.className = "detail-label-title";
  animeLabelTitle.textContent = "Anime";

  const animeValue = document.createElement("div");
  animeValue.className = "detail-label-value";
  animeValue.textContent = anime;

  animeLabel.appendChild(animeLabelTitle);
  animeLabel.appendChild(animeValue);
  header.appendChild(animeLabel);

  // Voice actor label block
  const vaLabel = document.createElement("div");
  vaLabel.className = "detail-label-block";

  const vaLabelTitle = document.createElement("div");
  vaLabelTitle.className = "detail-label-title";
  vaLabelTitle.textContent = "Voice Actor";

  const vaValue = document.createElement("div");
  vaValue.className = "detail-label-value";
  vaValue.textContent = va;

  vaLabel.appendChild(vaLabelTitle);
  vaLabel.appendChild(vaValue);
  header.appendChild(vaLabel);

  // Seen / year row (if you already had this, keep it; otherwise you can lift your old code here)
  const meta = document.createElement("p");
  meta.className = "detail-meta";

  const parts = [];
  if (seenNorm === "seen") {
    parts.push("Seen ✅");
  } else if (seenNorm === "unseen") {
    parts.push("Not seen ❌");
  } else if (seenNorm === "planning") {
    parts.push("Planning / On-Hold 📚");
  }
  if (year) {
    parts.push(`Year: ${year}`);
  }
  if (appearsIn) {
    parts.push(`Appears in: ${appearsIn}`);
  }

  meta.textContent = parts.join(" • ");
  header.appendChild(meta);

  panel.appendChild(header);

  const controls = document.createElement("div");
  controls.className = "detail-controls";

  const seenBtn = document.createElement("button");
  seenBtn.textContent =
    seenNorm === "seen" ? "Mark Unseen ❌" : "Mark Seen ✅";

  seenBtn.addEventListener("click", async () => {
    const newSeen = seenNorm !== "seen";
    await updateProfileEntry(entry, { seen: newSeen, tbr: false });
    applyFilters(); // re-render list + filters
    selectEntry(entry); // refresh detail panel
  });

  controls.appendChild(seenBtn);
  panel.appendChild(controls);

  // --- IMAGES – ONLY LOADED FOR THE SELECTED ENTRY ---
  const imagesWrapper = document.createElement("div");
  imagesWrapper.className = "detail-images";

  const charUrl = getCharacterImageUrl(entry);
  const vaUrl = getVaImageUrl(entry);

  if (charUrl) {
    const charBlock = document.createElement("div");
    charBlock.className = "detail-image-block";

    const img = document.createElement("img");
    img.src = charUrl;
    img.alt = `Character: ${character}`;
    img.loading = "lazy";

    const label = document.createElement("div");
    label.className = "detail-image-label";
    label.textContent = "Character";

    charBlock.appendChild(img);
    charBlock.appendChild(label);
    imagesWrapper.appendChild(charBlock);
  }

  if (vaUrl) {
    const vaBlock = document.createElement("div");
    vaBlock.className = "detail-image-block";

    const img = document.createElement("img");
    img.src = vaUrl;
    img.alt = `Voice actor: ${va}`;
    img.loading = "lazy";

    const label = document.createElement("div");
    label.className = "detail-image-label";
    label.textContent = "Voice Actor";

    vaBlock.appendChild(img);
    vaBlock.appendChild(label);
    imagesWrapper.appendChild(vaBlock);
  }

  if (imagesWrapper.childElementCount > 0) {
    panel.appendChild(imagesWrapper);
  } else {
    const noImg = document.createElement("p");
    noImg.className = "summary-text";
    noImg.textContent = "No images available for this entry.";
    panel.appendChild(noImg);
  }

  // Make sure the detail panel is visible on mobile
  if (isMobile) {
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function hookControls() {
  const searchInput = document.getElementById("searchInput");
  const seenFilter = document.getElementById("seenFilter");
  const typeFilter = document.getElementById("typeFilter");
  const hasImageFilter = document.getElementById("hasImageFilter");
  const sortSelect = document.getElementById("sortSelect");
  const showAllBtn = document.getElementById("showAllBtn");
  const clearAllBtn = document.getElementById("clearAllBtn");
  const clearCacheBtn = document.getElementById("clearCacheBtn");
  const prevPageBtn = document.getElementById("prevPageBtn");
  const nextPageBtn = document.getElementById("nextPageBtn");

  suggestionsContainer = document.getElementById("searchSuggestions");

  // Click outside suggestions = hide dropdown
  document.addEventListener("click", (event) => {
    if (!suggestionsContainer || !searchInput) return;

    const target = event.target;

    // If click is on the input or inside the suggestions, ignore it
    if (target === searchInput || suggestionsContainer.contains(target)) {
      return;
    }

    // Otherwise, hide the dropdown
    suggestionsContainer.style.display = "none";
  });

  // Live filters
  if (searchInput) searchInput.addEventListener("input", applyFilters);
  if (seenFilter) seenFilter.addEventListener("change", applyFilters);
  if (typeFilter) typeFilter.addEventListener("change", applyFilters);
  if (hasImageFilter) hasImageFilter.addEventListener("change", applyFilters);
  if (sortSelect) sortSelect.addEventListener("change", applyFilters);

  // "Show All" = bump pageSize up to the hard max, but DO NOT render 6000 rows
  if (showAllBtn) {
    showAllBtn.addEventListener("click", () => {
      const layoutEl = document.querySelector(".results-layout");
      if (layoutEl) layoutEl.classList.remove("detail-active");

      // UNCLAMP: show ALL matches (but still page + respect render cap)
      filteredClamped = false;
      filteredEntries = filteredEntriesAll;

      // Keep your per-page safety limit
      pageSize = Math.min(pageSize || DEFAULT_PAGE_SIZE, MAX_ROWS_PER_PAGE);

      currentPage = 1;

      renderList();
      updateSummary();
    });
  }

  // Clear all filters and reset paging
  if (clearAllBtn) {
    clearAllBtn.addEventListener("click", () => {
      if (searchInput) searchInput.value = "";
      if (seenFilter) seenFilter.value = "all";
      if (typeFilter) typeFilter.value = "all";
      if (hasImageFilter) hasImageFilter.checked = false;
      if (sortSelect) sortSelect.value = "anime";

      filteredEntries = [];
      filteredTotalCount = 0;
      selectedEntryId = null;
      pageSize = DEFAULT_PAGE_SIZE;
      currentPage = 1;

      // Make sure we're in list view again on mobile
      const layoutEl = document.querySelector(".results-layout");
      if (layoutEl) {
        layoutEl.classList.remove("detail-active");
      }

      renderList();
      updateSummary();
      clearDetailPanelIfNeeded();
    });
  }

  if (clearCacheBtn) {
    clearCacheBtn.addEventListener("click", handleClearCacheClick);
  }

  if (prevPageBtn) {
    prevPageBtn.addEventListener("click", () => {
      if (currentPage > 1) {
        currentPage--;
        renderList();
        updateSummary();
      }
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener("click", () => {
      currentPage += 1;
      renderList();
      updateSummary();
    });
  }
}

async function loadDataFor(language) {
  try {
    let urls = [];

    if (language === "ENG") {
      urls = ["../data/anime_va_eng.json"];
    } else if (language === "JPN") {
      urls = ["../data/anime_va_jpn.json"];
    } else {
      urls = [
        "../data/anime_va_eng.json",
        "../data/anime_va_jpn.json"
      ];
    }

    let combined = [];

    for (const url of urls) {
      const resp = await fetch(url, { cache: "no-store" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const arr = Array.isArray(data) ? data : data.data || [];

      // Figure out the language for THIS file
      let sourceLang = "";
      if (url.toLowerCase().includes("_eng")) {
        sourceLang = "ENG";
      } else if (url.toLowerCase().includes("_jpn")) {
        sourceLang = "JPN";
      } else {
        sourceLang = language; // fallback
      }

      // Tag entries from this file
      arr.forEach(entry => {
        if (!entry.language) {
          entry.language = sourceLang;
        }
      });

      combined = combined.concat(arr);
    }

    allEntries = combined;
    filteredEntries = [];
    selectedEntryId = null;

    // Optional: switching DBs also returns to list view
    const layoutEl = document.querySelector(".results-layout");
    if (layoutEl) {
      layoutEl.classList.remove("detail-active");
    }
    // Fetch remote profile state for seen status (read-only sync v0.1)
    await fetchProfileState(activeProfileId);

    applyFilters();

    const container = document.getElementById("cardsContainer");
    if (container) {
      container.innerHTML =
        "<p class='summary-text'>Database loaded. Type in the search box or use filters to see entries.</p>";
    }

    clearDetailPanelIfNeeded();
    updateSummary();
  } catch (err) {
    console.error("Failed to load DB", err);
    const container = document.getElementById("cardsContainer");
    if (container) {
      container.innerHTML =
        "<p class='summary-text'>Error loading chosen database(s). Check console.</p>";
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  hookControls();

  const tabProfile = document.getElementById("tabProfile");
  const tabSearch = document.getElementById("tabSearch");
  const tabList = document.getElementById("tabList");
  const profilePill = document.getElementById("profilePill");
  
  if (profilePill) profilePill.addEventListener("click", () => setActiveTab("profile"));
  if (tabProfile) tabProfile.addEventListener("click", () => setActiveTab("profile"));
  if (tabSearch) tabSearch.addEventListener("click", () => setActiveTab("search"));
  if (tabList) tabList.addEventListener("click", () => setActiveTab("list"));

  // Profile chooser buttons (simple profiles)
  document.querySelectorAll(".profile-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const profileId = btn.getAttribute("data-profile");
      if (!profileId) return;

      activeProfileId = profileId;
      activeProfileLabel = btn.testContent.trim();
      activeProfileState = {};
      updateProfileUi();
      // Make sure language buttons are wired exactly once
      wireLanguageButtonsOnce();
      setActiveTab("search");
      markLangSelected("ENG");
      loadDataFor("ENG");
    });
  });

  // On launch, open Profile tab (so they must choose)
  setActiveTab("profile");
  updateProfileUi();
});