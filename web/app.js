const DATA_URL = "https://cjw525.github.io/anime-va-updates/data/anime_va_mobile.json";

let records = [];

async function loadData() {
  const res = await fetch(DATA_URL);
  records = await res.json();
  renderList(records);
}

function getImageUrl(record) {
  // Prefer character image, fall back to VA image
  if (record.characterImage) {
    return "images/" + record.characterImage;
  }
  if (record.voiceActorImage) {
    return "images/" + record.voiceActorImage;
  }
  return null;
}

function renderList(list) {
  const container = document.getElementById("results");

  if (list.length === 0) {
    container.innerHTML = "<p>No results.</p>";
    return;
  }

  container.innerHTML = list.map(r => {
    const imgUrl = getImageUrl(r);
    const imgHtml = imgUrl
      ? `<img class="thumb" src="${imgUrl}" alt="${r.character || r.voiceActor}">`
      : "";

    return `
      <div class="result">
        <div class="result-main">
          ${imgHtml}
          <div class="result-text">
            <strong>${r.character}</strong> — ${r.voiceActor}<br>
            <em>${r.anime}</em>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function setupSearch() {
  const input = document.getElementById("search");

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();

    if (q === "") {
      renderList(records);
      return;
    }

    const filtered = records.filter(r =>
      r.character.toLowerCase().includes(q) ||
      r.voiceActor.toLowerCase().includes(q) ||
      r.anime.toLowerCase().includes(q)
    );

    renderList(filtered);
  });
}

loadData();
setupSearch();

// Register service worker for PWA
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .catch(err => {
        console.error("Service worker registration failed:", err);
      });
  });
}
