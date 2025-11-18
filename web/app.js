// app.js

let allEntries = [];
let filteredEntries = [];

// Utility: safely pull fields no matter what you named them
function getField(entry, possibleKeys, fallback = "") {
  for (const key of possibleKeys) {
    if (entry[key] !== undefined && entry[key] !== null) {
      return String(entry[key]);
    }
  }
  return fallback;
}

function normalizeSeen(valueRaw) {
  const v = (valueRaw || "").toString().toLowerCase();
  if (!v) return "";
  if (v.startsWith("seen") || v === "y" || v === "yes") return "seen";
  if (v.startsWith("unseen") || v === "n" || v === "no") return "unseen";
  if (v.includes("plan") || v.includes("hold")) return "planning";
  return "";
}

function normalizeType(valueRaw) {
  const v = (valueRaw || "").toString().toLowerCase();
  if (v.includes("tv")) return "tv";
  if (v.includes("movie") || v.includes("film")) return "movie";
  if (v.includes("ova")) return "ova";
  if (v.includes("ona")) return "ona";
  if (v.includes("special")) return "special";
  return "";
}

function hasImage(entry) {
  const candidates = [
    "image_url", "imageUrl", "image", "image_path", "imagePath"
  ];
  const val = getField(entry, candidates, "").trim();
  return val.length > 0;
}

function getImageUrl(entry) {
  const candidates = [
    "image_url", "imageUrl", "image", "image_path", "imagePath"
  ];
  const val = getField(entry, candidates, "").trim();
  if (!val) return "";

  // If export_mobile_json already gives full URLs, just return it.
  // If it only stores filenames, you can adjust this to prefix /images/.
  if (val.startsWith("http://") || val.startsWith("https://") || val.startsWith("./") || val.startsWith("../")) {
    return val;
  }
  // Assume filename stored, images live in web/images/
  return `images/${val}`;
}

function applyFilters() {
  const searchInput = document.getElementById("searchInput");
  const seenFilter = document.getElementById("seenFilter");
  const typeFilter = document.getElementById("typeFilter");
  const hasImageFilter = document.getElementById("hasImageFilter");
  const sortSelect = document.getElementById("sortSelect");

  const q = (searchInput.value || "").trim().toLowerCase();
  const seenVal = seenFilter.value;      // all / seen / unseen / planning
  const typeVal = typeFilter.value;      // all / tv / movie / ova / ona / special
  const onlyWithImage = hasImageFilter.checked;
  const sortBy = sortSelect.value;       // anime / character / va

  let results = [...allEntries];

  // 1) Search filter
  if (q) {
    results = results.filter(entry => {
      const anime = getField(entry, ["anime_title", "anime", "show", "series"], "");
      const character = getField(entry, ["character_name", "character", "char"], "");
      const va = getField(entry, ["va_name", "voice_actor", "va"], "");
      const haystack = `${anime} ${character} ${va}`.toLowerCase();
      return haystack.includes(q);
    });
  }

  // 2) Seen filter
  if (seenVal !== "all") {
    results = results.filter(entry => {
      const raw = getField(entry, ["seen", "watch_status", "status"], "");
      const normalized = normalizeSeen(raw);
      return normalized === seenVal;
    });
  }

  // 3) Type filter
  if (typeVal !== "all") {
    results = results.filter(entry => {
      const raw = getField(entry, ["media_type", "type", "format"], "");
      const normalized = normalizeType(raw);
      return normalized === typeVal;
    });
  }

  // 4) Has image filter
  if (onlyWithImage) {
    results = results.filter(entry => hasImage(entry));
  }

  // 5) Sort
  results.sort((a, b) => {
    let aKey = "";
    let bKey = "";

    if (sortBy === "anime") {
      aKey = getField(a, ["anime_title", "anime", "show", "series"], "");
      bKey = getField(b, ["anime_title", "anime", "show", "series"], "");
    } else if (sortBy === "character") {
      aKey = getField(a, ["character_name", "character", "char"], "");
      bKey = getField(b, ["character_name", "character", "char"], "");
    } else if (sortBy === "va") {
      aKey = getField(a, ["va_name", "voice_actor", "va"], "");
      bKey = getField(b, ["va_name", "voice_actor", "va"], "");
    }

    aKey = aKey.toLowerCase();
    bKey = bKey.toLowerCase();

    if (aKey < bKey) return -1;
    if (aKey > bKey) return 1;
    return 0;
  });

  filteredEntries = results;
  renderCards();
  updateSummary();
}

function updateSummary() {
  const summary = document.getElementById("resultsSummary");
  if (!summary) return;
  summary.textContent = `Showing ${filteredEntries.length} of ${allEntries.length} entries.`;
}

