import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const SEASONS = ["Зима", "Весна", "Лето", "Осень"];

let db = null;
let openings = [];
let selectedTab = "chart";
let selectedYear = null;
let selectedSeason = null;
let firebaseReady = false;
let renderQueued = false;
let yearsCacheKey = "";
let yearsCacheHtml = "";

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function listFrom(value) {
  if (Array.isArray(value)) return value.map(String).map(x => x.trim()).filter(Boolean);
  return String(value || "").split(",").map(x => x.trim()).filter(Boolean);
}

function titleOf(o) {
  return o.title || o.anime || "Без названия";
}

function yearSeasonOf(o) {
  return `${Number(o.year || 0) || "—"} · ${o.season || "—"}`;
}

function openingSearchText(o) {
  return [
    o.title, o.anime, o.type, o.year, o.season,
    ...(o.studios || []), ...(o.directors || []), ...(o.performers || [])
  ].join(" ").toLowerCase();
}

function openingCard(opening) {
  const studios = listFrom(opening.studios).join(", ");
  const directors = listFrom(opening.directors).join(", ");
  const performers = listFrom(opening.performers).join(", ");
  const link = opening.link ? `<a class="small-btn" href="${esc(opening.link)}" target="_blank" rel="noopener">видео</a>` : "";

  return `
    <article class="card">
      <div>
        <div class="name">${esc(titleOf(opening))}</div>
        <div class="meta">
          <span class="tag ${(opening.type || "").toLowerCase()}">${esc(opening.type || "?")}</span>
          <span class="tag">${esc(yearSeasonOf(opening))}</span>
          ${studios ? `<span class="tag">студия: ${esc(studios)}</span>` : ""}
          ${directors ? `<span class="tag">реж.: ${esc(directors)}</span>` : ""}
          ${performers ? `<span class="tag">исп.: ${esc(performers)}</span>` : ""}
          ${link}
        </div>
      </div>
    </article>
  `;
}

function sortOpenings(items, sortValue) {
  const copy = [...items];
  const byTitle = (a, b) => titleOf(a).localeCompare(titleOf(b), "ru");
  const byYearDesc = (a, b) => (Number(b.year || 0) - Number(a.year || 0)) || ((Number(b.order || 0)) - Number(a.order || 0)) || byTitle(a, b);
  const byYearAsc = (a, b) => (Number(a.year || 0) - Number(b.year || 0)) || (Number(a.order || 0) - Number(b.order || 0)) || byTitle(a, b);
  const bySeasonOrder = (a, b) => {
    const ay = Number(a.year || 0);
    const by = Number(b.year || 0);
    if (ay !== by) return by - ay;
    const as = SEASONS.indexOf(a.season);
    const bs = SEASONS.indexOf(b.season);
    if (as !== bs) return bs - as;
    return (Number(a.order || 0) - Number(b.order || 0)) || byTitle(a, b);
  };
  if (sortValue === "yearAsc") return copy.sort(byYearAsc);
  if (sortValue === "titleAsc") return copy.sort(byTitle);
  if (sortValue === "seasonDesc") return copy.sort(bySeasonOrder);
  return copy.sort(byYearDesc);
}

function filteredChartOpenings() {
  const search = $("searchInput").value.trim().toLowerCase();
  const type = $("typeFilter").value;
  const year = $("yearFilter").value;
  const season = $("seasonFilter").value;

  let items = openings.filter(o => {
    if (type !== "all" && o.type !== type) return false;
    if (year !== "all" && String(o.year) !== year) return false;
    if (season !== "all" && o.season !== season) return false;
    if (search && !openingSearchText(o).includes(search)) return false;
    return true;
  });

  items = sortOpenings(items, $("sortSelect").value);
  const limit = $("limitSelect").value;
  if (limit !== "all") items = items.slice(0, Number(limit));
  return items;
}

function renderYearOptions() {
  const years = [...new Set(openings.map(o => Number(o.year)).filter(Boolean))].sort((a, b) => b - a);
  const key = years.join("|");
  const selected = $("yearFilter").value;

  if (key !== yearsCacheKey) {
    yearsCacheKey = key;
    yearsCacheHtml = `<option value="all">Все</option>` + years.map(y => `<option value="${y}">${y}</option>`).join("");
    $("yearFilter").innerHTML = yearsCacheHtml;
  }

  if ([...$("yearFilter").options].some(o => o.value === selected)) $("yearFilter").value = selected;
}

function renderChart() {
  renderYearOptions();
  const list = filteredChartOpenings();
  $("chartStatus").textContent = firebaseReady
    ? `Показано: ${list.length}. Всего в базе: ${openings.length}.`
    : "Firebase не подключён. Проверь firebase-config.js.";
  $("chartStatus").className = firebaseReady ? "status good" : "status bad";
  $("chartList").innerHTML = list.map(o => openingCard(o)).join("") || `<div class="status">Ничего не найдено.</div>`;
}

function getMaxSeasonYear() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const month = now.getMonth() + 1;
  return month >= 9 ? currentYear + 1 : currentYear;
}

function renderYears() {
  const maxYear = getMaxSeasonYear();
  if (!selectedYear) selectedYear = maxYear;
  const years = [];
  for (let y = maxYear; y >= 1990; y--) years.push(y);
  $("yearList").innerHTML = years.map(y => `<button class="year-btn ${selectedYear === y ? "active" : ""}" data-year="${y}" type="button">${y}</button>`).join("");
}

