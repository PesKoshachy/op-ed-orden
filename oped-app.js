import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  addDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const SEASONS = ["Зима", "Весна", "Лето", "Осень"];
const STORAGE_NICK = "oped_nickname";

let db = null;
let auth = null;
let openings = [];
let ratings = [];
let selectedTab = "chart";
let selectedYear = null;
let selectedSeason = null;
let firebaseReady = false;

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

function normalizeNickname(nickname) {
  return String(nickname || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-zа-яё0-9_-]+/gi, "_")
    .slice(0, 60);
}

function getNickname() {
  return localStorage.getItem(STORAGE_NICK) || "";
}

function setNickname(nickname) {
  const cleaned = String(nickname || "").trim();
  if (!cleaned) return false;
  localStorage.setItem(STORAGE_NICK, cleaned);
  $("currentNickname").textContent = cleaned;
  return true;
}

function requireNickname() {
  const nick = getNickname();
  if (!nick) {
    $("nickModal").classList.remove("hidden");
  } else {
    $("currentNickname").textContent = nick;
  }
}

function avgFor(openingId) {
  const list = ratings.filter(r => r.openingId === openingId);
  if (!list.length) return { average: null, count: 0 };
  const sum = list.reduce((acc, r) => acc + Number(r.score || 0), 0);
  return { average: sum / list.length, count: list.length };
}

