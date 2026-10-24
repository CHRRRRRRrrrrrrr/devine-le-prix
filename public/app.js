"use strict";

const ROUNDS = 5;
const MIN_GUESS = 30_000;
const MAX_GUESS = 3_000_000;
const STORE_KEY = "dlp:v1";
// Lyon : centre de secours si une vente n'a pas de coordonnées
const LYON_CENTER = [45.76, 4.84];

const $ = (id) => document.getElementById(id);
const euros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

let sales = [];
let game = null; // { mode, date, picks: [sale], index, results: [{guess, score}] }
let map = null;
let mapLayer = null;

/* ---------- stockage local ---------- */

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || { history: [], daily: {} };
  } catch {
    return { history: [], daily: {} };
  }
}

function saveStore(store) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* stockage indisponible */ }
}

/* ---------- hasard déterministe pour le défi du jour ---------- */

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickSales(rand, n) {
  const chosen = new Set();
  while (chosen.size < Math.min(n, sales.length)) chosen.add(Math.floor(rand() * sales.length));
  return [...chosen].map((i) => sales[i]);
}

/* ---------- libellés ---------- */

const arrLabel = (a) => `Lyon ${a}${a === 1 ? "er" : "e"}`;
const typeLabel = (s) => (s.t === "A" ? "Appartement" : "Maison");

function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

// "2026-10-24" -> "24/10/2026" (sans passer par Date, qui lirait la date en UTC)
const dayLabel = (key) => key.split("-").reverse().join("/");

