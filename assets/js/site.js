/* Site-wide behaviour: the theme toggle, and a little motion on scroll.
   Anything bigger than this belongs in its own file. */
(function () {
  'use strict';

  var root = document.documentElement;
  var still = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* Captured now: document.currentScript is null once callbacks run. */
  var thisScript = document.currentScript;

  /* ── Theme toggle ─────────────────────────────────────────── */

  var toggle = document.querySelector('.theme-toggle');
  if (toggle) {
    var media = window.matchMedia('(prefers-color-scheme: dark)');

    var isDark = function () {
      var set = root.getAttribute('data-theme');
      if (set === 'dark') return true;
      if (set === 'light') return false;
      return media.matches;
    };

    var sync = function () {
      toggle.setAttribute('aria-pressed', isDark() ? 'true' : 'false');
    };

    toggle.addEventListener('click', function () {
      var next = isDark() ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) { /* oh well */ }
      sync();
    });

    /* If the reader has not chosen, follow the OS when it changes its mind. */
    if (media.addEventListener) {
      media.addEventListener('change', function () {
        if (!root.getAttribute('data-theme')) sync();
      });
    }

    sync();
  }

  /* ── The rover ────────────────────────────────────────────── */
  /* Loaded on demand, so nobody pays for an easter egg they have
     not found. Once launched it follows the reader from page to
     page, because the flag lives in localStorage. */

  var roverPending = null;

  window.loadRover = function (done) {
    if (window.roverLaunch) { if (done) done(); return; }

    if (!roverPending) {
      roverPending = document.createElement('script');
      roverPending.src = thisScript
        ? thisScript.src.replace('site.js', 'rover.js')
        : '/assets/js/rover.js';
      document.head.appendChild(roverPending);
    }
    if (done) roverPending.addEventListener('load', done);
  };

  var roverWanted = false;
  try { roverWanted = localStorage.getItem('rover') === '1'; } catch (e) { /* no storage */ }
  if (roverWanted) window.loadRover();

  /* ── Gallery videos ───────────────────────────────────────── */
  /* preload="none" keeps them free until wanted, so nothing loads
     until you actually point at one. */

  var clips = document.querySelectorAll('.gallery__item--video');

  Array.prototype.forEach.call(clips, function (tile) {
    var video = tile.querySelector('video');
    if (!video) return;

    var play = function () {
      tile.classList.add('is-playing');
      var started = video.play();
      if (started && started.catch) started.catch(function () {});
    };
    var stop = function () {
      tile.classList.remove('is-playing');
      video.pause();
    };

    tile.addEventListener('mouseenter', play);
    tile.addEventListener('mouseleave', stop);
    tile.addEventListener('focusin', play);
    tile.addEventListener('focusout', stop);

    /* Touch: tap toggles, since there is no hover to speak of. */
    tile.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') return;
      if (video.paused) play(); else stop();
    });
  });

  /* ── Reveal on scroll ─────────────────────────────────────── */
  /* Applied from JS only, so without JavaScript everything is
     simply visible rather than stuck at opacity zero. */

  if (still.matches || !('IntersectionObserver' in window)) return;

  var targets = document.querySelectorAll(
    '.post-item, .stats__item, .section__head, .year__label, ' +
    '.gallery__item, .post-nav__link, .pullquote, .elsewhere-card'
  );
  if (!targets.length) return;

  var observer = new IntersectionObserver(function (entries, obs) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      /* Stagger items that share a list, so rows arrive in sequence. */
      var i = Number(entry.target.getAttribute('data-reveal-i')) || 0;
      entry.target.style.transitionDelay = Math.min(i, 5) * 55 + 'ms';
      entry.target.classList.add('is-in');
      obs.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });

  var lastParent = null;
  var index = 0;

  Array.prototype.forEach.call(targets, function (el) {
    if (el.parentNode !== lastParent) { lastParent = el.parentNode; index = 0; }
    el.setAttribute('data-reveal-i', index);
    index += 1;

    el.classList.add('reveal');
    observer.observe(el);
  });
})();