function myRatingFor(openingId) {
  const nick = normalizeNickname(getNickname());
  if (!nick) return null;
  return ratings.find(r => r.openingId === openingId && normalizeNickname(r.nickname) === nick) || null;
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

function ratingButtons(opening) {
  const my = myRatingFor(opening.id);
  const buttons = [];
  for (let score = 0; score <= 10; score += 0.5) {
    const label = Number.isInteger(score) ? String(score) : String(score).replace(".", ",");
    const active = my && Number(my.score) === score;
    buttons.push(`<button class="small-btn ${active ? "my" : ""}" data-rate="${score}" data-id="${esc(opening.id)}" type="button">${label}</button>`);
  }
  return `<div class="ratings">${buttons.join("")}</div>`;
}

function openingCard(opening, options = {}) {
  const { compact = false, showMyScore = false } = options;
  const avg = avgFor(opening.id);
  const my = myRatingFor(opening.id);
  const studios = listFrom(opening.studios).join(", ");
  const directors = listFrom(opening.directors).join(", ");
  const performers = listFrom(opening.performers).join(", ");
  const link = opening.link ? `<a class="small-btn" href="${esc(opening.link)}" target="_blank" rel="noopener">видео</a>` : "";
  const myTag = my ? `<span class="tag ok">моя: ${Number(my.score).toFixed(1).replace(".0", "")}</span>` : `<span class="tag">не оценено</span>`;

  return `
    <article class="card">
      <div>
        <div class="name">${esc(titleOf(opening))}</div>
        <div class="meta">
          <span class="tag ${(opening.type || "").toLowerCase()}">${esc(opening.type || "?")}</span>
          <span class="tag">${esc(yearSeasonOf(opening))}</span>
          ${myTag}
          ${studios ? `<span class="tag">студия: ${esc(studios)}</span>` : ""}
          ${directors ? `<span class="tag">реж.: ${esc(directors)}</span>` : ""}
          ${performers ? `<span class="tag">исп.: ${esc(performers)}</span>` : ""}
          ${link}
        </div>
      </div>
      <div class="right">
        <div class="avg">
          <b>${avg.average == null ? "—" : avg.average.toFixed(2)}</b>
          <span>${avg.count} оценок</span>
        </div>
        ${showMyScore ? "" : ratingButtons(opening)}
      </div>
    </article>
  `;
}

function sortOpenings(items, sortValue) {
  const copy = [...items];
  const byTitle = (a, b) => titleOf(a).localeCompare(titleOf(b), "ru");
  const byYearDesc = (a, b) => (Number(b.year || 0) - Number(a.year || 0)) || ((b.order || 0) - (a.order || 0));
  const byYearAsc = (a, b) => (Number(a.year || 0) - Number(b.year || 0)) || ((a.order || 0) - (b.order || 0));
  const byRatingDesc = (a, b) => {
    const aa = avgFor(a.id); const bb = avgFor(b.id);
    return ((bb.average ?? -1) - (aa.average ?? -1)) || (bb.count - aa.count) || byTitle(a, b);
  };
  const byRatingAsc = (a, b) => {
    const aa = avgFor(a.id); const bb = avgFor(b.id);
    return ((aa.average ?? 999) - (bb.average ?? 999)) || (bb.count - aa.count) || byTitle(a, b);
  };
  if (sortValue === "yearDesc") return copy.sort(byYearDesc);
  if (sortValue === "yearAsc") return copy.sort(byYearAsc);
  if (sortValue === "titleAsc") return copy.sort(byTitle);
  if (sortValue === "ratingAsc") return copy.sort(byRatingAsc);
  return copy.sort(byRatingDesc);
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

function renderChart() {
  const list = filteredChartOpenings();
  $("chartStatus").textContent = firebaseReady
    ? `Показано: ${list.length}. Всего в базе: ${openings.length}. Оценок: ${ratings.length}.`
    : "Firebase не подключён. Проверь firebase-config.js.";
  $("chartStatus").className = firebaseReady ? "status good" : "status bad";
  $("chartList").innerHTML = list.map(o => openingCard(o)).join("") || `<div class="status">Ничего не найдено.</div>`;
}

function renderYearOptions() {
  const years = [...new Set(openings.map(o => Number(o.year)).filter(Boolean))].sort((a, b) => b - a);
  const selected = $("yearFilter").value;
  $("yearFilter").innerHTML = `<option value="all">Все</option>` + years.map(y => `<option value="${y}">${y}</option>`).join("");
  if ([...$("yearFilter").options].some(o => o.value === selected)) $("yearFilter").value = selected;
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
  const rated = items.filter(o => myRatingFor(o.id)).length;
  const done = items.length > 0 && rated === items.length;
  return { items, rated, done };
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
    const active = selectedYear === selectedYear && selectedSeason === season;
    const text = future ? "Скоро будет" : `${st.rated}/${st.items.length} оценено`;
    const mark = st.done ? "✅" : (future ? "⏳" : "");
    return `
      <div class="season-card">
        <div class="season-head"><span>${esc(season)}</span><span>${mark}</span></div>
        <div class="season-status">${esc(text)}</div>
        <button class="small-btn ${active ? "active" : ""}" data-season="${esc(season)}" type="button" style="margin-top:10px;">Оценить сезон</button>
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
  $("seasonStatus").textContent = `${selectedYear} · ${selectedSeason}: ${st.rated}/${st.items.length} оценено${st.done ? " ✅" : ""}`;
  const sorted = [...st.items].sort((a, b) => (Number(a.order || 0) - Number(b.order || 0)) || titleOf(a).localeCompare(titleOf(b), "ru"));
  $("seasonList").innerHTML = sorted.map(o => openingCard(o)).join("") || `<div class="status">В этом сезоне пока нет опенингов.</div>`;
}

function renderSeasons() {
  renderSeasonCards();
  renderSeasonList();
}

function myRatedOpenings() {
  const nick = normalizeNickname(getNickname());
  const myRatings = ratings.filter(r => normalizeNickname(r.nickname) === nick);
  const byId = Object.fromEntries(openings.map(o => [o.id, o]));
  return myRatings
    .map(r => ({ rating: r, opening: byId[r.openingId] }))
    .filter(x => x.opening);
}

function renderProfile() {
  let items = myRatedOpenings();
  const type = $("profileType").value;
  const minScoreRaw = $("profileScore").value;
  const sort = $("profileSort").value;
  if (type !== "all") items = items.filter(x => x.opening.type === type);
  if (minScoreRaw !== "all") {
    const minScore = Number(minScoreRaw);
    items = items.filter(x => Number(x.rating.score) >= minScore);
  }
  items.sort((a, b) => {
    if (sort === "scoreAsc") return Number(a.rating.score) - Number(b.rating.score) || titleOf(a.opening).localeCompare(titleOf(b.opening), "ru");
    if (sort === "yearDesc") return Number(b.opening.year || 0) - Number(a.opening.year || 0) || titleOf(a.opening).localeCompare(titleOf(b.opening), "ru");
    if (sort === "titleAsc") return titleOf(a.opening).localeCompare(titleOf(b.opening), "ru");
    return Number(b.rating.score) - Number(a.rating.score) || titleOf(a.opening).localeCompare(titleOf(b.opening), "ru");
  });
  $("profileSummary").textContent = `Оценено тобой: ${myRatedOpenings().length}`;
  $("profileList").innerHTML = items.map(x => openingCard(x.opening, { showMyScore: false })).join("") || `<div class="status">Пока нет оценок.</div>`;

  const top = (type) => sortOpenings(openings.filter(o => o.type === type), "ratingDesc")
    .filter(o => avgFor(o.id).count > 0)
    .slice(0, 100)
    .map(o => openingCard(o, { compact: true }));
  $("profileTopOP").innerHTML = top("OP").join("") || `<div class="status">Пока нет оценок OP.</div>`;
  $("profileTopED").innerHTML = top("ED").join("") || `<div class="status">Пока нет оценок ED.</div>`;
}

function renderAll() {
  renderYearOptions();
  renderChart();
  renderProfile();
  renderSeasons();
}

async function saveRating(openingId, score) {
  const nickname = getNickname();
  if (!nickname) {
    $("nickModal").classList.remove("hidden");
    return;
  }
  const safeNickname = normalizeNickname(nickname);
  const ratingId = `${safeNickname}__${openingId}`;
  await setDoc(doc(db, "ratings", ratingId), {
    openingId,
    nickname,
    score: Number(score),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function addOpeningFromForm(event) {
  event.preventDefault();
  const nickname = getNickname();
  if (!nickname) {
    $("nickModal").classList.remove("hidden");
    return;
  }
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
    createdBy: nickname,
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
      ["chart", "profile", "seasons"].forEach(tab => $("tab-" + tab).classList.toggle("hidden", tab !== selectedTab));
      renderAll();
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
    $("sortSelect").value = "ratingDesc";
    $("limitSelect").value = "100";
    renderChart();
  });

  ["profileType", "profileScore", "profileSort"].forEach(id => $(id).addEventListener("input", renderProfile));

  document.body.addEventListener("click", async (event) => {
    const rateBtn = event.target.closest("button[data-rate]");
    if (rateBtn) {
      rateBtn.disabled = true;
      try { await saveRating(rateBtn.dataset.id, Number(rateBtn.dataset.rate)); }
      catch (e) { alert("Не удалось сохранить оценку: " + e.message); }
      finally { rateBtn.disabled = false; }
      return;
    }

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

  $("changeNickBtn").addEventListener("click", () => {
    $("nickInput").value = getNickname();
    $("nickModal").classList.remove("hidden");
  });

  $("saveNickBtn").addEventListener("click", () => {
    if (setNickname($("nickInput").value)) {
      $("nickModal").classList.add("hidden");
      renderAll();
    } else {
      alert("Никнейм обязателен");
    }
  });

  $("nickInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("saveNickBtn").click();
  });
}

async function initFirebase() {
  const config = window.FIREBASE_CONFIG || {};
  if (!config.projectId || String(config.projectId).includes("ВСТАВЬ")) {
    firebaseReady = false;
    renderAll();
    return;
  }
  const app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
  await signInAnonymously(auth);
  firebaseReady = true;

  onSnapshot(collection(db, "openings"), snapshot => {
    openings = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
  }, error => {
    $("chartStatus").className = "status bad";
    $("chartStatus").textContent = "Ошибка чтения openings: " + error.message;
  });

  onSnapshot(collection(db, "ratings"), snapshot => {
    ratings = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
  }, error => {
    $("chartStatus").className = "status bad";
    $("chartStatus").textContent = "Ошибка чтения ratings: " + error.message;
  });
}

bindEvents();
requireNickname();
renderAll();
initFirebase().catch(error => {
  firebaseReady = false;
  $("chartStatus").className = "status bad";
  $("chartStatus").textContent = "Firebase не запустился: " + error.message;
});
