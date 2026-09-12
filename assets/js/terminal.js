/* ─────────────────────────────────────────────────────────────
   The homepage terminal. It is a toy, but it is a working toy.

   Adding a command: drop an entry in COMMANDS below. Return an
   array of lines. A line is either a string, or {href, text} for
   a link. That is the whole API.
   ───────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var root = document.querySelector('[data-term]');
  if (!root) return;

  var log = root.querySelector('[data-term-log]');
  var form = root.querySelector('[data-term-form]');
  var input = root.querySelector('[data-term-input]');
  var screen = root.querySelector('[data-term-screen]');
  if (!log || !form || !input || !screen) return;

  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var base = root.getAttribute('data-base') || '';
  var history = [];
  var historyAt = -1;

  /* ── The commands ─────────────────────────────────────────── */

  /* Built with explicit escapes so the art survives editing. */
  var MOMO = [
    '   / \\__',
    '  (    @\\___',
    '  /         O',
    ' /   (_____/',
    '/_____/   U',
    '',
    'Mr. Momo. Adopted 2019. Extremely good boy.',
    'tricks learned : fetch',
    'tricks pending : spin, pray, talk'
  ];

  var COMMANDS = {
    help: function () {
      return [
        'commands, such as they are:',
        '',
        '  whoami          the short answer',
        '  ls              what is lying around',
        '  cat <file>      read one of them',
        '  now             what I am doing lately',
        '  momo            the dog',
        '  uptime          how long this has been going',
        '  clear           wipe the screen',
        '',
        'or just type the name of a section: writing, photos, now, about'
      ];
    },

    whoami: function () {
      return [
        'luis — robotics engineer, sometime photographer.',
        'currently building web tools for robots, which is',
        'precisely the thing I swore I would never do.'
      ];
    },

    ls: function () {
      return [
        'writing/          the posts. mind the gap.',
        'photos/           nature, buildings, and lately people',
        'now/              what I am up to this month',
        'about/            the short version',
        'resolutions.txt   2020. ambitious.',
        'momo.txt          good boy'
      ];
    },

    cat: function (args) {
      var file = (args[0] || '').replace(/^\.\//, '');
      if (!file) return ['cat: give me a filename. try `ls`.'];

      if (file === 'resolutions.txt') {
        return [
          "new year's resolutions, 2020 edition:",
          '',
          '  [x] learn to cook 3 new dishes      (made 4, show-off)',
          "  [x] start a master's degree         (finished it, too)",
          '  [x] start and keep a blog           (you are standing in it)',
          '  [x] enroll in the robotics program',
          '  [ ] read 24 books',
          '  [ ] master cha cha cha on the ukelele',
          '  [ ] buy a couch',
          '  [ ] teach momo to spin, pray and talk',
          '  ... and eleven more in the same spirit',
          '',
          'then 2020 happened. the full list is here:',
          { href: base + '/resolutions/it-s-a-wrap/', text: 'it-s-a-wrap' }
        ];
      }
      if (file === 'momo.txt') return MOMO.slice();
      if (file === 'about.md' || file === 'about') {
        return [
          'too long for this window.',
          { href: base + '/about/', text: 'read it properly' }
        ];
      }
      return ['cat: ' + file + ': no such file or directory'];
    },

    momo: function () { return MOMO.slice(); },

    now: function () {
      return [
        'climbing, photographing people instead of landscapes,',
        'and reading slower than I promised myself I would.',
        { href: base + '/now/', text: 'the longer version' }
      ];
    },

    uptime: function () {
      var posts = parseInt(root.getAttribute('data-posts'), 10) || 0;
      var years = parseInt(root.getAttribute('data-years'), 10) || 0;
      return [
        'up ' + years + ' years, ' + posts + ' posts.',
        'load average: wildly inconsistent.'
      ];
    },

    date: function () {
      return [new Date().toString(), 'later than I meant to publish, either way.'];
    },

    sudo: function () {
      return [
        'luis is not in the sudoers file.',
        'this incident has been reported. (it has not.)'
      ];
    },

    rm: function (args) {
      if (args.join(' ').indexOf('-rf') !== -1) {
        return [
          'this is a static site on free hosting.',
          'it regenerates. like a lizard, but with more YAML.'
        ];
      }
      return ['rm: I would rather not.'];
    },

    robots: function () {
      return ['I build them. they have yet to return the favour.'];
    },

    exit: function () {
      return ['there is no exit. there is only ' , { href: base + '/about/', text: '/about/' }];
    },

    clear: function () {
      log.innerHTML = '';
      return null;
    }
  };

  /* Bare section names behave like you would hope. */
  var SECTIONS = ['writing', 'photos', 'now', 'about', 'tags', 'categories'];

  /* ── Rendering ────────────────────────────────────────────── */

  function lineEl(content, kind) {
    var li = document.createElement('li');
    li.className = 'term__line' + (kind ? ' term__line--' + kind : '');

    if (content && typeof content === 'object' && content.href) {
      var a = document.createElement('a');
      a.href = content.href;
      a.textContent = content.text;
      li.appendChild(a);
    } else {
      li.textContent = content === '' ? ' ' : String(content);
    }
    return li;
  }

  function print(lines, kind) {
    if (!lines) return;
    for (var i = 0; i < lines.length; i++) {
      log.appendChild(lineEl(lines[i], kind));
    }
    screen.scrollTop = screen.scrollHeight;
  }

  function echo(text) {
    var li = lineEl(text, 'in');
    var caret = document.createElement('span');
    caret.className = 'term__prompt';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '>';
    li.insertBefore(caret, li.firstChild);
    log.appendChild(li);
    screen.scrollTop = screen.scrollHeight;
  }

  /* ── Running a command ────────────────────────────────────── */

  function run(raw) {
    var line = raw.trim();
    if (!line) return;

    echo(line);
    history.push(line);
    historyAt = history.length;

    var parts = line.split(/\s+/);
    var name = parts[0].toLowerCase();
    var args = parts.slice(1);

    /* `cd writing`, `open writing`, or just `writing` */
    if (name === 'cd' || name === 'open') {
      name = (args[0] || '').replace(/\//g, '').toLowerCase();
      args = [];
      if (!name) { print(['where to? try `ls`.']); return; }
    }

    if (SECTIONS.indexOf(name) !== -1 && !COMMANDS[name]) {
      print(['opening /' + name + '/ ...']);
      window.setTimeout(function () {
        window.location.href = base + '/' + name + '/';
      }, 450);
      return;
    }

    if (COMMANDS[name]) {
      print(COMMANDS[name](args));
      return;
    }

    print([
      name + ': command not found.',
      'try `help`, or one of: writing, photos, now, about.'
    ]);
  }

  /* ── Boot: replay the opening exchange, typed out ──────────── */

  function typeOut(text, done) {
    if (still) {
      echo(text);
      done();
      return;
    }
    var li = lineEl('', 'in');
    var caret = document.createElement('span');
    caret.className = 'term__prompt';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '>';
    li.insertBefore(caret, li.firstChild);
    log.appendChild(li);

    var i = 0;
    (function tick() {
      li.appendChild(document.createTextNode(text.charAt(i)));
      i += 1;
      if (i < text.length) {
        window.setTimeout(tick, 55 + Math.random() * 45);
      } else {
        window.setTimeout(done, 260);
      }
    })();
  }

  function boot() {
    log.innerHTML = '';
    typeOut('whoami', function () {
      print(COMMANDS.whoami());
      print(['', 'type `help` if you want to poke around.'], 'dim');
    });
  }

  /* ── Wiring ───────────────────────────────────────────────── */

  /* Keep the input exactly as wide as its contents, so the block
     cursor after it sits where a real terminal would put it. */
  var measure = root.querySelector('[data-term-measure]');

  function fit() {
    if (!measure) return;
    measure.textContent = input.value || input.getAttribute('placeholder') || '';
    /* Round up: offsetWidth truncates, which clips the last glyph. */
    var w = Math.ceil(measure.getBoundingClientRect().width) + 3;
    input.style.width = w + 'px';
  }

  input.addEventListener('input', fit);
  window.addEventListener('resize', fit);
  fit();

  /* The mono face arrives after first paint, so measure again once it has. */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fit).catch(function () { /* fallback font it is */ });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    run(input.value);
    input.value = '';
    fit();
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowUp') {
      if (!history.length) return;
      e.preventDefault();
      historyAt = Math.max(0, historyAt - 1);
      input.value = history[historyAt] || '';
      fit();
    } else if (e.key === 'ArrowDown') {
      if (!history.length) return;
      e.preventDefault();
      historyAt = Math.min(history.length, historyAt + 1);
      input.value = history[historyAt] || '';
      fit();
    }
  });

  /* Clicking anywhere on the card puts the cursor where it belongs. */
  root.addEventListener('click', function (e) {
    if (e.target.tagName !== 'A') input.focus();
  });

  root.classList.add('term--live');

  /* Only start typing once it is actually on screen. */
  if ('IntersectionObserver' in window) {
    var seen = new IntersectionObserver(function (entries, obs) {
      if (entries[0].isIntersecting) {
        obs.disconnect();
        window.setTimeout(boot, 500);
      }
    }, { threshold: 0.35 });
    seen.observe(root);
  } else {
    boot();
  }
})();
