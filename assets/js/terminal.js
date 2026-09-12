/* ─────────────────────────────────────────────────────────────
   The homepage terminal. It is a toy, but it is a working toy.

   Adding a command: drop an entry in COMMANDS below. Return an array
   of lines, where a line is a string or {href, text} for a link. That
   is the whole API.

   It has tabs, because `ros2 launch` latches the way the real one does
   — it holds its tab until you interrupt it — and you need somewhere
   else to stand while it runs. Each tab is an independent session with
   its own log, history and foreground process; a process in a tab you
   are not looking at keeps running.
   ───────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var root = document.querySelector('[data-term]');
  if (!root) return;

  var screen = root.querySelector('[data-term-screen]');
  var form = root.querySelector('[data-term-form]');
  var input = root.querySelector('[data-term-input]');
  var measure = root.querySelector('[data-term-measure]');
  var tabsEl = root.querySelector('[data-term-tabs]');
  var newTabBtn = root.querySelector('[data-term-newtab]');
  var firstLog = root.querySelector('[data-term-log]');
  if (!screen || !form || !input || !firstLog) return;

  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var base = root.getAttribute('data-base') || '';

  var MAX_TABS = 4;
  var sessions = [];
  var active = 0;
  var detached = false;   /* was the command line suffixed with & ? */

  /* ── Sessions ─────────────────────────────────────────────── */

  function makeSession(logEl) {
    return {
      log: logEl,
      history: [],
      historyAt: -1,
      stream: null,
      touched: false,
      booted: false,
      draft: '',
      label: 'zsh'
    };
  }

  function current() { return sessions[active]; }

  sessions.push(makeSession(firstLog));

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
      li.textContent = content === '' ? ' ' : String(content);
    }
    return li;
  }

  /* A long-running echo would otherwise grow the DOM without limit. */
  function trimLog(s) {
    while (s.log.children.length > 220) s.log.removeChild(s.log.firstChild);
  }

  function print(lines, kind, s) {
    s = s || current();
    if (!lines) return;
    for (var i = 0; i < lines.length; i++) {
      s.log.appendChild(lineEl(lines[i], kind));
    }
    trimLog(s);
    if (s === current()) screen.scrollTop = screen.scrollHeight;
  }

  function echo(text, s) {
    s = s || current();
    var li = lineEl(text, 'in');
    var caret = document.createElement('span');
    caret.className = 'term__prompt';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '>';
    li.insertBefore(caret, li.firstChild);
    s.log.appendChild(li);
    trimLog(s);
    if (s === current()) screen.scrollTop = screen.scrollHeight;
  }

  /* ── The prompt reflects whichever session you are looking at ── */

  function syncPrompt() {
    var s = current();
    input.readOnly = !!s.stream;
    input.value = s.stream ? '' : s.draft;
    input.setAttribute('placeholder',
      s.stream ? 'running — ctrl-c to stop' : 'type "help"');
    root.classList.toggle('term--busy', !!s.stream);
    fit();
  }

  /* ── Tabs ─────────────────────────────────────────────────── */

  function renderTabs() {
    if (!tabsEl) return;
    tabsEl.innerHTML = '';

    for (var i = 0; i < sessions.length; i++) {
      (function (index) {
        var s = sessions[index];
        var tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'term__tab' + (index === active ? ' is-active' : '') +
                        (s.stream ? ' is-running' : '');
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', index === active ? 'true' : 'false');
        tab.title = s.stream ? s.label + ' (running)' : s.label;

        var name = document.createElement('span');
        name.className = 'term__tab-name';
        name.textContent = s.label;
        tab.appendChild(name);

        tab.addEventListener('click', function () { selectTab(index); });
        tabsEl.appendChild(tab);

        if (sessions.length > 1) {
          var close = document.createElement('button');
          close.type = 'button';
          close.className = 'term__tab-close';
          close.setAttribute('aria-label', 'Close tab ' + (index + 1));
          close.title = 'close tab';
          close.textContent = '×';
          close.addEventListener('click', function (e) {
            e.stopPropagation();
            closeTab(index);
          });
          tab.appendChild(close);
        }
      })(i);
    }

    if (newTabBtn) newTabBtn.disabled = sessions.length >= MAX_TABS;
  }

  function showActiveLog() {
    for (var i = 0; i < sessions.length; i++) {
      sessions[i].log.hidden = (i !== active);
    }
    screen.scrollTop = screen.scrollHeight;
  }

  function selectTab(i) {
    if (i === active || i < 0 || i >= sessions.length) return;
    if (!current().stream) current().draft = input.value;
    active = i;
    showActiveLog();
    renderTabs();
    syncPrompt();
    input.focus();
  }

  function addTab() {
    if (sessions.length >= MAX_TABS) return;
    if (!current().stream) current().draft = input.value;

    var log = document.createElement('ol');
    log.className = 'term__log';
    screen.insertBefore(log, form);

    var s = makeSession(log);
    s.booted = true;               /* no boot animation on later tabs */
    sessions.push(s);
    active = sessions.length - 1;

    print(['a fresh shell. `help` still works.'], 'dim', s);
    showActiveLog();
    renderTabs();
    syncPrompt();
    input.focus();
  }

  function closeTab(i) {
    if (sessions.length <= 1) return;
    var s = sessions[i];

    /* Closing a terminal hangs up whatever it was running. */
    if (s.stream) endStream(s, null);

    if (s.log.parentNode) s.log.parentNode.removeChild(s.log);
    sessions.splice(i, 1);
    if (active >= sessions.length) active = sessions.length - 1;
    else if (i < active) active -= 1;

    showActiveLog();
    renderTabs();
    syncPrompt();
  }

  /* ── Foreground "processes" ───────────────────────────────────
     Real ros2 commands hold the terminal and keep printing until you
     interrupt them. So do these — and they keep printing into their
     own tab while you work in another one. */

  function startStream(opts) {
    var s = current();
    if (s.stream) endStream(s, null);

    s.stream = opts;
    s.label = opts.label || 'proc';
    opts.session = s;

    opts.timer = window.setInterval(function () {
      var lines = opts.tick();
      if (lines === false) {              /* the process ended on its own */
        endStream(s, opts.onExit ? opts.onExit() : ['[process exited]']);
        return;
      }
      if (lines && lines.length) print(lines, null, s);
    }, opts.every);

    renderTabs();
    syncPrompt();
  }

  /* Stop without the ^C — used when a process exits or a tab closes. */
  function endStream(s, closingLines) {
    if (!s.stream) return false;
    window.clearInterval(s.stream.timer);
    var ending = s.stream.onStop;
    s.stream = null;
    s.label = 'zsh';

    if (closingLines) {
      print(closingLines, 'dim', s);
    } else if (ending) {
      ending();                            /* side effects only */
    }

    renderTabs();
    if (s === current()) syncPrompt();
    return true;
  }

  /* The interrupt proper. */
  function interrupt() {
    var s = current();
    if (!s.stream) return false;
    var ending = s.stream.onStop;
    window.clearInterval(s.stream.timer);
    s.stream = null;
    s.label = 'zsh';

    echo('^C', s);
    if (ending) print(ending(), 'dim', s);

    renderTabs();
    syncPrompt();
    return true;
  }

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
        '  ros2            ... you know how this one goes',
        '',
        'tab completes. up arrow repeats. ctrl-c interrupts.',
        '+ opens another shell, for when something is latched.',
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
      if (sessions.length > 1) {
        var i = active;
        window.setTimeout(function () { closeTab(i); }, 0);
        return ['exit'];
      }
      return ['there is no exit. there is only ', { href: base + '/about/', text: '/about/' }];
    },

    /* The good one. Launch a node and a rover turns up in the header. */
    ros2: function (args) {
      var verb = (args[0] || '').toLowerCase();

      /* ── Live readings, taken off the rover itself ───────────── */

      function running() { return document.querySelector('.rover') !== null; }

      function angleOf(sel) {
        var node = document.querySelector(sel);
        var t = node ? (node.getAttribute('transform') || '') : '';
        var m = t.match(/rotate\(([-\d.]+)/);
        return m ? parseFloat(m[1]) : 0;
      }

      function roverX() {
        var el = document.querySelector('.rover');
        if (!el) return 0;
        var m = (el.style.transform || '').match(/translateX\(([-\d.]+)px\)/);
        return m ? parseFloat(m[1]) : 0;
      }

      function heading() {
        var el = document.querySelector('.rover');
        return el && (el.style.transform || '').indexOf('scaleX(-1)') !== -1 ? -1 : 1;
      }

      function wheelLift(i) {
        var g = document.querySelectorAll('.rover__wheel')[i];
        var t = g ? (g.getAttribute('transform') || '') : '';
        var m = t.match(/translate\(0 ([-\d.]+)\)/);
        return m ? -parseFloat(m[1]) : 0;
      }

      function rad(deg) { return (deg / 180 * Math.PI).toFixed(4); }
      function stamp() {
        var t = Date.now();
        return '  stamp: {sec: ' + Math.floor(t / 1000) + ', nanosec: ' +
               ((t % 1000) * 1e6) + '}';
      }

      /* ── What each topic publishes ──────────────────────────── */

      var TOPICS = {
        '/mast_camera/pose': function () {
          return [
            'header:',
            stamp(),
            '  frame_id: mast_link',
            'orientation:',
            '  yaw: ' + rad(angleOf('.rover__mast')),
            '  pitch: ' + rad(angleOf('.rover__cam')),
            '---'
          ];
        },
        '/wheel_odom': function () {
          return [
            'header:',
            stamp(),
            '  frame_id: odom',
            'pose:',
            '  position: {x: ' + roverX().toFixed(2) + ', y: 0.00, z: 0.00}',
            'twist:',
            '  linear: {x: ' + (0.026 * heading()).toFixed(3) + ', y: 0.0, z: 0.0}',
            '---'
          ];
        },
        '/wheel_states': function () {
          return [
            'header:',
            stamp(),
            'name: [rear, middle, front]',
            'position: [' + wheelLift(0).toFixed(2) + ', ' +
              wheelLift(1).toFixed(2) + ', ' + wheelLift(2).toFixed(2) + ']',
            '---'
          ];
        },
        '/cmd_vel': function () {
          return [
            'linear: {x: ' + (0.026 * heading()).toFixed(3) + ', y: 0.0, z: 0.0}',
            'angular: {x: 0.0, y: 0.0, z: 0.0}',
            '---'
          ];
        },
        '/rosout': function () {
          var lifts = wheelLift(0) + wheelLift(1) + wheelLift(2);
          return [
            '[INFO] [' + new Date().toTimeString().slice(0, 8) + '] [rover_node]: ' +
              (lifts > 1.5 ? 'suspension articulating over terrain'
                           : 'traversing flat ground'),
            '---'
          ];
        },
        '/parameter_events': function () {
          return ['(no parameter changes)', '---'];
        }
      };

      var TOPIC_NAMES = ['/cmd_vel', '/mast_camera/pose', '/parameter_events',
                         '/rosout', '/wheel_odom', '/wheel_states'];

      function startRover() {
        if (window.loadRover) {
          window.loadRover(function () {
            if (window.roverLaunch) window.roverLaunch();
          });
        }
      }

      /* ── launch ─────────────────────────────────────────────── */

      if (verb === 'launch') {
        if (!args[1]) {
          return [
            'usage: ros2 launch [-h] [-n] [-d] [-p] [-s]',
            '                   package_name [launch_file_name]',
            'ros2 launch: error: the following arguments are required:',
            '  package_name',
            '',
            'try: ros2 launch mars_rover rover.launch.py'
          ];
        }
        if (!args[2]) {
          return [
            'ros2 launch: error: the following arguments are required:',
            '  launch_file_name',
            '',
            'try: ros2 launch ' + args[1] + ' rover.launch.py'
          ];
        }

        var pkg = args[1];
        var file = args[2];
        startRover();

        var head = [
          '[INFO] [launch]: All log files can be found below',
          '       /home/luis/.ros/log/' +
            new Date().toISOString().slice(0, 19).replace('T', '-'),
          '[INFO] [launch]: Default logging verbosity is set to INFO',
          '[INFO] [' + file + ']: found in package [' + pkg + ']',
          '[INFO] [rover_node-1]: process started with pid [2026]',
          '[rover_node-1] [INFO] mobility      : nominal',
          '[rover_node-1] [INFO] rocker-bogie  : all six wheels on the ground',
          '[rover_node-1] [INFO] mast camera   : tracking'
        ];

        if (detached) {
          return head.concat([
            '[2026] running in the background',
            '',
            'a rover is patrolling the header, and will follow you to the',
            'other pages. `pkill rover` when you have had enough.'
          ]);
        }

        startStream({
          label: 'ros2 launch',
          every: 2600,
          tick: function () {
            if (!running()) return false;
            var lifts = wheelLift(0) + wheelLift(1) + wheelLift(2);
            return ['[rover_node-1] [INFO] ' + (lifts > 1.5
              ? 'terrain: articulating, body within limits'
              : 'terrain: flat, odom x=' + roverX().toFixed(1))];
          },
          onExit: function () {
            return ['[INFO] [rover_node-1]: process has died [pid 2026]',
                    '[INFO] [launch]: shutting down'];
          },
          onStop: function () {
            if (window.roverKill) window.roverKill();
            return [
              '[INFO] [launch]: process[rover_node-1] was SIGINT',
              '[rover_node-1] [INFO] shutting down',
              '[INFO] [rover_node-1]: process has finished cleanly [pid 2026]',
              '',
              'to keep the rover, background it or use another tab:',
              '  ros2 launch ' + pkg + ' ' + file + ' &'
            ];
          }
        });

        return head.concat(['', '(latched — ctrl-c to shut down, or open a tab with +)']);
      }

      /* ── run ────────────────────────────────────────────────── */

      if (verb === 'run') {
        if (!args[1] || !args[2]) {
          return [
            'usage: ros2 run [-h] package_name executable_name',
            'ros2 run: error: the following arguments are required:',
            '  ' + (!args[1] ? 'package_name, executable_name' : 'executable_name'),
            '',
            'try: ros2 run mars_rover drive'
          ];
        }
        startRover();
        var exe = args[2];
        var head2 = ['[INFO] [' + exe + ']: started from package [' + args[1] + ']'];

        if (detached) {
          return head2.concat(['[2026] running in the background',
            '', 'a rover is patrolling the header. `pkill rover` to stop it.']);
        }

        startStream({
          label: 'ros2 run',
          every: 2600,
          tick: function () {
            if (!running()) return false;
            return ['[' + exe + '] [INFO] odom x=' + roverX().toFixed(1) +
                    ' heading=' + (heading() > 0 ? 'east' : 'west')];
          },
          onExit: function () {
            return ['[INFO] [' + exe + ']: process has died [pid 2026]'];
          },
          onStop: function () {
            if (window.roverKill) window.roverKill();
            return ['[INFO] [' + exe + ']: process has finished cleanly [pid 2026]'];
          }
        });

        return head2.concat(['', '(latched — ctrl-c to stop, or open a tab with +)']);
      }

      /* ── node ───────────────────────────────────────────────── */

      if (verb === 'node') {
        var nodeSub = (args[1] || '').toLowerCase();
        if (nodeSub === 'list') {
          return running()
            ? ['/rover_node']
            : ['(nothing running — try `ros2 launch mars_rover rover.launch.py`)'];
        }
        if (nodeSub === 'info') {
          if (!args[2]) {
            return ['ros2 node info: error: the following arguments are required: node_name'];
          }
          if (!running() || args[2] !== '/rover_node') {
            return ['Unable to find node ' + args[2]];
          }
          return [
            '/rover_node',
            '  Publishers:',
            '    /mast_camera/pose: geometry_msgs/msg/Pose',
            '    /rosout: rcl_interfaces/msg/Log',
            '    /wheel_odom: nav_msgs/msg/Odometry',
            '    /wheel_states: sensor_msgs/msg/JointState',
            '  Subscribers:',
            '    /cmd_vel: geometry_msgs/msg/Twist'
          ];
        }
        return [
          'usage: ros2 node [-h] Call `ros2 node <command> -h` for more detail.',
          '',
          'commands:',
          '  list   output a list of available nodes',
          '  info   output information about a node'
        ];
      }

      /* ── topic ──────────────────────────────────────────────── */

      if (verb === 'topic') {
        var topicSub = (args[1] || '').toLowerCase();

        if (topicSub === 'list') {
          return running() ? TOPIC_NAMES.slice() : ['/parameter_events', '/rosout'];
        }

        if (topicSub === 'echo') {
          var topic = args[2];
          if (!topic) {
            return ['ros2 topic echo: error: the following arguments are required: topic_name'];
          }
          if (!TOPICS[topic]) {
            return ['(no publishers on ' + topic + ')',
                    'known topics: ' + TOPIC_NAMES.join(' ')];
          }
          if (!running() && topic !== '/rosout' && topic !== '/parameter_events') {
            return ['(no publishers on ' + topic + ' — nothing is running)'];
          }

          var produce = TOPICS[topic];
          startStream({
            label: 'topic echo',
            every: 700,
            tick: produce,
            onStop: function () { return []; }
          });
          return produce();
        }

        if (topicSub === 'hz') {
          if (!args[2] || !TOPICS[args[2]]) {
            return ['ros2 topic hz: error: a known topic_name is required'];
          }
          startStream({
            label: 'topic hz',
            every: 1000,
            tick: function () {
              return ['average rate: ' + (1.43 + Math.random() * 0.06).toFixed(3),
                      '  min: 0.680s max: 0.712s std dev: 0.0104s'];
            },
            onStop: function () { return []; }
          });
          return ['subscribed to [' + args[2] + ']'];
        }

        return [
          'usage: ros2 topic [-h] Call `ros2 topic <command> -h` for more detail.',
          '',
          'commands:',
          '  list   output a list of available topics',
          '  echo   output messages from a topic',
          '  hz     print the publishing rate of a topic'
        ];
      }

      if (verb === 'kill' || verb === 'stop') return COMMANDS.pkill(['rover']);

      return [
        'usage: ros2 [-h] Call `ros2 <command> -h` for more detail.',
        '',
        'commands:',
        '  launch   run a launch file from a package',
        '  run      run an executable from a package',
        '  node     print running nodes',
        '  topic    print active topics',
        '',
        'try: ros2 launch mars_rover rover.launch.py'
      ];
    },

    pkill: function (args) {
      var target = (args[0] || '').toLowerCase();
      if (target !== 'rover') return ['pkill: no process matching "' + (args[0] || '') + '"'];
      if (!window.roverKill || !document.querySelector('.rover')) {
        return ['pkill: no rover running.'];
      }
      window.roverKill();
      return ['[rover-1] process has finished cleanly [pid 2026]', 'safe travels.'];
    },

    clear: function () {
      current().log.innerHTML = '';
      return null;
    }
  };

  /* Bare section names behave like you would hope. */
  var SECTIONS = ['writing', 'photos', 'now', 'about', 'tags', 'categories'];

  /* Things `cat` knows about, for completion. */
  var FILES = ['resolutions.txt', 'momo.txt', 'about.md'];

  /* ── Tab completion ───────────────────────────────────────── */

  function unique(list) {
    var seen = {};
    return list.filter(function (item) {
      if (seen[item]) return false;
      seen[item] = true;
      return true;
    }).sort();
  }

  function contextFor(value) {
    var parts = value.split(/\s+/);
    var word = parts[parts.length - 1];

    if (parts.length <= 1) {
      return { word: word, list: unique(Object.keys(COMMANDS).concat(SECTIONS)) };
    }

    var head = parts[0].toLowerCase();
    if (head === 'cat') return { word: word, list: FILES };
    if (head === 'cd' || head === 'open') return { word: word, list: SECTIONS };
    if (head === 'pkill') return { word: word, list: ['rover'] };
    if (head === 'ros2') {
      var verb = (parts[1] || '').toLowerCase();
      if (parts.length === 2) return { word: word, list: ['launch', 'node', 'run', 'topic'] };
      if (verb === 'node' && parts.length === 3) return { word: word, list: ['info', 'list'] };
      if (verb === 'topic' && parts.length === 3) {
        return { word: word, list: ['echo', 'hz', 'list'] };
      }
      if (verb === 'topic' && parts.length === 4) {
        return { word: word, list: ['/cmd_vel', '/mast_camera/pose', '/parameter_events',
                                    '/rosout', '/wheel_odom', '/wheel_states'] };
      }
      if (verb === 'node' && parts.length === 4) return { word: word, list: ['/rover_node'] };
      if ((verb === 'launch' || verb === 'run') && parts.length === 3) {
        return { word: word, list: ['mars_rover'] };
      }
      if (verb === 'launch' && parts.length === 4) return { word: word, list: ['rover.launch.py'] };
      if (verb === 'run' && parts.length === 4) return { word: word, list: ['drive'] };
    }
    return null;
  }

  function commonPrefix(list) {
    if (!list.length) return '';
    var prefix = list[0];
    for (var i = 1; i < list.length; i++) {
      var j = 0;
      while (j < prefix.length && j < list[i].length && prefix.charAt(j) === list[i].charAt(j)) j++;
      prefix = prefix.slice(0, j);
      if (!prefix) break;
    }
    return prefix;
  }

  function complete() {
    var ctx = contextFor(input.value);
    if (!ctx) return;

    var word = ctx.word.toLowerCase();
    var hits = ctx.list.filter(function (item) { return item.indexOf(word) === 0; });
    if (!hits.length) return;

    var fill = hits.length === 1 ? hits[0] + ' ' : commonPrefix(hits);
    var head = input.value.slice(0, input.value.length - ctx.word.length);

    if (fill && fill !== ctx.word) {
      input.value = head + fill;
      fit();
      return;
    }
    if (hits.length > 1) print([hits.join('   ')], 'dim');
  }

  /* ── Running a command ────────────────────────────────────── */

  function run(raw) {
    var line = raw.trim();
    if (!line) return;
    var s = current();
    s.touched = true;

    /* A trailing & backgrounds the command, exactly as a shell would. */
    detached = /&\s*$/.test(line);
    if (detached) line = line.replace(/\s*&\s*$/, '');

    echo(line, s);
    s.history.push(line);
    s.historyAt = s.history.length;

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
      print(COMMANDS[name](args), null, s);
      return;
    }

    print([
      name + ': command not found.',
      'try `help`, or one of: writing, photos, now, about.'
    ], null, s);
  }

  /* ── Sizing the input so the block cursor follows the text ─── */

  function fit() {
    if (!measure) return;
    measure.textContent = input.value || input.getAttribute('placeholder') || '';
    /* Round up: offsetWidth truncates, which clips the last glyph. */
    input.style.width = (Math.ceil(measure.getBoundingClientRect().width) + 3) + 'px';
  }

  /* ── Boot: replay the opening exchange, typed out ──────────── */

  function typeOut(text, done) {
    var s = current();
    if (still) {
      echo(text, s);
      done();
      return;
    }
    var li = lineEl('', 'in');
    var caret = document.createElement('span');
    caret.className = 'term__prompt';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '>';
    li.insertBefore(caret, li.firstChild);
    s.log.appendChild(li);

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
    var s = sessions[0];
    /* Someone got here first. Leave their session alone. */
    if (s.touched || s.booted) return;
    s.booted = true;
    s.log.innerHTML = '';
    typeOut('whoami', function () {
      print(COMMANDS.whoami(), null, s);
      print(['', 'type `help` if you want to poke around.'], 'dim', s);
    });
  }

  /* ── Wiring ───────────────────────────────────────────────── */

  input.addEventListener('input', function () {
    current().touched = true;
    current().draft = input.value;
    fit();
  });
  window.addEventListener('resize', fit);
  fit();

  /* The mono face arrives after first paint, so measure again once it has. */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fit).catch(function () { /* fallback font it is */ });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (current().stream) return;      /* a process has this tab */
    run(input.value);
    input.value = '';
    current().draft = '';
    fit();
  });

  input.addEventListener('keydown', function (e) {
    var s = current();
    if (s.stream && e.key !== 'Escape') return;

    if (e.key === 'Tab') {
      /* Tab is how keyboard users move around, so only swallow it when
         there is genuinely something to complete. Shift+Tab always
         leaves, and so does Tab on an empty line. */
      if (e.shiftKey || !input.value) return;
      e.preventDefault();
      complete();
      return;
    }

    if (e.key === 'Escape') {
      if (s.stream) { e.preventDefault(); interrupt(); return; }
      if (input.value) { input.value = ''; s.draft = ''; fit(); }
      else input.blur();
      return;
    }

    if (e.key === 'ArrowUp') {
      if (!s.history.length) return;
      e.preventDefault();
      s.historyAt = Math.max(0, s.historyAt - 1);
      input.value = s.history[s.historyAt] || '';
      fit();
    } else if (e.key === 'ArrowDown') {
      if (!s.history.length) return;
      e.preventDefault();
      s.historyAt = Math.min(s.history.length, s.historyAt + 1);
      input.value = s.history[s.historyAt] || '';
      fit();
    }
  });

  /* ctrl-c interrupts whatever this tab is running, from anywhere on
     the page — but never when there is a selection, so copying works. */
  document.addEventListener('keydown', function (e) {
    if (!current().stream) return;
    var isC = (e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C');
    if (!isC) return;
    var selected = window.getSelection && String(window.getSelection());
    if (selected) return;
    e.preventDefault();
    interrupt();
    input.focus();
  });

  if (newTabBtn) newTabBtn.addEventListener('click', addTab);

  /* Clicking the card puts the cursor where it belongs. */
  root.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.term__bar')) return;
    if (e.target.tagName !== 'A') input.focus();
  });

  root.classList.add('term--live');
  showActiveLog();
  renderTabs();
  syncPrompt();

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