function seasonState(year, season) {
  const items = openings.filter(o => Number(o.year) === Number(year) && o.season === season);
  return { items };
}

function isFutureSeason(year, season) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const seasonStartMonth = { "Зима": 1, "Весна": 4, "Лето": 7, "Осень": 10 }[season] || 1;
  return Number(year) > y || (Number(year) === y && seasonStartMonth > m + 1);
}

function renderSeasonCards() {
  renderYears();
  $("seasonCards").innerHTML = SEASONS.map(season => {
    const st = seasonState(selectedYear, season);
    const future = isFutureSeason(selectedYear, season) && st.items.length === 0;
    const active = selectedSeason === season;
    const text = future ? "Скоро будет" : `${st.items.length} треков`;
    const mark = future ? "⏳" : "";
    return `
      <div class="season-card">
        <div class="season-head"><span>${esc(season)}</span><span>${mark}</span></div>
        <div class="season-status">${esc(text)}</div>
        <button class="small-btn ${active ? "active" : ""}" data-season="${esc(season)}" type="button" style="margin-top:10px;">Открыть сезон</button>
      </div>
    `;
  }).join("");
}

function renderSeasonList() {
  if (!selectedYear || !selectedSeason) {
    $("seasonStatus").textContent = "Выберите год и сезон.";
    $("seasonList").innerHTML = "";
    return;
  }

  const st = seasonState(selectedYear, selectedSeason);
  $("seasonStatus").textContent = `${selectedYear} · ${selectedSeason}: ${st.items.length} треков`;
  const sorted = [...st.items].sort((a, b) => (Number(a.order || 0) - Number(b.order || 0)) || titleOf(a).localeCompare(titleOf(b), "ru"));
  $("seasonList").innerHTML = sorted.map(o => openingCard(o)).join("") || `<div class="status">В этом сезоне пока нет опенингов.</div>`;
}

function renderSeasons() {
  renderSeasonCards();
  renderSeasonList();
}

function renderActive() {
  if (selectedTab === "seasons") renderSeasons();
  else renderChart();
}

function scheduleRenderActive() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderActive();
  });
}

async function addOpeningFromForm(event) {
  event.preventDefault();

  const anime = $("addAnime").value.trim();
  const year = Number($("addYear").value);
  if (!anime || !year) return;

  await addDoc(collection(db, "openings"), {
    title: anime,
    anime,
    type: $("addType").value === "ED" ? "ED" : "OP",
    year,
    season: $("addSeason").value,
    order: 999,
    studios: listFrom($("addStudios").value),
    directors: listFrom($("addDirectors").value),
    performers: listFrom($("addPerformers").value),
    image: "",
    link: $("addLink").value.trim(),
    createdBy: "site",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  $("addForm").reset();
  $("addPanel").classList.add("hidden");
}

function bindEvents() {
  document.querySelectorAll(".pill[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedTab = btn.dataset.tab;
      document.querySelectorAll(".pill[data-tab]").forEach(b => b.classList.toggle("active", b === btn));
      ["chart", "seasons"].forEach(tab => $("tab-" + tab).classList.toggle("hidden", tab !== selectedTab));
      renderActive();
    });
  });

  $("toggleAddBtn").addEventListener("click", () => $("addPanel").classList.toggle("hidden"));
  $("addForm").addEventListener("submit", addOpeningFromForm);

  ["searchInput", "typeFilter", "yearFilter", "seasonFilter", "sortSelect", "limitSelect"].forEach(id => $(id).addEventListener("input", renderChart));
  $("resetFiltersBtn").addEventListener("click", () => {
    $("searchInput").value = "";
    $("typeFilter").value = "all";
    $("yearFilter").value = "all";
    $("seasonFilter").value = "all";
    $("sortSelect").value = "yearDesc";
    $("limitSelect").value = "100";
    renderChart();
  });

  document.body.addEventListener("click", (event) => {
    const yearBtn = event.target.closest("button[data-year]");
    if (yearBtn) {
      selectedYear = Number(yearBtn.dataset.year);
      selectedSeason = null;
      renderSeasons();
      return;
    }

    const seasonBtn = event.target.closest("button[data-season]");
    if (seasonBtn) {
      selectedSeason = seasonBtn.dataset.season;
      renderSeasons();
    }
  });
}

async function initFirebase() {
  const config = window.FIREBASE_CONFIG || {};
  if (!config.projectId || String(config.projectId).includes("ВСТАВЬ")) {
    firebaseReady = false;
    renderActive();
    return;
  }

  const app = initializeApp(config);
  const auth = getAuth(app);
  db = getFirestore(app);
  await signInAnonymously(auth);
  firebaseReady = true;

  onSnapshot(collection(db, "openings"), snapshot => {
    openings = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    scheduleRenderActive();
  }, error => {
    $("chartStatus").className = "status bad";
    $("chartStatus").textContent = "Ошибка чтения openings: " + error.message;
  });
}

bindEvents();
renderActive();
initFirebase().catch(error => {
  firebaseReady = false;
  $("chartStatus").className = "status bad";
  $("chartStatus").textContent = "Firebase не запустился: " + error.message;
});
