// app.js - table-style list + click-to-view images

let allEntries = [];
let filteredEntries = [];
let selectedEntryId = null;

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

// No media type in mobile JSON yet; leave this as a stub.
function normalizeType(valueRaw) {
  return "";
}

// Character image URL
function getCharacterImageUrl(entry) {
  const raw = getField(entry, ["characterImage"], "").trim();
  if (!raw) return "";
  if (
    raw.startsWith("http://") ||
    raw.startsWith("https://") ||
    raw.startsWith("./") ||
    raw.startsWith("../")
  ) {
    return raw;
  }
  return `images/${raw}`;
}

// VA image URL
function getVaImageUrl(entry) {
  const raw = getField(entry, ["voiceActorImage"], "").trim();
  if (!raw) return "";
  if (
    raw.startsWith("http://") ||
    raw.startsWith("https://") ||
    raw.startsWith("./") ||
    raw.startsWith("../")
  ) {
    return raw;
  }
  return `images/${raw}`;
}

function applyFilters() {
  const searchInput = document.getElementById("searchInput");
  const seenFilter = document.getElementById("seenFilter");
  const typeFilter = document.getElementById("typeFilter");
  const hasImageFilter = document.getElementById("hasImageFilter");
  const sortSelect = document.getElementById("sortSelect");

  const q = (searchInput.value || "").trim().toLowerCase();
  const seenVal = seenFilter.value;
  const typeVal = typeFilter.value;
  const onlyWithImage = hasImageFilter.checked;
  const sortBy = sortSelect.value;

  let results = [...allEntries];

  // Search across anime, character, VA
  if (q) {
    results = results.filter((entry) => {
      const anime = getField(entry, ["anime"]);
      const character = getField(entry, ["character"]);
      const va = getField(entry, ["voiceActor", "voice_actor", "va"]);
      const haystack = `${anime} ${character} ${va}`.toLowerCase();
      return haystack.includes(q);
    });
  }

  // Seen filter
  if (seenVal !== "all") {
    results = results.filter((entry) => {
      const raw = entry["seen"];
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

  filteredEntries = results;
  // Clear selection when filters change
  selectedEntryId = null;
  renderList();
  updateSummary();
  clearDetailPanelIfNeeded();
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
  } else {
    summary.textContent = `Showing ${shown} of ${total} entries.`;
  }
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
    const seenRaw = entry["seen"];
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

  const anime = getField(entry, ["anime"], "Unknown anime");
  const character = getField(entry, ["character"], "Unknown character");
  const va = getField(entry, ["voiceActor", "voice_actor", "va"], "Unknown VA");
  const seenRaw = entry["seen"];
  const seenNorm = normalizeSeen(seenRaw);
  const year = getField(entry, ["year"], "");

  panel.innerHTML = "";

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

  panel.appendChild(header);

  // IMAGES – ONLY LOADED FOR THE SELECTED ENTRY
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
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function hookControls() {
  const searchInput = document.getElementById("searchInput");
  const seenFilter = document.getElementById("seenFilter");
  const typeFilter = document.getElementById("typeFilter");
  const hasImageFilter = document.getElementById("hasImageFilter");
  const sortSelect = document.getElementById("sortSelect");
  const showAllBtn = document.getElementById("showAllBtn");
  const clearAllBtn = document.getElementById("clearAllBtn");

  if (searchInput) searchInput.addEventListener("input", applyFilters);
  if (seenFilter) seenFilter.addEventListener("change", applyFilters);
  if (typeFilter) typeFilter.addEventListener("change", applyFilters);
  if (hasImageFilter) hasImageFilter.addEventListener("change", applyFilters);
  if (sortSelect) sortSelect.addEventListener("change", applyFilters);

  if (showAllBtn) {
    showAllBtn.addEventListener("click", () => {
      searchInput.value = "";
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
}

async function loadData() {
  try {
    const resp = await fetch("../data/anime_va_mobile.json", { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    // Your JSON is a top-level array of entries
    allEntries = Array.isArray(data) ? data : data.entries || data.data || [];
    filteredEntries = [];
    selectedEntryId = null;

    const container = document.getElementById("cardsContainer");
    if (container) {
      container.innerHTML =
        "<p class='summary-text'>Database loaded. Type in the search box or use filters to see entries.</p>";
    }
    clearDetailPanelIfNeeded();
    updateSummary();
  } catch (err) {
    console.error("Failed to load anime_va_mobile.json", err);
    const container = document.getElementById("cardsContainer");
    if (container) {
      container.innerHTML =
        "<p class='summary-text'>Error loading data. Check console.</p>";
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  hookControls();
  loadData();
});
