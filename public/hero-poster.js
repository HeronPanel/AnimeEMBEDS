(function () {
  var queued = false;

  function addPosters() {
    queued = false;
    document.querySelectorAll('.hero-slide').forEach(function (slide) {
      if (slide.querySelector('.hero-poster')) return;
      var bg = slide.querySelector('.hero-backdrop');
      var src = slide.dataset.poster || (bg && (bg.currentSrc || bg.src));
      if (!src) return; // image not ready yet — retried on next DOM change
      var wrap = document.createElement('div');
      wrap.className = 'hero-poster';
      var img = document.createElement('img');
      img.src = src; img.alt = ''; img.decoding = 'async';
      wrap.appendChild(img);
      slide.appendChild(wrap);
    });
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(addPosters);
  }

  function init() {
    addPosters();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
