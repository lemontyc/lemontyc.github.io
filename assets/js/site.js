/* The entire JavaScript budget of this website. Spend it wisely. */
(function () {
  'use strict';

  var root = document.documentElement;
  var toggle = document.querySelector('.theme-toggle');
  if (!toggle) return;

  var media = window.matchMedia('(prefers-color-scheme: dark)');

  function isDark() {
    var set = root.getAttribute('data-theme');
    if (set === 'dark') return true;
    if (set === 'light') return false;
    return media.matches;
  }

  function sync() {
    toggle.setAttribute('aria-pressed', isDark() ? 'true' : 'false');
  }

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
})();
