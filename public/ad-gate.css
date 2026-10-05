(function () {
  var SPONSOR_LINKS = [
    "https://www.profitableratecpmnetwork.com/ewf296sbz?key=8927b00432f278a40fa82e0bdcd73df6",
    "https://www.profitableratecpmnetwork.com/e0znzad6s?key=02065c514ea6d17af318daf31bc47159",
    "https://www.profitableratecpmnetwork.com/tvpeif1a9?key=3ddf1f37d84e07515762428262b7537a",
    "https://www.profitableratecpmnetwork.com/sbukyg4q1?key=d27f390f0d7cf6415cb8ef9077dc6a6f"
  ];
  var WAIT_SECONDS = 10;          // sponsor link kholne ke baad itne second ruko
  var STORE = "ag_unlocked_v1";

  var $ = function (id) { return document.getElementById(id); };
  var list = $("episodes-list"), frame = $("player-frame"), indicator = $("ep-indicator");
  var nextBtn = $("next-ep-btn"), prevBtn = $("prev-ep-btn"), screen = frame && frame.parentNode;
  if (!list || !frame || !screen) return;

  /* ---------- storage ---------- */
  function load() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } }
  function save(o) { try { localStorage.setItem(STORE, JSON.stringify(o)); } catch (e) {} }
  function animeKey() {
    var t = $("details-title");
    var k = t ? t.textContent.trim().toLowerCase() : "";
    return k || "default";
  }
  function isUnlocked() { return !!load()[animeKey()]; }
  function unlockNow() { var o = load(); o[animeKey()] = Date.now(); save(o); }

  /* ---------- episode helpers ---------- */
  function epNumber(el) {
    if (!el) return null;
    var d = el.getAttribute && (el.getAttribute("data-ep") || el.getAttribute("data-episode"));
    var m = (d || el.textContent || "").match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  }
  function seasonIndex() {
    var w = $("season-select-wrapper"), s = $("season-select");
    if (!w || !s || w.style.display === "none") return 0;
    return s.selectedIndex < 0 ? 0 : s.selectedIndex;
  }
  function isFree(ep, season) { return ep === 1 && season === 0; }
  function currentEp() { return epNumber(indicator); }

  /* ---------- UI ---------- */
  var lock = document.createElement("div");
  lock.id = "ag-lock";
  lock.innerHTML = '<div class="ag-ico">🔒</div><h3>Episode locked</h3>' +
    '<p>EP 1 free hai. Is anime ke saare episodes unlock karne ke liye ek baar sponsor link dekhein.</p>' +
    '<button type="button" class="ag-btn" id="ag-lock-btn" style="max-width:260px">Unlock all episodes</button>';
  screen.appendChild(lock);

  var modal = document.createElement("div");
  modal.id = "ag-modal";
  modal.innerHTML = '<div class="ag-card"><h3>Saare episodes unlock karein</h3>' +
    '<p id="ag-msg">Ek sponsor link khulega. Wapas aakar ' + WAIT_SECONDS + ' second ruko, phir is anime ke <b>saare episodes</b> unlock ho jayenge.</p>' +
    '<div class="ag-bar" id="ag-bar"><i id="ag-fill"></i></div>' +
    '<button type="button" class="ag-btn" id="ag-go">Open sponsor link</button>' +
    '<button type="button" class="ag-link" id="ag-cancel">Cancel</button></div>';
  document.body.appendChild(modal);

  var pending = null, savedSrc = "", bypass = false, timer = null;

  function openModal(el) { pending = el || null; modal.classList.add("show"); }
  function closeModal() { modal.classList.remove("show"); resetModal(); }
  function resetModal() {
    clearInterval(timer); timer = null;
    $("ag-bar").style.display = "none"; $("ag-fill").style.width = "0";
    var go = $("ag-go"); go.disabled = false; go.className = "ag-btn"; go.textContent = "Open sponsor link";
    $("ag-msg").innerHTML = 'Ek sponsor link khulega. Wapas aakar ' + WAIT_SECONDS + ' second ruko, phir is anime ke <b>saare episodes</b> unlock ho jayenge.';
  }

  $("ag-go").addEventListener("click", function () {
    var go = this;
    if (go.classList.contains("green")) { finishUnlock(); return; }
    window.open(SPONSOR_LINKS[Math.floor(Math.random() * SPONSOR_LINKS.length)], "_blank", "noopener");
    go.disabled = true;
    var left = WAIT_SECONDS;
    $("ag-bar").style.display = "block";
    $("ag-msg").textContent = "Sponsor page dekhne ke liye shukriya! Unlock ho raha hai...";
    go.textContent = "Unlocking in " + left + "s";
    setTimeout(function () { $("ag-fill").style.width = "100%"; }, 30);
    $("ag-fill").style.transitionDuration = WAIT_SECONDS + "s";
    timer = setInterval(function () {
      left--;
      if (left > 0) { go.textContent = "Unlocking in " + left + "s"; return; }
      clearInterval(timer); timer = null;
      go.disabled = false; go.className = "ag-btn green"; go.textContent = "Unlocked - Continue";
    }, 1000);
  });
  $("ag-cancel").addEventListener("click", closeModal);
  $("ag-lock-btn").addEventListener("click", function () { openModal(null); });

  function finishUnlock() {
    unlockNow();
    var el = pending; pending = null;
    closeModal(); lock.classList.remove("show");
    if (el) { bypass = true; el.click(); bypass = false; }
    else if (savedSrc) { frame.src = savedSrc; savedSrc = ""; }
  }

  /* ---------- gate: clicks ---------- */
  list.addEventListener("click", function (e) {
    if (bypass) return;
    var item = e.target.closest("#episodes-list > *");
    if (!item) return;
    var ep = epNumber(item);
    if (ep === null || isFree(ep, seasonIndex()) || isUnlocked()) return;
    e.preventDefault(); e.stopImmediatePropagation();
    openModal(item);
  }, true);

  function guardNav(btn, delta) {
    if (!btn) return;
    btn.addEventListener("click", function (e) {
      if (bypass || isUnlocked()) return;
      var cur = currentEp(); if (cur === null) return;
      var target = cur + delta;
      if (target < 1 || isFree(target, seasonIndex())) return;
      e.preventDefault(); e.stopImmediatePropagation();
      openModal(btn);
    }, true);
  }
  guardNav(nextBtn, 1); guardNav(prevBtn, -1);

  /* ---------- gate: locked episode already loaded (share link / autoplay) ---------- */
  var check = null;
  function enforce() {
    var ep = currentEp();
    if (ep === null || isUnlocked() || isFree(ep, seasonIndex())) { lock.classList.remove("show"); return; }
    var src = frame.getAttribute("src") || "";
    if (src && src !== "about:blank") { savedSrc = src; frame.setAttribute("src", "about:blank"); }
    lock.classList.add("show");
  }
  function schedule() { clearTimeout(check); check = setTimeout(enforce, 150); }
  new MutationObserver(schedule).observe(frame, { attributes: true, attributeFilter: ["src"] });
  if (indicator) new MutationObserver(schedule).observe(indicator, { childList: true, characterData: true, subtree: true });
  var title = $("details-title");
  if (title) new MutationObserver(schedule).observe(title, { childList: true, characterData: true, subtree: true });
  schedule();
})();
