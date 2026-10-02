/* Adds a poster card on the right side of every hero slide.
   Add to your HTML (before </body>):  <script src="hero-poster.js" defer></script>
   By default it reuses the slide's backdrop image. If a slide has its own poster URL,
   give the slide  data-poster="URL"  and that will be used instead. */
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
      img.alt = ''; img.decoding = 'async';
      // match the card to the image's real ratio so nothing gets cropped
      function setRatio() { if (img.naturalWidth) wrap.style.setProperty('--r', img.naturalWidth / img.naturalHeight); }
      img.addEventListener('load', setRatio);
      img.src = src;
      if (img.complete) setRatio();
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
