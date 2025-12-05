// app.js - table-style list + click-to-view images

let allEntries = [];
let filteredEntries = [];
let selectedEntryId = null;
let suggestionsContainer = null;
// Paging-ish clamp for giant result sets
let filteredTotalCount = 0;   // how many entries actually matched filters
let filteredClamped = false;  // true if we only show the first chunk
let forceShowAllOnce = false; // used by the "Show All" button to bypass clamping
let suppressSuggestionsOnce = false;

// --- Sync backend config ----------------------------------------------------

// Set this to wherever FastAPI is deployed.
// For local dev use: "http://localhost:8000"
const SYNC_API_BASE = "https://anime-va-profile-server.onrender.com";

// Later we'll let users pick this; for now, just "jades"
let activeProfileId = "jades";

// Remote per-entry state keyed by "LANG-id"
let activeProfileState = {};

// Optional: if you set AV_SYNC_API_KEY on the server, put that value here.
// If you don't set it, leave this as "".
const SYNC_API_KEY = "";

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

// Utility: safely pull fields
function getField(entry, possibleKeys, fallback = "") {
  for (const key of possibleKeys) {
    if (entry[key] !== undefined && entry[key] !== null) {
      return String(entry[key]);
    }
  }
  return fallback;
}

// Our JSON uses a boolean "seen" field.
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

// Get the "effective" seen value for an entry, preferring remote state if present.
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

// No media type in mobile JSON yet; leave this as a stub.
function normalizeType(valueRaw) {
  return "";
}

function buildLocalImagePath(raw, entry) {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  // Already an explicit path (e.g., "images/eng/foo.png", "eng/foo.png", "jpn/bar.jpg")
  if (
    trimmed.startsWith("images/") ||
    trimmed.startsWith("eng/") ||
    trimmed.startsWith("jpn/")
  ) {
    // If it already starts with "images/", just return as-is
    if (trimmed.startsWith("images/")) {
      return trimmed;
    }
    // Otherwise, hang it off /images
    return `images/${trimmed}`;
  }

  // Bare filename: choose folder based on language
  const lang = (entry.language || "").toString().toLowerCase();

  if (lang.includes("jpn") || lang === "jp") {
    return `images/jpn/${trimmed}`;
  }

  // Default to ENG folder
  return `images/eng/${trimmed}`;
}

// Character image URL
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

// VA image URL
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

  // --- Finalize filtered results, with an optional clamp ---

  // How many entries actually matched all filters
  filteredTotalCount = results.length;

  // "Default" state = no search text, no special filters
  const isSearchBlank = !qNorm;
  const isDefaultFilters =
    seenVal === "all" &&
    typeVal === "all" &&
    !onlyWithImage;

  // Adjust this to taste
  const CLAMP_LIMIT = 250;

  // Only clamp when:
  // - user hasn't typed a search
  // - filters are at their default
  // - we have a LOT of results
  // - AND the Show All button didn't just explicitly ask for everything
  const shouldClamp =
    !forceShowAllOnce &&
    isSearchBlank &&
    isDefaultFilters &&
    results.length > CLAMP_LIMIT;

  if (shouldClamp) {
    filteredEntries = results.slice(0, CLAMP_LIMIT);
    filteredClamped = true;
  } else {
    filteredEntries = results;
    filteredClamped = false;
  }

  // Reset this after we've honored it once
  forceShowAllOnce = false;
  selectedEntryId = null;
  renderList();
  updateSummary();
  clearDetailPanelIfNeeded();
  // 🔥 NEW: auto-open only when there is EXACTLY ONE result,
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

  const total = allEntries.length;
  const shown = filteredEntries.length;

  if (!total) {
    summary.textContent = "Loading database...";
  } else if (!shown) {
    summary.textContent =
      "Database loaded. Type in the search box or use filters to see entries.";
  } else if (filteredClamped && filteredTotalCount > shown) {
    // We clamped a giant list
    summary.textContent = `Showing first ${shown} of ${filteredTotalCount} matching entries. Add a search or filters, or tap "Show All" if you really want everything.`;
  } else {
    // Normal case
    summary.textContent = `Showing ${shown} of ${total} entries.`;
  }
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

  if (!filteredEntries.length) {
    const msg = document.createElement("p");
    msg.className = "summary-text";
    msg.textContent =
      "No entries match your filters yet. Try searching or adjusting filters.";
    container.appendChild(msg);
    return;
  }

  for (const entry of filteredEntries) {
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

    // main line: Character — Anime
    const main = document.createElement("div");
    main.className = "result-main";

    const titleSpan = document.createElement("span");
    titleSpan.className = "result-title";
    titleSpan.textContent = character;

    const animeSpan = document.createElement("span");
    animeSpan.className = "result-anime";
    animeSpan.textContent = anime;

    main.appendChild(titleSpan);
    main.appendChild(document.createElement("br"));
    main.appendChild(animeSpan);

    // meta: VA + Seen
    const meta = document.createElement("div");
    meta.className = "result-meta";
    meta.textContent = `VA: ${va}`;

    const tags = document.createElement("div");
    tags.className = "result-tags";

    row.appendChild(main);
    row.appendChild(meta);
    
    row.addEventListener("click", () => {
      selectEntry(entry);
    });

    container.appendChild(row);
  }
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
    parts.push("Planning / On-Hold 📝");
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

  suggestionsContainer = document.getElementById("searchSuggestions");

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

  if (searchInput) searchInput.addEventListener("input", applyFilters);
  if (seenFilter) seenFilter.addEventListener("change", applyFilters);
  if (typeFilter) typeFilter.addEventListener("change", applyFilters);
  if (hasImageFilter) hasImageFilter.addEventListener("change", applyFilters);
  if (sortSelect) sortSelect.addEventListener("change", applyFilters);

    if (showAllBtn) {
    showAllBtn.addEventListener("click", () => {
      // Clear the search, but explicitly bypass the clamp *once*
      searchInput.value = "";
      forceShowAllOnce = true;
      applyFilters();
    });
  }

  if (clearAllBtn) {
    clearAllBtn.addEventListener("click", () => {
      searchInput.value = "";
      seenFilter.value = "all";
      typeFilter.value = "all";
      hasImageFilter.checked = false;
      sortSelect.value = "anime";
      filteredEntries = [];
      selectedEntryId = null;
      renderList();
      updateSummary();
      clearDetailPanelIfNeeded();
    });
  }

  if (clearCacheBtn) {
    clearCacheBtn.addEventListener("click", handleClearCacheClick);
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

    // Fetch remote profile state for seen status (read-only sync v0.1)
    await fetchProfileState(activeProfileId);

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

  const engBtn = document.getElementById("langEng");
  const jpnBtn = document.getElementById("langJpn");
  const bothBtn = document.getElementById("langBoth");

  function selectLang(btn, lang) {
    document
      .querySelectorAll(".lang-btn")
      .forEach(b => b.classList.remove("selected"));

    btn.classList.add("selected");
    loadDataFor(lang);
  }

  engBtn.addEventListener("click", () => selectLang(engBtn, "ENG"));
  jpnBtn.addEventListener("click", () => selectLang(jpnBtn, "JPN"));
  bothBtn.addEventListener("click", () => selectLang(bothBtn, "BOTH"));

  // Default on startup: ENG DB
  selectLang(engBtn, "ENG");
});
