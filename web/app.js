const DATA_URL = "https://cjw525.github.io/anime-va-updates/data/anime_va_mobile.json";

let records = [];

async function loadData() {
  const res = await fetch(DATA_URL);
  records = await res.json();
  renderList(records);
}

function renderList(list) {
  const container = document.getElementById("results");

  if (list.length === 0) {
    container.innerHTML = "<p>No results.</p>";
    return;
  }

  container.innerHTML = list.map(r => `
    <div class="result">
      <strong>${r.character}</strong> — ${r.voiceActor}<br>
      <em>${r.anime}</em>
    </div>
  `).join("");
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