function similarSearchUrl(s) {
  const q = `${typeLabel(s).toLowerCase()} ${s.r} pièce${s.r > 1 ? "s" : ""} ${s.s} m² à vendre ${arrLabel(s.a)}`;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

/* ---------- score ---------- */

function scoreFor(guess, price) {
  const err = Math.abs(guess - price) / price;
  if (err <= 0.02) return 1000;
  return Math.max(0, Math.round(1000 * (1 - err / 0.5)));
}

function square(score) {
  if (score >= 800) return "🟩";
  if (score >= 500) return "🟨";
  if (score > 0) return "🟧";
  return "🟥";
}

/* ---------- curseur logarithmique ---------- */

const sliderToPrice = (v) => {
  const p = MIN_GUESS * Math.pow(MAX_GUESS / MIN_GUESS, v / 1000);
  return p < 200_000 ? Math.round(p / 1000) * 1000 : Math.round(p / 5000) * 5000;
};
const priceToSlider = (p) => Math.round((1000 * Math.log(p / MIN_GUESS)) / Math.log(MAX_GUESS / MIN_GUESS));

function currentGuess() {
  const v = parseInt($("guess-input").value.replace(/\D/g, ""), 10);
  return Number.isFinite(v) ? v : 0;
}

function setGuess(p, fromInput = false) {
  if (!fromInput) $("guess-input").value = num.format(p);
  $("guess-range").value = priceToSlider(Math.min(Math.max(p, MIN_GUESS), MAX_GUESS));
  const s = game.picks[game.index];
  $("guess-m2").textContent = p > 0 ? `soit ${num.format(p / s.s)} €/m²` : "";
}

/* ---------- écrans ---------- */

function show(id) {
  for (const el of document.querySelectorAll(".screen")) el.hidden = el.id !== id;
  window.scrollTo(0, 0);
}

function renderHome() {
  const store = loadStore();
  const today = store.daily[todayKey()];
  $("btn-daily").textContent = today ? "Revoir le défi du jour" : "Défi du jour";
  $("daily-status").textContent = today ? `Déjà joué aujourd'hui : ${today.total} / ${ROUNDS * 1000}` : "Les mêmes 5 biens pour tout le monde aujourd'hui.";

  const played = store.history.length;
  const best = store.history.reduce((m, h) => Math.max(m, h.total), 0);
  $("stats").innerHTML = played
    ? [
        [played, "parties"],
        [best, "meilleur score"],
        [dailyStreak(store), "série défis"],
      ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("")
    : "";
  show("home");
}

function dailyStreak(store) {
  let streak = 0;
  const d = new Date();
  for (;;) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!store.daily[key]) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function startGame(mode) {
  const date = todayKey();
  if (mode === "daily") {
    const done = loadStore().daily[date];
    if (done) {
      game = { mode, date, picks: done.picks, index: ROUNDS, results: done.results };
      return renderEnd();
    }
  }
  const rand = mode === "daily" ? mulberry32(hashString(`lyon:${date}`)) : Math.random;
  game = { mode, date, picks: pickSales(rand, ROUNDS), index: 0, results: [] };
  renderRound();
}

function renderRound() {
  const s = game.picks[game.index];
  const total = game.results.reduce((t, r) => t + r.score, 0);
  $("round-label").textContent = `${game.mode === "daily" ? "Défi du jour" : "Partie libre"} · bien ${game.index + 1}/${ROUNDS}`;
  $("round-score").textContent = `${total} pts`;

  $("p-kind").textContent = `${typeLabel(s)} · ${arrLabel(s.a)}`;
  const facts = [
    `${s.s} m²`,
    `${s.r} pièce${s.r > 1 ? "s" : ""}`,
    s.g ? `terrain ${num.format(s.g)} m²` : null,
    s.k ? `+ ${s.k} dépendance${s.k > 1 ? "s" : ""} (cave, parking…)` : null,
  ].filter(Boolean);
  $("p-facts").innerHTML = facts.map((f) => `<span class="chip">${f}</span>`).join("");
  $("p-where").textContent = `${s.v ? s.v + " · " : ""}vendu en ${monthLabel(s.d)}`;

  $("guess-form").hidden = false;
  $("reveal").hidden = true;
  setGuess(300_000);
  show("round");
  renderMap(s);
}

function renderMap(s) {
  const center = s.y && s.x ? [s.y, s.x] : LYON_CENTER;
  if (!map) {
    map = L.map("map", { zoomControl: false, attributionControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    map.on("click", (e) => {
      const { lat, lng } = e.latlng;
      const ll = `${lat.toFixed(5)},${lng.toFixed(5)}`;
      L.popup()
        .setLatLng(e.latlng)
        .setContent(
          `<div class="map-popup">
            <a href="https://www.google.com/maps/search/?api=1&query=${ll}" target="_blank" rel="noopener">Ouvrir dans Google Maps ↗</a>
            <a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${ll}" target="_blank" rel="noopener">Street View ici ↗</a>
          </div>`
        )
        .openOn(map);
    });
  }
  if (mapLayer) mapLayer.remove();
  // Zone approximative : les coordonnées sont arrondies à ~100 m
  mapLayer = L.circle(center, { radius: 150, color: "#1f4e5f", weight: 2, fillOpacity: 0.15 }).addTo(map);
  map.closePopup();
  map.setView(center, 15);
  // La carte est créée/affichée dans un écran qui vient d'apparaître
  setTimeout(() => map.invalidateSize(), 0);
}

function submitGuess(e) {
  e.preventDefault();
  const guess = currentGuess();
  if (guess <= 0) return $("guess-input").focus();
  const s = game.picks[game.index];
  const score = scoreFor(guess, s.p);
  game.results.push({ guess, score });

  const diff = (guess - s.p) / s.p;
  const verdicts = [[1000, "Dans le mille !"], [800, "Très proche !"], [500, "Pas mal."], [1, "Bof…"], [0, "Raté !"]];
  $("r-verdict").textContent = `${square(score)} ${verdicts.find(([min]) => score >= min)[1]}`;
  $("r-price").textContent = euros.format(s.p);
  $("r-detail").textContent = `${num.format(s.p / s.s)} €/m² · ton estimation : ${euros.format(guess)} (${diff > 0 ? "+" : ""}${Math.round(diff * 100)} %)`;
  $("r-points").textContent = `+${score} pts`;
  $("r-similar").href = similarSearchUrl(s);
  $("btn-next").textContent = game.index + 1 < ROUNDS ? "Bien suivant" : "Voir mon score";
  $("round-score").textContent = `${game.results.reduce((t, r) => t + r.score, 0)} pts`;

  $("guess-form").hidden = true;
  $("reveal").hidden = false;
  $("reveal").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function nextRound() {
  game.index++;
  if (game.index < ROUNDS) return renderRound();
  finishGame();
}

function finishGame() {
  const total = game.results.reduce((t, r) => t + r.score, 0);
  const grid = game.results.map((r) => square(r.score)).join("");
  const store = loadStore();
  store.history.push({ date: game.date, mode: game.mode, total, grid });
  if (game.mode === "daily") {
    // On garde les biens eux-mêmes : les index changeraient si les données sont régénérées
    store.daily[game.date] = { total, grid, picks: game.picks, results: game.results };
  }
  saveStore(store);
  renderEnd();
}

function renderEnd() {
  const total = game.results.reduce((t, r) => t + r.score, 0);
  $("end-title").textContent = game.mode === "daily" ? `Défi du ${dayLabel(game.date)}` : "Partie terminée";
  $("end-total").innerHTML = `${total}<small> / ${ROUNDS * 1000}</small>`;
  $("end-grid").textContent = game.results.map((r) => square(r.score)).join("");
  $("end-recap").innerHTML = game.picks
    .map((s, i) => {
      const r = game.results[i];
      return `<li><b>${typeLabel(s)} ${s.s} m², ${arrLabel(s.a)}</b> : ${euros.format(s.p)}
        <span class="muted">(toi : ${euros.format(r.guess)}, ${r.score} pts)</span>
        · <a href="${similarSearchUrl(s)}" target="_blank" rel="noopener">similaires ↗</a></li>`;
    })
    .join("");
  $("share-status").textContent = "";
  show("end");
}

function shareText() {
  const total = game.results.reduce((t, r) => t + r.score, 0);
  const title = game.mode === "daily" ? `Devine le prix · Lyon · ${dayLabel(game.date)}` : "Devine le prix · Lyon";
  return `${title}\n${game.results.map((r) => square(r.score)).join("")} ${total}/${ROUNDS * 1000}\n${location.origin}${location.pathname}`;
}

async function share() {
  const text = shareText();
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return;
    }
    await navigator.clipboard.writeText(text);
    $("share-status").textContent = "Résultat copié dans le presse-papiers !";
  } catch (err) {
    if (err && err.name === "AbortError") return;
    $("share-status").textContent = text;
  }
}

/* ---------- démarrage ---------- */

async function init() {
  $("btn-daily").addEventListener("click", () => startGame("daily"));
  $("btn-free").addEventListener("click", () => startGame("free"));
  $("btn-again").addEventListener("click", () => startGame("free"));
  $("btn-next").addEventListener("click", nextRound);
  $("btn-share").addEventListener("click", share);
  $("guess-form").addEventListener("submit", submitGuess);
  $("guess-range").addEventListener("input", (e) => setGuess(sliderToPrice(+e.target.value)));
  $("guess-input").addEventListener("input", (e) => {
    const v = currentGuess();
    e.target.value = v ? num.format(v) : "";
    setGuess(v, true);
  });
  for (const el of document.querySelectorAll("[data-go=home]")) el.addEventListener("click", renderHome);

  $("btn-daily").disabled = $("btn-free").disabled = true;
  try {
    sales = await (await fetch("data/lyon.json")).json();
  } catch {
    $("daily-status").textContent = "Impossible de charger les données. Vérifie ta connexion.";
    return;
  }
  $("btn-daily").disabled = $("btn-free").disabled = false;
  renderHome();

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

init();