function renderCards() {
  const container = document.getElementById("cardsContainer");
  if (!container) return;

  container.innerHTML = "";

  if (!filteredEntries.length) {
    const empty = document.createElement("p");
    empty.textContent = "No entries match your filters.";
    empty.className = "summary-text";
    container.appendChild(empty);
    return;
  }

  for (const entry of filteredEntries) {
    const anime = getField(entry, ["anime_title", "anime", "show", "series"], "Unknown anime");
    const character = getField(entry, ["character_name", "character", "char"], "Unknown character");
    const va = getField(entry, ["va_name", "voice_actor", "va"], "Unknown VA");
    const notes = getField(entry, ["notes", "note", "comments"], "");
    const seenRaw = getField(entry, ["seen", "watch_status", "status"], "");
    const seenNorm = normalizeSeen(seenRaw);
    const typeRaw = getField(entry, ["media_type", "type", "format"], "");
    const typeNorm = normalizeType(typeRaw);

    const card = document.createElement("article");
    card.className = "card";

    const imgUrl = getImageUrl(entry);
    if (imgUrl) {
      const img = document.createElement("img");
      img.src = imgUrl;
      img.alt = `${character} (${anime})`;
      card.appendChild(img);
    }

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = character;
    card.appendChild(title);

    const subtitle = document.createElement("div");
    subtitle.className = "card-subtitle";
    subtitle.textContent = anime;
    card.appendChild(subtitle);

    const meta = document.createElement("div");
    meta.className = "card-meta";
    meta.textContent = `VA: ${va}`;
    card.appendChild(meta);

    const tags = document.createElement("div");
    tags.className = "card-tags";

    if (seenNorm) {
      const seenTag = document.createElement("span");
      seenTag.className = "tag";
      if (seenNorm === "seen") seenTag.classList.add("badge-seen");
      if (seenNorm === "unseen") seenTag.classList.add("badge-unseen");
      if (seenNorm === "planning") seenTag.classList.add("badge-planning");
      seenTag.textContent = `Seen: ${seenRaw || seenNorm}`;
      tags.appendChild(seenTag);
    }

    if (typeRaw) {
      const t = document.createElement("span");
      t.className = "tag";
      t.textContent = typeRaw;
      tags.appendChild(t);
    }

    if (notes) {
      const n = document.createElement("span");
      n.className = "tag";
      n.textContent = "Has notes";
      tags.appendChild(n);
    }

    if (tags.childElementCount > 0) {
      card.appendChild(tags);
    }

    // Optional: expand/collapse notes
    if (notes) {
      const notesToggle = document.createElement("button");
      notesToggle.type = "button";
      notesToggle.textContent = "Show notes";
      notesToggle.className = "secondary";
      notesToggle.style.marginTop = "0.25rem";

      const notesBlock = document.createElement("div");
      notesBlock.style.display = "none";
      notesBlock.style.fontSize = "0.75rem";
      notesBlock.style.color = "#d4d4ff";
      notesBlock.style.marginTop = "0.25rem";
      notesBlock.textContent = notes;

      notesToggle.addEventListener("click", () => {
        const open = notesBlock.style.display === "block";
        notesBlock.style.display = open ? "none" : "block";
        notesToggle.textContent = open ? "Show notes" : "Hide notes";
      });

      card.appendChild(notesToggle);
      card.appendChild(notesBlock);
    }

    container.appendChild(card);
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

  if (searchInput) {
    searchInput.addEventListener("input", () => applyFilters());
  }
  if (seenFilter) {
    seenFilter.addEventListener("change", () => applyFilters());
  }
  if (typeFilter) {
    typeFilter.addEventListener("change", () => applyFilters());
  }
  if (hasImageFilter) {
    hasImageFilter.addEventListener("change", () => applyFilters());
  }
  if (sortSelect) {
    sortSelect.addEventListener("change", () => applyFilters());
  }

  if (showAllBtn) {
    showAllBtn.addEventListener("click", () => {
      // Clear search ONLY, keep filters (like your wife's preferred behavior)
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
      applyFilters();
    });
  }
}

async function loadData() {
  try {
    const resp = await fetch("../data/anime_va_mobile.json", { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    // Expecting either an array, or { entries: [...] }
    allEntries = Array.isArray(data) ? data : data.entries || [];
    filteredEntries = [...allEntries];
    renderCards();
    updateSummary();
  } catch (err) {
    console.error("Failed to load anime_va_mobile.json", err);
    const container = document.getElementById("cardsContainer");
    if (container) {
      container.innerHTML = "<p class='summary-text'>Error loading data. Check console.</p>";
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  hookControls();
  loadData();
});
