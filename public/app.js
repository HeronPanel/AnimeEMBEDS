/* ==========================================================================
   ToonFLIX - application logic (vanilla JS)
   - Catalog /api/catalog se load hota hai (fallback: /data/catalog.json)
   - Har 5 min mein auto-refresh: naye anime / naye episodes khud add ho jaate hain
   - Hero slider, trending, A-Z, filters, search, player, seasons, share, cinema mode
   ========================================================================== */
(function () {
  "use strict";

  /* ---------------------------------------------------------------- config */
  const API_URLS = ["/api/catalog", "/data/catalog.json"];
  const PAGE_SIZE = 36;
  const REFRESH_MS = 5 * 60 * 1000;
  const HERO_COUNT = 6;
  const HERO_MS = 6500;
  const NEW_DAYS = 7;

  /* --------------------------------------------------------------- helpers */
  const $ = (id) => document.getElementById(id);
  const qs = (sel, root) => (root || document).querySelector(sel);
  const qsa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const rxEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const show = (el, on, disp) => { if (el) el.style.display = on ? (disp || "") : "none"; };

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } }
  };

  let toastTimer;
  function toast(msg) {
    const t = $("toast-msg");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
  }

  /* ----------------------------------------------------------------- state */
  const state = {
    all: [],
    byId: new Map(),
    bySource: new Map(),
    nav: "home",
    cat: "all",
    lang: "all",
    status: "all",
    sort: "latest",
    letter: "ALL",
    genre: null,
    shown: PAGE_SIZE,
    searchActive: false,
    query: "",
    current: null,
    epIndex: 0,
    heroList: [],
    heroIdx: 0,
    heroTimer: null,
    scrollY: 0,
    loaded: false,
    lastFetch: 0
  };

  /* ------------------------------------------------------------ normalizing */
  function normalize(list) {
    const now = Date.now();
    list.forEach((e) => {
      e.episodes = (Array.isArray(e.episodes) ? e.episodes : [])
        .filter((x) => x && x.embedUrl)
        .sort((a, b) => Number(a.number) - Number(b.number));
      e._r = parseFloat(e.rating) || 0;
      e._ts = e.addedAt ? Date.parse(e.addedAt) || 0 : 0;
      e._new = e._ts > 0 && now - e._ts < NEW_DAYS * 864e5;
      e._count = Math.max(Number(e.episodeCount) || 0, e.episodes.length);
      e._genres = Array.isArray(e.genres) ? e.genres : [];
      e._tags = Array.isArray(e.tags) ? e.tags : [];
      e._t = [e.title, e.language, e.type, e.category, e._genres.join(" "), e._tags.slice(0, 12).join(" ")]
        .join(" ").toLowerCase();
      const first = String(e.title || "").trim().charAt(0).toUpperCase();
      e._letter = /[A-Z]/.test(first) ? first : "#";
      e._label = /[A-Z0-9]/i.test(first) ? first : "A";
    });
    return list;
  }

  function ingest(list) {
    state.all = normalize(list);
    state.byId = new Map(state.all.map((e) => [Number(e.id), e]));
    state.bySource = new Map();
    state.all.forEach((e) => {
      const k = e.sourceId + "|" + e.category;
      if (!state.bySource.has(k)) state.bySource.set(k, []);
      state.bySource.get(k).push(e);
    });
    state.bySource.forEach((arr) => arr.sort((a, b) => (a.seasonNumber || 0) - (b.seasonNumber || 0)));
  }

  /* ------------------------------------------------------------- poster fix */
  // Poster hamesha 2:3 box mein cover hota hai. Agar image toot jaye -> backdrop, phir placeholder.
  function placeholder(letter) {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c3aed"/>' +
      '<stop offset="1" stop-color="#3b0764"/></linearGradient></defs>' +
      '<rect width="200" height="300" fill="url(#g)"/>' +
      '<text x="100" y="175" font-size="96" font-family="Arial,sans-serif" font-weight="800" ' +
      'fill="#ffffff" fill-opacity=".9" text-anchor="middle">' + esc(letter || "A") + "</text></svg>";
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  }

  document.addEventListener("error", (ev) => {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.id) return;
    const e = state.byId.get(Number(img.dataset.id));
    if (!img.dataset.fb && e && e.backdropUrl && img.src !== e.backdropUrl) {
      img.dataset.fb = "1";
      img.src = e.backdropUrl;
      return;
    }
    if (img.dataset.ph) return;
    img.dataset.ph = "1";
    img.src = placeholder(e ? e._label : "A");
  }, true);

  function posterImg(e, cls, eager) {
    const src = e.posterUrl || e.backdropUrl || placeholder(e._label);
    return '<img ' + (cls ? 'class="' + cls + '" ' : "") + 'src="' + esc(src) + '" alt="' + esc(e.title) +
      '" data-id="' + e.id + '" ' + (eager ? "" : 'loading="lazy" ') +
      'decoding="async" referrerpolicy="no-referrer">';
  }

  /* ------------------------------------------------------------- templates */
  const catLabel = (e) => (e.category === "movie" ? "Movie" : e.category === "drama" ? "Drama" : "Series");
  const langBadge = (e) => [e.language, e.type].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" ") || catLabel(e);
  const seasonLabel = (e) => (e.category === "movie" ? "Movie" : "Season " + (e.seasonNumber || 1));

  function cardHTML(e) {
    const bottom = e.category === "movie" ? "MOVIE" : "EP " + e._count;
    return (
      '<article class="anime-card" data-id="' + e.id + '" tabindex="0" role="link" aria-label="Watch ' + esc(e.title) + '">' +
      '<div class="card-poster">' + posterImg(e) +
      '<span class="card-badge-top-left">' + esc(langBadge(e)) + "</span>" +
      (e._r > 0 ? '<span class="card-badge-top-right">&#9733; ' + e._r.toFixed(1) + "</span>" : "") +
      '<span class="card-badge-bottom">' + bottom + "</span>" +
      (e._new || e._fresh ? '<span class="card-badge-new">NEW</span>' : "") +
      '<div class="card-play-overlay"><div class="play-btn-circle"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div></div>' +
      "</div>" +
      '<div class="card-info"><div class="card-title">' + esc(e.title) + "</div>" +
      '<div class="card-meta"><span class="card-year">' + esc(e.year || "") + '</span><span class="card-status">' + esc(e.status || "") + "</span></div></div>" +
      "</article>"
    );
  }

  function badgesHTML(e, hero) {
    const b = [];
    b.push('<span class="badge-white">' + esc(catLabel(e)) + "</span>");
    b.push('<span class="badge-purple">' + esc(e.type || e.language || "") + "</span>");
    if (e._r > 0) b.push('<span class="badge-rating"><span>&#9733;</span> ' + e._r.toFixed(1) + "/10</span>");
    if (e.status) b.push('<span class="badge-purple">' + esc(e.status) + "</span>");
    if (!hero && e.year) b.push('<span class="badge-white">' + esc(e.year) + "</span>");
    return b.join("");
  }

  const emptyHTML = (title, text, retry) =>
    '<div class="empty-state"><div class="empty-title">' + esc(title) + "</div><p>" + esc(text) + "</p>" +
    (retry ? '<p style="margin-top:14px"><button class="load-more-btn" data-act="retry">Try again</button></p>' : "") + "</div>";

  /* ------------------------------------------------------------- filtering */
  function matchesGenre(e, g) {
    const k = g.toLowerCase();
    return e._genres.some((x) => x.toLowerCase().includes(k)) || e._tags.some((x) => x.toLowerCase() === k);
  }

  function filtered() {
    let l = state.all;
    if (state.cat !== "all") l = l.filter((e) => e.category === state.cat);
    if (state.lang !== "all") l = l.filter((e) => e.language === state.lang);
    if (state.status === "ongoing") l = l.filter((e) => /ongoing/i.test(e.status || ""));
    else if (state.status === "completed") l = l.filter((e) => /complet|release/i.test(e.status || ""));
    if (state.letter !== "ALL") l = l.filter((e) => e._letter === state.letter);
    if (state.genre) l = l.filter((e) => matchesGenre(e, state.genre));

    l = l.slice();
    const byLatest = (a, b) => b._ts - a._ts || Number(b.id) - Number(a.id);
    if (state.sort === "title") l.sort((a, b) => a.title.localeCompare(b.title));
    else if (state.sort === "rating") l.sort((a, b) => b._r - a._r || byLatest(a, b));
    else if (state.sort === "episodes") l.sort((a, b) => b._count - a._count || byLatest(a, b));
    else l.sort(byLatest);
    return l;
  }

  /* ---------------------------------------------------------- catalog grid */
  function renderCatalog() {
    const grid = $("anime-grid");
    const list = filtered();
    if (!state.loaded) return;
    if (!list.length) {
      grid.innerHTML = emptyHTML("No anime found", "Filters change karke dobara try karo.");
      show($("load-more-container"), false);
      return;
    }
    const slice = list.slice(0, state.shown);
    grid.innerHTML = slice.map(cardHTML).join("");
    show($("load-more-container"), list.length > slice.length, "flex");
    const btn = $("load-more-btn");
    if (btn) btn.lastChild.textContent = " Load More (" + (list.length - slice.length) + " left)";
  }

  function renderAlphabet() {
    const bar = $("alphabet-bar");
    const have = new Set(state.all.map((e) => e._letter));
    const letters = ["ALL", "#"].concat("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""));
    bar.innerHTML = letters.map((c) =>
      '<button class="alpha-chip' + (state.letter === c ? " active" : "") + '" data-letter="' + c + '"' +
      (c !== "ALL" && !have.has(c) ? ' style="opacity:.35"' : "") + ">" + c + "</button>"
    ).join("");
  }

  function renderGenres() {
    const gc = new Map();
    const tc = new Map();
    state.all.forEach((e) => {
      e._genres.forEach((g) => gc.set(g, (gc.get(g) || 0) + 1));
      e._tags.forEach((t) => { if (t !== "anime") tc.set(t, (tc.get(t) || 0) + 1); });
    });
    const top = (m, n) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n);
    const items = top(gc, 8).concat(top(tc, 18)).filter((x, i, a) => a.findIndex((y) => y[0].toLowerCase() === x[0].toLowerCase()) === i);
    $("genre-cloud").innerHTML = items.map(([name, n]) =>
      '<button class="genre-cloud-btn" data-genre="' + esc(name) + '">' + esc(name.replace(/^./, (c) => c.toUpperCase())) +
      ' <span style="opacity:.6;font-size:11px">' + n + "</span></button>"
    ).join("");
  }

  function renderLanguageSelect() {
    const sel = $("language-select");
    const cur = state.lang;
    const counts = new Map();
    state.all.forEach((e) => e.language && counts.set(e.language, (counts.get(e.language) || 0) + 1));
    const names = { FanDub: "Fan Dub" };
    sel.innerHTML = '<option value="all">All Languages</option>' +
      Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([l]) =>
        '<option value="' + esc(l) + '">' + esc(names[l] || l) + "</option>").join("");
    sel.value = counts.has(cur) ? cur : "all";
  }

  /* ----------------------------------------------------------- hero slider */
  function pickHero() {
    const seen = new Set();
    const pool = state.all
      .filter((e) => e.backdropUrl && e.description && e.category !== "drama")
      .sort((a, b) => b._ts - a._ts || Number(b.id) - Number(a.id))
      .slice(0, 60)
      .sort((a, b) => b._r - a._r);
    const out = [];
    for (const e of pool) {
      if (seen.has(e.sourceId)) continue;
      seen.add(e.sourceId);
      out.push(e);
      if (out.length === HERO_COUNT) break;
    }
    return out;
  }

  function renderHero() {
    state.heroList = pickHero();
    const slider = $("hero-slider");
    if (!state.heroList.length) { show($("hero-section"), false); return; }
    slider.innerHTML = state.heroList.map((e, i) =>
      '<div class="hero-slide' + (i === 0 ? " active" : "") + '" data-id="' + e.id + '">' +
      '<img class="hero-backdrop" src="' + esc(e.backdropUrl) + '" alt="" referrerpolicy="no-referrer" ' +
      (i === 0 ? "" : 'loading="lazy" ') + 'onerror="this.onerror=null;this.src=\'' + esc(e.posterUrl) + '\'">' +
      '<div class="hero-overlay"></div>' +
      '<div class="hero-content"><div class="hero-badges">' + badgesHTML(e, true) + "</div>" +
      '<h2 class="hero-title">' + esc(e.title) + "</h2>" +
      '<p class="hero-synopsis">' + esc(e.description) + "</p>" +
      '<div class="hero-actions">' +
      '<button class="btn-primary" data-act="hero-watch" data-id="' + e.id + '">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Watch Now</button>' +
      '<button class="btn-secondary" data-act="trailer" data-id="' + e.id + '">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg> Trailer</button>' +
      "</div></div></div>"
    ).join("");
    $("slider-dots").innerHTML = state.heroList.map((_, i) =>
      '<button class="slider-dot' + (i === 0 ? " active" : "") + '" data-slide="' + i + '" aria-label="Slide ' + (i + 1) + '"></button>').join("");
    state.heroIdx = 0;
    startHero();
  }

  function goSlide(i) {
    const n = state.heroList.length;
    if (!n) return;
    state.heroIdx = (i + n) % n;
    qsa(".hero-slide").forEach((s, k) => s.classList.toggle("active", k === state.heroIdx));
    qsa(".slider-dot").forEach((d, k) => d.classList.toggle("active", k === state.heroIdx));
  }

  function startHero() {
    clearInterval(state.heroTimer);
    state.heroTimer = setInterval(() => {
      if (document.hidden || state.nav !== "home" || state.current || state.searchActive) return;
      goSlide(state.heroIdx + 1);
    }, HERO_MS);
  }

  function renderTrending() {
    const seen = new Set();
    const list = state.all
      .filter((e) => e._r >= 7.5)
      .sort((a, b) => (/ongoing/i.test(b.status) - /ongoing/i.test(a.status)) || b._r - a._r || b._ts - a._ts)
      .filter((e) => (seen.has(e.sourceId) ? false : seen.add(e.sourceId)))
      .slice(0, 20);
    $("trending-row").innerHTML = list.map((e) => '<div class="trending-item">' + cardHTML(e) + "</div>").join("");
  }

  /* ------------------------------------------------------------- layout */
  function layout() {
    const watching = !!state.current && /^#\/watch\//.test(location.hash);
    const home = state.nav === "home";
    $("watch-section").classList.toggle("active", watching);
    $("search-results-section").classList.toggle("active", !watching && state.searchActive);
    const browse = !watching && !state.searchActive;
    show($("browse-view"), browse);
    show($("hero-section"), browse && home && state.heroList.length > 0);
    show($("trending-section"), browse && home);
    show($("genres-section"), home);
    show($("features-section"), home);
    qsa(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.nav === state.nav));
    qsa("#category-pills .filter-pill[data-cat]").forEach((b) => b.classList.toggle("active", b.dataset.cat === state.cat));
    renderGenreChip();
    $("sort-select").value = state.sort;
    $("status-select").value = state.status;
    $("language-select").value = state.lang;
    qsa(".alpha-chip").forEach((c) => c.classList.toggle("active", c.dataset.letter === state.letter));
  }

  function renderGenreChip() {
    let chip = $("genre-chip");
    if (!state.genre) { if (chip) chip.remove(); return; }
    if (!chip) {
      chip = document.createElement("button");
      chip.id = "genre-chip";
      chip.className = "filter-pill active";
      chip.title = "Genre filter hatao";
      $("category-pills").appendChild(chip);
    }
    chip.textContent = "Genre: " + state.genre + " \u00d7";
  }

  function refreshBrowse(resetPage) {
    if (resetPage !== false) state.shown = PAGE_SIZE;
    layout();
    renderCatalog();
  }

  /* ------------------------------------------------------------ navigation */
  function leaveWatch() {
    if (/^#\/watch\//.test(location.hash)) {
      history.pushState(null, "", location.pathname + location.search);
    }
    stopPlayer();
    state.current = null;
    document.title = "ToonFLIX \u2014 Free HD Anime Streaming";
    toggleCinema(false);
  }

  function setNavActive(nav, cat) {
    state.nav = nav;
    state.cat = cat || "all";
    state.letter = "ALL";
    state.genre = null;
    state.lang = "all";
    state.status = "all";
    state.sort = nav === "az" ? "title" : "latest";
    if (state.searchActive) closeSearchResults(true);
    leaveWatch();
    refreshBrowse(true);
    if (nav === "home") window.scrollTo({ top: 0, behavior: "smooth" });
    else $("catalog-controls").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function filterByGenre(g) {
    if (state.searchActive) closeSearchResults(true);
    leaveWatch();
    state.nav = "home";
    state.cat = "all";
    state.letter = "ALL";
    state.genre = g;
    state.sort = "rating";
    refreshBrowse(true);
    $("catalog-controls").scrollIntoView({ behavior: "smooth", block: "start" });
    toast("Genre: " + g);
  }

  function surpriseMe() {
    const pool = state.all.filter((e) => e.episodes.length);
    if (!pool.length) return;
    const e = pool[Math.floor(Math.random() * pool.length)];
    toast("Surprise! " + e.title);
    location.hash = "#/watch/" + e.id;
  }

  /* ---------------------------------------------------------------- search */
  function tokens(q) { return q.toLowerCase().split(/\s+/).filter(Boolean); }

  function searchAll(q) {
    const t = tokens(q);
    if (!t.length) return [];
    const full = q.trim().toLowerCase();
    return state.all
      .filter((e) => t.every((w) => e._t.includes(w)))
      .map((e) => {
        const title = e.title.toLowerCase();
        const s = (title.startsWith(full) ? 100 : title.includes(full) ? 60 : t.every((w) => title.includes(w)) ? 30 : 0) + e._r;
        return [e, s];
      })
      .sort((a, b) => b[1] - a[1])
      .map((x) => x[0]);
  }

  function highlight(title, q) {
    const t = tokens(q).map(rxEsc);
    if (!t.length) return esc(title);
    return title.split(new RegExp("(" + t.join("|") + ")", "gi"))
      .map((p, i) => (i % 2 ? "<mark>" + esc(p) + "</mark>" : esc(p))).join("");
  }

  let searchTimer;
  let ddIndex = -1;

  function renderDropdown() {
    const dd = $("search-dropdown");
    const q = $("search-input").value.trim();
    if (!q) { dd.classList.remove("active"); dd.innerHTML = ""; return; }
    const res = searchAll(q);
    ddIndex = -1;
    if (!res.length) {
      dd.innerHTML = '<div class="search-item" style="cursor:default"><div class="search-item-info"><div class="search-item-title">No anime found for "' + esc(q) + '"</div></div></div>';
    } else {
      dd.innerHTML = res.slice(0, 8).map((e) =>
        '<div class="search-item" data-id="' + e.id + '">' +
        '<img class="search-item-thumb" src="' + esc(e.posterUrl) + '" alt="" data-id="' + e.id + '" loading="lazy" referrerpolicy="no-referrer">' +
        '<div class="search-item-info"><div class="search-item-title">' + highlight(e.title, q) + "</div>" +
        '<div class="search-item-meta"><span class="search-item-badge">' + esc(langBadge(e)) + "</span><span>" + esc(catLabel(e)) + "</span>" +
        (e._r > 0 ? '<span class="search-item-rating">&#9733; ' + e._r.toFixed(1) + "</span>" : "") + "</div></div></div>"
      ).join("") +
        (res.length > 8
          ? '<div class="search-item" data-act="all-results" style="justify-content:center;font-weight:800;color:var(--purple-bright)">View all ' + res.length + " results</div>"
          : "");
    }
    dd.classList.add("active");
  }

  function runSearch() {
    const q = $("search-input").value.trim();
    if (!q) return;
    $("search-dropdown").classList.remove("active");
    leaveWatch();
    state.searchActive = true;
    state.query = q;
    const res = searchAll(q);
    $("search-query-display").textContent = q;
    $("search-results-count").textContent = "Found " + res.length + " matching anime";
    $("search-results-grid").innerHTML = res.length
      ? res.map(cardHTML).join("")
      : emptyHTML("No anime found", "Doosra naam ya genre try karo.");
    layout();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeSearchResults(silent) {
    state.searchActive = false;
    state.query = "";
    $("search-input").value = "";
    show($("clear-search-btn"), false);
    $("search-dropdown").classList.remove("active");
    if (!silent) { leaveWatch(); layout(); renderCatalog(); }
  }

  /* ----------------------------------------------------------------- watch */
  function stopPlayer() {
    const f = $("player-frame");
    if (f && f.getAttribute("src") && f.getAttribute("src") !== "about:blank") f.src = "about:blank";
  }

  function toggleCinema(on) {
    const active = typeof on === "boolean" ? on : !$("cinema-dim-backdrop").classList.contains("active");
    $("cinema-dim-backdrop").classList.toggle("active", active);
    $("cinema-light-btn").classList.toggle("active", active);
  }

  function watchedSet(id) { return new Set((store.get("ae_watched", {})[id]) || []); }
  function markWatched(id, num) {
    const all = store.get("ae_watched", {});
    const s = new Set(all[id] || []);
    s.add(num);
    all[id] = Array.from(s);
    store.set("ae_watched", all);
    const prog = store.get("ae_progress", {});
    prog[id] = num;
    store.set("ae_progress", prog);
  }

  function openAnime(id, epNum) {
    const e = state.byId.get(id);
    if (!e) { toast("Ye anime nahi mila"); history.replaceState(null, "", location.pathname); layout(); return; }
    if (!state.current) state.scrollY = window.scrollY;

    const sameAnime = state.current && state.current.id === e.id;
    state.current = e;
    if (state.searchActive) closeSearchResults(true);

    if (!sameAnime) {
      renderDetails(e);
      renderSeasons(e);
      renderRecommendations(e);
    }
    layout();

    let idx = 0;
    if (epNum != null) {
      idx = e.episodes.findIndex((x) => Number(x.number) === epNum);
    } else {
      const last = store.get("ae_progress", {})[e.id];
      idx = last != null ? e.episodes.findIndex((x) => Number(x.number) === last) : 0;
    }
    playEpisode(Math.max(0, idx), true);
    if (!sameAnime) window.scrollTo({ top: 0 });
  }

  function renderDetails(e) {
    const p = $("details-poster");
    delete p.dataset.fb; delete p.dataset.ph;
    p.dataset.id = e.id;
    p.referrerPolicy = "no-referrer";
    p.alt = e.title;
    p.src = e.posterUrl || e.backdropUrl || placeholder(e._label);
    $("details-title").textContent = e.title;
    $("details-badges").innerHTML = badgesHTML(e, false);
    $("details-synopsis").textContent = e.description || "Synopsis abhi available nahi hai.";
    $("details-genres").innerHTML = e._genres.map((g) => '<span class="genre-tag" data-genre="' + esc(g) + '">' + esc(g) + "</span>").join("");
    show($("watch-trailer-btn"), true, "inline-flex");
  }

  function renderSeasons(e) {
    const sibs = (state.bySource.get(e.sourceId + "|" + e.category) || []).filter((x) => x.episodes.length);
    const wrap = $("season-select-wrapper");
    if (sibs.length < 2) { show(wrap, false); return; }
    const multiLang = new Set(sibs.map((x) => x.language + x.type)).size > 1;
    $("season-select").innerHTML = sibs.map((x) =>
      '<option value="' + x.id + '"' + (x.id === e.id ? " selected" : "") + ">" + esc(seasonLabel(x)) +
      (multiLang ? " \u2022 " + esc(langBadge(x)) : "") + " (" + x._count + " eps)</option>").join("");
    show(wrap, true);
  }

  function renderEpisodes(e) {
    const seen = watchedSet(e.id);
    $("episodes-list").innerHTML = e.episodes.map((x, i) =>
      '<button class="episode-btn' + (seen.has(Number(x.number)) ? " watched" : "") + '" data-i="' + i + '">' + esc(x.number) + "</button>").join("");
  }

  function renderRecommendations(e) {
    const gs = new Set(e._genres.map((g) => g.toLowerCase()));
    const ts = new Set(e._tags.map((t) => t.toLowerCase()));
    const seen = new Set([e.sourceId]);
    const scored = state.all
      .filter((x) => x.sourceId !== e.sourceId && x.episodes.length)
      .map((x) => [x,
        x._tags.reduce((n, t) => n + (ts.has(t.toLowerCase()) ? 2 : 0), 0) +
        x._genres.reduce((n, g) => n + (gs.has(g.toLowerCase()) ? 1 : 0), 0) +
        (x.language === e.language ? 2 : 0) + x._r / 5])
      .sort((a, b) => b[1] - a[1])
      .map((a) => a[0])
      .filter((x) => (seen.has(x.sourceId) ? false : seen.add(x.sourceId)))
      .slice(0, 12);
    $("watch-recommendations").innerHTML = scored.map(cardHTML).join("");
  }

  function playEpisode(i, replace) {
    const e = state.current;
    if (!e || !e.episodes.length) {
      if (e) { $("player-frame").src = "about:blank"; toast("Is anime ke episodes abhi available nahi hain"); }
      return;
    }
    i = Math.min(Math.max(i, 0), e.episodes.length - 1);
    state.epIndex = i;
    const ep = e.episodes[i];
    const num = Number(ep.number);
    const frame = $("player-frame");
    if (frame.getAttribute("src") !== ep.embedUrl) frame.src = ep.embedUrl;

    $("current-playing-title").innerHTML = esc(e.title) + '<span class="ep-indicator" id="ep-indicator">' +
      (e.category === "movie" ? "MOVIE" : "EP " + num) + "</span>";
    $("prev-ep-btn").disabled = i === 0;
    $("next-ep-btn").disabled = i === e.episodes.length - 1;
    document.title = e.title + (e.category === "movie" ? "" : " - EP " + num) + " | ToonFLIX";

    markWatched(e.id, num);
    renderEpisodes(e);
    const active = qs('.episode-btn[data-i="' + i + '"]', $("episodes-list"));
    if (active) {
      active.classList.add("active");
      active.classList.remove("watched");
      const list = $("episodes-list");
      // sirf episode list ke andar scroll karo, poora page nahi
      list.scrollTop = Math.max(0, active.offsetTop - list.offsetTop - list.clientHeight / 2 + active.offsetHeight / 2);
    }
    const hash = "#/watch/" + e.id + "/" + num;
    if (location.hash !== hash) history[replace ? "replaceState" : "pushState"](null, "", hash);
  }

  function openTrailer(e) {
    if (!e) return;
    const q = encodeURIComponent(e.title.replace(/\(.*?\)/g, "").replace(/\s+Season\s+\d+/i, "").trim() + " official trailer");
    window.open("https://www.youtube.com/results?search_query=" + q, "_blank", "noopener");
  }

  function backToCatalog() {
    leaveWatch();
    layout();
    renderCatalog();
    window.scrollTo({ top: state.scrollY || 0 });
  }

  function route() {
    const m = location.hash.match(/^#\/watch\/(\d+)(?:\/(\d+))?/);
    if (m && state.loaded) openAnime(Number(m[1]), m[2] != null ? Number(m[2]) : null);
    else if (!m) {
      const wasWatching = !!state.current;
      if (wasWatching) { stopPlayer(); state.current = null; document.title = "ToonFLIX \u2014 Free HD Anime Streaming"; toggleCinema(false); }
      layout();
      if (state.loaded) { renderCatalog(); if (wasWatching) window.scrollTo({ top: state.scrollY || 0 }); }
    }
  }

  /* ----------------------------------------------------------- theme/misc */
  function toggleTheme() {
    const dark = document.body.classList.toggle("dark-mode");
    store.set("ae_dark", dark);
  }

  function copyShare() {
    const url = location.href;
    const done = () => toast("Episode link copy ho gaya!");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, fallback);
    } else fallback();
    function fallback() {
      const t = document.createElement("textarea");
      t.value = url; document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); done(); } catch (_) { toast(url); }
      t.remove();
    }
  }

  /* ---------------------------------------------------------- data loading */
  async function fetchCatalog() {
    let lastErr;
    for (const url of API_URLS) {
      try {
        const res = await fetch(url, { cache: "no-cache" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        if (!data || !Array.isArray(data.anime) || !data.anime.length) throw new Error("Empty catalog");
        return data;
      } catch (err) { lastErr = err; }
    }
    throw lastErr || new Error("Catalog load failed");
  }

  function afterLoad(first) {
    renderLanguageSelect();
    renderAlphabet();
    renderGenres();
    renderHero();
    renderTrending();
    if (first) {
      const saved = store.get("ae_dark", null);
      if (saved === true) document.body.classList.add("dark-mode");
    }
  }

  async function loadCatalog(first) {
    try {
      const data = await fetchCatalog();
      state.lastFetch = Date.now();

      if (first) {
        ingest(data.anime);
        state.loaded = true;
        afterLoad(true);
        if (/^#\/watch\//.test(location.hash)) route();
        else refreshBrowse(true);
        return;
      }

      // Auto-update: compare with what we already have
      const oldEps = new Map(state.all.map((e) => [Number(e.id), e._count]));
      const oldIds = new Set(oldEps.keys());
      ingest(data.anime);
      let newAnime = 0, newEps = 0;
      state.all.forEach((e) => {
        if (!oldIds.has(Number(e.id))) { newAnime++; e._fresh = true; newEps += e._count; }
        else if (e._count > oldEps.get(Number(e.id))) { newEps += e._count - oldEps.get(Number(e.id)); e._fresh = true; }
      });
      if (!newAnime && !newEps) return;

      if (state.current) {
        const cur = state.byId.get(Number(state.current.id));
        if (cur) { state.current = cur; renderEpisodes(cur); const a = qs('.episode-btn[data-i="' + state.epIndex + '"]'); if (a) a.classList.add("active"); renderSeasons(cur); }
      }
      afterLoad(false);
      refreshBrowse(false);
      toast(newAnime
        ? newAnime + " naya anime add hua" + (newEps ? " (" + newEps + " episodes)" : "")
        : newEps + " naye episodes add hue");
    } catch (err) {
      if (first) {
        $("anime-grid").innerHTML = emptyHTML("Catalog load nahi hua", "Internet check karo ya server (vercel dev / npm start) chalu karo.", true);
        show($("hero-section"), false);
        show($("trending-section"), false);
      }
      console.warn("Catalog:", err);
    }
  }

  /* --------------------------------------------------------------- events */
  function bind() {
    document.addEventListener("click", (ev) => {
      const t = ev.target;

      const act = t.closest("[data-act]");
      if (act) {
        const a = act.dataset.act;
        if (a === "retry") { $("anime-grid").innerHTML = emptyHTML("Loading...", "Catalog fetch ho raha hai"); loadCatalog(true); return; }
        if (a === "hero-watch") { location.hash = "#/watch/" + act.dataset.id; return; }
        if (a === "trailer") { openTrailer(state.byId.get(Number(act.dataset.id))); return; }
        if (a === "all-results") { runSearch(); return; }
      }

      const genre = t.closest("[data-genre]");
      if (genre) { filterByGenre(genre.dataset.genre); return; }

      if (t.closest("#genre-chip")) { state.genre = null; refreshBrowse(true); return; }

      const card = t.closest(".anime-card[data-id], .search-item[data-id]");
      if (card) {
        $("search-dropdown").classList.remove("active");
        location.hash = "#/watch/" + card.dataset.id;
        return;
      }

      const slide = t.closest(".hero-slide");
      if (slide && !t.closest("button")) { location.hash = "#/watch/" + slide.dataset.id; return; }

      const dot = t.closest(".slider-dot");
      if (dot) { goSlide(Number(dot.dataset.slide)); startHero(); return; }

      const chip = t.closest(".alpha-chip");
      if (chip) { state.letter = chip.dataset.letter; refreshBrowse(true); return; }

      const pill = t.closest("#category-pills .filter-pill[data-cat]");
      if (pill) {
        state.cat = pill.dataset.cat;
        state.nav = state.cat === "all" ? "home" : state.cat;
        refreshBrowse(true);
        return;
      }

      const epBtn = t.closest(".episode-btn");
      if (epBtn) { playEpisode(Number(epBtn.dataset.i)); return; }

      if (!t.closest(".search-wrapper")) $("search-dropdown").classList.remove("active");
    });

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && ev.target.classList && ev.target.classList.contains("anime-card")) {
        location.hash = "#/watch/" + ev.target.dataset.id;
      }
      if (ev.key === "Escape") {
        toggleCinema(false);
        $("search-dropdown").classList.remove("active");
        $("trailer-modal").classList.remove("active");
      }
    });

    /* header */
    const input = $("search-input");
    input.addEventListener("input", () => {
      show($("clear-search-btn"), input.value.length > 0, "block");
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderDropdown, 120);
    });
    input.addEventListener("focus", () => { if (input.value.trim()) renderDropdown(); });
    input.addEventListener("keydown", (ev) => {
      const items = qsa("#search-dropdown .search-item[data-id]");
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        if (!items.length) return;
        ev.preventDefault();
        ddIndex = (ddIndex + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items.forEach((it, k) => { it.style.background = k === ddIndex ? "var(--purple-soft)" : ""; });
        items[ddIndex].scrollIntoView({ block: "nearest" });
      } else if (ev.key === "Enter") {
        if (ddIndex >= 0 && items[ddIndex]) { location.hash = "#/watch/" + items[ddIndex].dataset.id; $("search-dropdown").classList.remove("active"); }
        else runSearch();
      }
    });
    $("search-btn").addEventListener("click", runSearch);
    $("clear-search-btn").addEventListener("click", () => {
      input.value = ""; show($("clear-search-btn"), false);
      $("search-dropdown").classList.remove("active"); input.focus();
    });
    $("close-search-results-btn").addEventListener("click", () => closeSearchResults());
    $("random-btn").addEventListener("click", surpriseMe);

    /* filters */
    $("language-select").addEventListener("change", (e) => { state.lang = e.target.value; refreshBrowse(true); });
    $("status-select").addEventListener("change", (e) => { state.status = e.target.value; refreshBrowse(true); });
    $("sort-select").addEventListener("change", (e) => { state.sort = e.target.value; refreshBrowse(true); });
    $("load-more-btn").addEventListener("click", () => { state.shown += PAGE_SIZE; renderCatalog(); });

    if ("IntersectionObserver" in window) {
      new IntersectionObserver((en) => {
        if (en[0].isIntersecting && state.loaded && !state.current && !state.searchActive) {
          const c = $("load-more-container");
          if (c && c.style.display !== "none") { state.shown += PAGE_SIZE; renderCatalog(); }
        }
      }, { rootMargin: "400px" }).observe($("load-more-container"));
    }

    /* hero */
    $("slider-prev").addEventListener("click", () => { goSlide(state.heroIdx - 1); startHero(); });
    $("slider-next").addEventListener("click", () => { goSlide(state.heroIdx + 1); startHero(); });
    const hs = $("hero-section");
    hs.addEventListener("mouseenter", () => clearInterval(state.heroTimer));
    hs.addEventListener("mouseleave", startHero);

    /* watch */
    $("back-to-browse-btn").addEventListener("click", backToCatalog);
    $("prev-ep-btn").addEventListener("click", () => playEpisode(state.epIndex - 1));
    $("next-ep-btn").addEventListener("click", () => playEpisode(state.epIndex + 1));
    $("cinema-light-btn").addEventListener("click", () => toggleCinema());
    $("cinema-dim-backdrop").addEventListener("click", () => toggleCinema(false));
    $("share-btn").addEventListener("click", copyShare);
    $("season-select").addEventListener("change", (e) => { location.hash = "#/watch/" + e.target.value; });
    $("watch-trailer-btn").addEventListener("click", () => openTrailer(state.current));

    /* trailer modal (kept for compatibility) */
    $("close-trailer-btn").addEventListener("click", () => { $("trailer-modal").classList.remove("active"); $("trailer-frame").src = ""; });

    /* footer */
    $("back-to-top-btn").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

    window.addEventListener("hashchange", route);
    window.addEventListener("popstate", route);

    /* auto-refresh */
    setInterval(() => { if (!document.hidden) loadCatalog(false); }, REFRESH_MS);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && Date.now() - state.lastFetch > REFRESH_MS) loadCatalog(false);
    });
  }

  /* ------------------------------------------------------------------ init */
  window.blakiteApp = {
    setNavActive,
    toggleTheme,
    closeSearchResults: () => closeSearchResults(),
    surpriseMe,
    filterByGenre
  };

  function init() {
    if (store.get("ae_dark", false)) document.body.classList.add("dark-mode");
    bind();
    loadCatalog(true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
