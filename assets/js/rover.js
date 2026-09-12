/* ─────────────────────────────────────────────────────────────
   A small Mars rover that patrols the masthead.

   Spawned by `ros2 launch <package> <launch_file>` in the homepage
   terminal, removed by `pkill rover`. The flag lives in localStorage,
   so it keeps driving as you move between pages. Loaded on demand:
   readers who never find the command never download this file.

   Three things are worth knowing:

   1. The rocker-bogie is real. The bogie carries the front two wheels,
      the rocker balances that against the rear one, and the body takes
      about half the tilt of the ground. That is what the linkage is for.

   2. The terrain is drawn from the same groundAt() the suspension reads,
      so the picture and the physics cannot drift apart.

   3. Clicking fires the mast laser. It is ray-marched against the same
      groundAt(), and a direct hit on a mound destroys it. Destroyed
      mounds come back somewhere else a few seconds later.
   ───────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var KEY = 'rover';
  var MOUNTED = false;
  var TEARDOWN = null;   /* clears the running instance's timers */

  /* Geometry, in SVG user units ------------------------------------ */
  var VIEW_W = 64;
  var VIEW_H = 40;
  var GROUND = 32;           /* wheel centres on flat ground */
  var WHEELS = [12, 30, 48]; /* rear, middle, front */
  var BOGIE_X = 39;          /* bogie pivot, between middle and front */
  var ROCKER = [26, 21];     /* rocker pivot, attached to the body */
  var BOGIE = [39, 25];      /* bogie pivot, at rest */
  var BODY_ORIGIN = [30, 18];

  /* Suspension travel, in view units. Beyond this the linkage would be
     at full extension, so the ride height takes over instead. */
  var TRAVEL = 8;

  function span(a, b) {
    var dx = a[0] - b[0];
    var dy = a[1] - b[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* Arm lengths, taken from the rest pose so the drawing and the
     kinematics can never disagree. */
  var ARM_REAR = span(ROCKER, [WHEELS[0], GROUND]);
  var ARM_BOGIE = span(ROCKER, BOGIE);
  var ARM_MID = span(BOGIE, [WHEELS[1], GROUND]);
  var ARM_FRONT = span(BOGIE, [WHEELS[2], GROUND]);

  /* A rigid arm: given where the wheel needs to sit vertically, work out
     how far in it has to come to keep the arm the length it is. */
  function solveArm(pivot, length, targetY, xSign) {
    var dy = targetY - pivot[1];
    var limit = length * 0.96;
    if (dy > limit) dy = limit;
    if (dy < -limit) dy = -limit;
    return [pivot[0] + Math.sqrt(length * length - dy * dy) * xSign, pivot[1] + dy];
  }

  /* Soft limiter — approaches the stop smoothly instead of clipping. */
  function limit(v, max) {
    var t = v / max;
    return max * (t / Math.sqrt(1 + t * t));
  }

  /* Terrain --------------------------------------------------------
     A feature is a cluster of gaussian bumps, each [offsetPx, heightPx,
     widthPx]. Bumps within a feature overlap and add up, which is what
     turns them into ridges and saddles instead of separate lumps. */
  var TERRAIN_H = 62;        /* height of the terrain strip, px */

  /* Mounds are generated rather than drawn: a feature is a cluster of
     1-3 bumps whose spacing makes them overlap, so they add up into
     ridges and saddles. Every respawn gets a fresh shape. */
  function randomBumps(scale) {
    var count = 1 + Math.floor(Math.random() * 3);
    var bumps = [];
    var width = 14 + Math.random() * 14;

    for (var i = 0; i < count; i++) {
      var w = width * (0.75 + Math.random() * 0.6);
      var h = scale * (0.45 + Math.random() * 0.5);
      /* Spaced at about one width apart, which is close enough to
         compound and far enough to still read as separate humps. */
      var dx = (i - (count - 1) / 2) * w * (1.0 + Math.random() * 0.5);
      bumps.push([dx, h, w]);
    }

    /* At least one of them should reach the intended height. */
    bumps[Math.floor(Math.random() * count)][1] = scale * (0.85 + Math.random() * 0.2);
    return bumps;
  }

  /* Opening layout. `scale` is roughly the peak height in pixels; the
     massif sits in the gap between the wordmark and the navigation,
     where there is room for something big. */
  var LAYOUT = [
    { at: 0.10, scale: 10 },
    { at: 0.25, scale: 14 },
    { at: 0.44, scale: 30, major: true },
    { at: 0.70, scale: 15 },
    { at: 0.88, scale: 10 }
  ];

  var MAX_FEATURES = 36;     /* a safety net; flat space runs out first */

  var SVG = [
    '<svg viewBox="0 0 64 40" class="rover__svg" xmlns="http://www.w3.org/2000/svg">',
    '  <g fill="none" stroke="currentColor" stroke-width="1.6"',
    '     stroke-linecap="round" stroke-linejoin="round">',
    '    <path class="rover__link" data-link="rocker" />',
    '    <path class="rover__link" data-link="rocker-bogie" />',
    '    <path class="rover__link" data-link="bogie-mid" />',
    '    <path class="rover__link" data-link="bogie-front" />',
    '    <circle class="rover__pivot" data-pivot="bogie" r="1.5" fill="var(--paper)" />',
    '    <g class="rover__body">',
    '      <rect x="8" y="13" width="44" height="10" rx="3" fill="var(--paper)" />',
    '      <rect x="13" y="16" width="12" height="4" rx="1" />',
    '      <path d="M14 13 L11 6" />',
    '      <circle cx="11" cy="5" r="1.4" fill="currentColor" stroke="none" />',
    '      <g class="rover__mast">',
    '        <path d="M44 13 L44 5" />',
    '        <g class="rover__cam">',
    '          <rect x="38" y="1" width="12" height="6" rx="2" fill="var(--paper)" />',
    '          <circle class="rover__lens" cx="47" cy="4" r="1.7" fill="currentColor" stroke="none" />',
    '        </g>',
    '      </g>',
    '    </g>',
    '    <g class="rover__wheel"><circle cx="12" cy="32" r="5.5" fill="var(--paper)" />',
    '      <path d="M12 26.5 L12 37.5" /></g>',
    '    <g class="rover__wheel"><circle cx="30" cy="32" r="5.5" fill="var(--paper)" />',
    '      <path d="M30 26.5 L30 37.5" /></g>',
    '    <g class="rover__wheel"><circle cx="48" cy="32" r="5.5" fill="var(--paper)" />',
    '      <path d="M48 26.5 L48 37.5" /></g>',
    '  </g>',
    '</svg>'
  ].join('');

  function remove() {
    if (TEARDOWN) { TEARDOWN(); TEARDOWN = null; }
    ['.rover', '.rover-terrain', '.rover-laser'].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    MOUNTED = false;
  }

  function spawn() {
    if (MOUNTED || document.querySelector('.rover')) return;

    var host = document.querySelector('.masthead');
    if (!host) return;

    /* ── The ground ───────────────────────────────────────────── */

    var FADE_MS = 750;

    function arrive(f) {
      f.amount = 0;
      f.since = 0;        /* stamped on the first frame that sees it */
      f.alive = true;
      return f;
    }

    var features = LAYOUT.map(function (item, i) {
      return arrive({
        id: i,
        at: item.at,
        scale: item.scale,
        major: !!item.major,
        bumps: randomBumps(item.scale),
        amount: 0,
        since: 0,
        alive: true,
        timer: null
      });
    });

    function featureHeight(f, px, hostW) {
      if (f.amount <= 0) return 0;
      var anchor = f.at * hostW;
      var bumps = f.bumps;
      var total = 0;
      for (var b = 0; b < bumps.length; b++) {
        var t = (px - (anchor + bumps[b][0])) / bumps[b][2];
        if (t > 3.5 || t < -3.5) continue;
        total += bumps[b][1] * Math.exp(-t * t);
      }
      return total * f.amount;
    }

    function groundAt(px, hostW) {
      var total = 0;
      for (var i = 0; i < features.length; i++) {
        if (features[i].alive) total += featureHeight(features[i], px, hostW);
      }
      return total;
    }

    /* Which feature is standing at this point, if any. */
    function featureAt(px, hostW) {
      var best = null;
      var bestH = 0.8;   /* ignore the merest edge of a slope */
      for (var i = 0; i < features.length; i++) {
        if (!features[i].alive) continue;
        var h = featureHeight(features[i], px, hostW);
        if (h > bestH) { bestH = h; best = features[i]; }
      }
      return best;
    }

    /* Every place flat enough to stand a new mound on, minus wherever
       the rover happens to be. Returns null when the header is full,
       which is what stops the terrain growing for ever. */
    function flatSpots() {
      var out = [];
      var roverFrom = x - 60;
      var roverTo = x + el.offsetWidth + 60;

      for (var px = 24; px <= hostW - 24; px += 6) {
        if (px > roverFrom && px < roverTo) continue;
        if (groundAt(px, hostW) > 0.4) continue;
        if (groundAt(px - 14, hostW) > 1.5) continue;
        if (groundAt(px + 14, hostW) > 1.5) continue;
        out.push(px / hostW);
      }
      return out;
    }

    function flatSpot() {
      var spots = flatSpots();
      if (!spots.length) return null;
      return spots[Math.floor(Math.random() * spots.length)];
    }

    function scheduleReturn(f) {
      var delay = 6000 + Math.random() * 4000;   /* 6–10 seconds */
      f.timer = window.setTimeout(function () {
        f.timer = null;
        if (!MOUNTED) return;
        var spot = flatSpot();
        f.at = spot === null ? 0.06 + Math.random() * 0.88 : spot;
        /* A new shape each time, so the header never repeats itself.
           The big one stays big; the rest vary. */
        f.bumps = randomBumps(f.major ? f.scale : 8 + Math.random() * 10);
        arrive(f);
        layoutTerrain();
      }, delay);
      returnTimers.push(f.timer);
    }

    /* The terrain grows. A new mound turns up every few seconds for as
       long as there is somewhere flat to put it. */
    var growTimer = null;
    var returnTimers = [];

    function grow() {
      if (!MOUNTED) return;
      if (features.length < MAX_FEATURES) {
        var spot = flatSpot();
        if (spot !== null) {
          var big = Math.random() < 0.12;
          var scale = big ? 22 + Math.random() * 10 : 8 + Math.random() * 10;
          features.push(arrive({
            at: spot,
            scale: scale,
            major: false,
            bumps: randomBumps(scale),
            amount: 0,
            since: 0,
            alive: true,
            timer: null
          }));
          layoutTerrain();
        }
      }
      growTimer = window.setTimeout(grow, 2500 + Math.random() * 3500);
    }

    function profilePoints(hostW) {
      var pts = [];
      for (var px = 0; px <= hostW; px += 2) {
        pts.push([px, TERRAIN_H - groundAt(px, hostW)]);
      }
      return pts;
    }

    function profileLine(pts) {
      var d = 'M ' + pts[0][0] + ' ' + pts[0][1].toFixed(2);
      for (var i = 1; i < pts.length; i++) {
        d += ' L ' + pts[i][0] + ' ' + pts[i][1].toFixed(2);
      }
      return d;
    }

    /* ── Elements ─────────────────────────────────────────────── */

    var terrain = document.createElement('div');
    terrain.className = 'rover-terrain';
    terrain.setAttribute('aria-hidden', 'true');
    terrain.innerHTML =
      '<svg preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path data-terrain="fill" fill="var(--paper-sunk)" stroke="none" />' +
      '<path data-terrain="line" fill="none" stroke="currentColor" ' +
      'stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round" />' +
      '</svg>';
    host.appendChild(terrain);

    var terrainSvg = terrain.querySelector('svg');
    var terrainFill = terrain.querySelector('[data-terrain="fill"]');
    var terrainLine = terrain.querySelector('[data-terrain="line"]');

    var el = document.createElement('div');
    el.className = 'rover';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = SVG;
    host.appendChild(el);
    MOUNTED = true;

    var laser = document.createElement('div');
    laser.className = 'rover-laser';
    laser.setAttribute('aria-hidden', 'true');
    laser.innerHTML = '<svg preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"></svg>';
    host.appendChild(laser);
    var laserSvg = laser.querySelector('svg');

    var svg = el.querySelector('.rover__svg');
    var body = el.querySelector('.rover__body');
    var mast = el.querySelector('.rover__mast');
    var cam = el.querySelector('.rover__cam');
    var lens = el.querySelector('.rover__lens');
    var wheels = el.querySelectorAll('.rover__wheel');
    var bogieDot = el.querySelector('[data-pivot="bogie"]');
    var links = {
      rocker: el.querySelector('[data-link="rocker"]'),
      rockerBogie: el.querySelector('[data-link="rocker-bogie"]'),
      bogieMid: el.querySelector('[data-link="bogie-mid"]'),
      bogieFront: el.querySelector('[data-link="bogie-front"]')
    };

    var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var hostW = host.clientWidth;
    var x = still ? 0.44 * hostW - el.offsetWidth * 0.5 : hostW * 0.04;
    var dir = 1;
    var spin = 0;
    var speed = 26;               /* px per second — an unhurried pace */
    var pointer = { x: -1, y: -1, seen: false };
    var lean = 0;                 /* smoothed mast angle */
    var tilt = 0;                 /* smoothed camera angle */
    var last = 0;

    function layoutTerrain() {
      hostW = host.clientWidth;
      terrainSvg.setAttribute('viewBox', '0 0 ' + hostW + ' ' + TERRAIN_H);
      var pts = profilePoints(hostW);
      terrainFill.setAttribute('d',
        profileLine(pts) + ' L ' + hostW + ' ' + TERRAIN_H + ' L 0 ' + TERRAIN_H + ' Z');
      terrainLine.setAttribute('d', profileLine(pts));
    }
    layoutTerrain();
    window.addEventListener('resize', layoutTerrain);

    window.addEventListener('mousemove', function (e) {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.seen = true;
    }, { passive: true });

    /* ── The laser ────────────────────────────────────────────── */

    var lastShot = 0;

    function svgEl(name, attrs) {
      var node = document.createElementNS('http://www.w3.org/2000/svg', name);
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, attrs[k]);
      }
      return node;
    }

    function fire(clientX, clientY) {
      var now = Date.now();
      if (now - lastShot < 130) return;   /* no machine-gunning */
      lastShot = now;

      var hostRect = host.getBoundingClientRect();
      var hostH = host.clientHeight;
      laserSvg.setAttribute('viewBox', '0 0 ' + hostW + ' ' + hostH);

      var lensRect = lens.getBoundingClientRect();
      var lx = lensRect.left + lensRect.width / 2 - hostRect.left;
      var ly = lensRect.top + lensRect.height / 2 - hostRect.top;

      var dx = (clientX - hostRect.left) - lx;
      var dy = (clientY - hostRect.top) - ly;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) return;
      dx /= len;
      dy /= len;

      /* March until the beam meets the ground, or leaves the header. */
      var endX = lx;
      var endY = ly;
      var struck = false;
      for (var d = 3; d < 4000; d += 1.2) {
        var px = lx + dx * d;
        var py = ly + dy * d;
        if (px < -24 || px > hostW + 24 || py < -160 || py > hostH + 80) break;
        var surface = hostH - groundAt(px, hostW);
        if (py >= surface) { endX = px; endY = surface; struck = true; break; }
        endX = px;
        endY = py;
      }

      var shot = svgEl('g', { class: 'laser' });
      shot.appendChild(svgEl('line', {
        class: 'laser__glow', x1: lx, y1: ly, x2: endX, y2: endY
      }));
      shot.appendChild(svgEl('line', {
        class: 'laser__beam', x1: lx, y1: ly, x2: endX, y2: endY
      }));

      if (struck) {
        var hitFeature = featureAt(endX, hostW);
        var burst = svgEl('g', { class: 'laser__burst' + (hitFeature ? ' laser__burst--big' : '') });
        burst.setAttribute('style',
          'transform-box: view-box; transform-origin: ' +
          endX.toFixed(1) + 'px ' + endY.toFixed(1) + 'px');
        burst.appendChild(svgEl('circle', { cx: endX, cy: endY, r: hitFeature ? 8 : 5 }));
        var sparks = hitFeature ? 8 : 5;
        for (var a = 0; a < sparks; a++) {
          var ang = -Math.PI + (a / (sparks - 1)) * Math.PI;
          var reach = hitFeature ? 12 : 7;
          burst.appendChild(svgEl('line', {
            x1: endX, y1: endY,
            x2: endX + Math.cos(ang) * reach,
            y2: endY + Math.sin(ang) * reach
          }));
        }
        shot.appendChild(burst);

        /* A direct hit takes the mound with it. */
        if (hitFeature) {
          hitFeature.alive = false;
          layoutTerrain();
          scheduleReturn(hitFeature);
        }
      }

      laserSvg.appendChild(shot);
      window.setTimeout(function () {
        if (shot.parentNode) shot.parentNode.removeChild(shot);
      }, 480);
    }

    /* Capture phase, so a click on a link still fires the laser and
       still does what the click was going to do. */
    document.addEventListener('click', function (e) {
      if (!MOUNTED) return;
      fire(e.clientX, e.clientY);
    }, true);

    /* ── Drawing a frame ──────────────────────────────────────── */

    function line(node, a, b) {
      node.setAttribute('d', 'M ' + a[0].toFixed(2) + ' ' + a[1].toFixed(2) +
                             ' L ' + b[0].toFixed(2) + ' ' + b[1].toFixed(2));
    }

    /* Smoothstep, so arriving mounds ease in rather than ramp linearly. */
    function fadeIn(now) {
      var moving = false;
      for (var i = 0; i < features.length; i++) {
        var f = features[i];
        if (!f.alive || f.amount >= 1) continue;
        if (!f.since) f.since = now;
        var t = Math.min((now - f.since) / FADE_MS, 1);
        f.amount = t * t * (3 - 2 * t);
        moving = true;
      }
      return moving;
    }

    function render(dt) {
      var w = el.offsetWidth;
      var h = el.offsetHeight;
      if (!w || !h) return;

      var perUnitX = w / VIEW_W;
      var perUnitY = h / VIEW_H;

      /* ── Where each wheel is standing ─────────────────────────── */
      var lift = [];
      for (var i = 0; i < 3; i++) {
        /* Mirrored when heading left, so local x maps to the far side. */
        var localPx = WHEELS[i] * perUnitX;
        var worldPx = dir === 1 ? x + localPx : x + w - localPx;
        lift.push(groundAt(worldPx, hostW) / perUnitY);
      }

      /* ── Rocker-bogie ─────────────────────────────────────────── */
      /* The bogie pivots to the mean of its two wheels; the rocker
         balances that against the rear one. That average is the height
         the body wants to sit at. */
      var bogieLift = (lift[1] + lift[2]) / 2;
      var rearLift = lift[0];
      var ride = (rearLift + bogieLift) / 2;

      /* The rover rides the terrain, so the suspension only has to
         absorb what is left over — which stays within its travel
         however tall the mound is. */
      var relRear = limit(rearLift - ride, TRAVEL);
      var relBogie = limit(bogieLift - ride, TRAVEL);
      var rel = [
        limit(lift[0] - ride, TRAVEL),
        limit(lift[1] - ride, TRAVEL),
        limit(lift[2] - ride, TRAVEL)
      ];

      /* The differential means the body takes roughly half the tilt. */
      var pitch = -Math.atan2(relBogie - relRear, BOGIE_X - WHEELS[0]) * 180 / Math.PI * 0.55;
      if (pitch > 22) pitch = 22;
      if (pitch < -22) pitch = -22;

      body.setAttribute('transform',
        'rotate(' + pitch.toFixed(2) + ' ' + BODY_ORIGIN[0] + ' ' + BODY_ORIGIN[1] + ')');

      /* Where the rocker pivot has ended up, once the body has pitched. */
      var rad = pitch * Math.PI / 180;
      var cos = Math.cos(rad);
      var sin = Math.sin(rad);
      var rdx = ROCKER[0] - BODY_ORIGIN[0];
      var rdy = ROCKER[1] - BODY_ORIGIN[1];
      var rockerPt = [
        BODY_ORIGIN[0] + rdx * cos - rdy * sin,
        BODY_ORIGIN[1] + rdx * sin + rdy * cos
      ];

      /* Rigid arms: a wheel that rises is drawn in toward its pivot. */
      var rearPt = solveArm(rockerPt, ARM_REAR, GROUND - rel[0], -1);
      var bogiePt = solveArm(rockerPt, ARM_BOGIE, GROUND - relBogie - 7, 1);
      var midPt = solveArm(bogiePt, ARM_MID, GROUND - rel[1], -1);
      var frontPt = solveArm(bogiePt, ARM_FRONT, GROUND - rel[2], 1);
      var at = [rearPt, midPt, frontPt];

      for (var j = 0; j < wheels.length; j++) {
        wheels[j].setAttribute('transform',
          'translate(' + (at[j][0] - WHEELS[j]).toFixed(2) + ' ' +
                         (at[j][1] - GROUND).toFixed(2) + ') ' +
          'rotate(' + spin.toFixed(1) + ' ' + WHEELS[j] + ' ' + GROUND + ')');
      }

      line(links.rocker, rockerPt, rearPt);
      line(links.rockerBogie, rockerPt, bogiePt);
      line(links.bogieMid, bogiePt, midPt);
      line(links.bogieFront, bogiePt, frontPt);
      bogieDot.setAttribute('cx', bogiePt[0].toFixed(2));
      bogieDot.setAttribute('cy', bogiePt[1].toFixed(2));

      /* ── Aiming the mast camera ───────────────────────────────── */
      if (pointer.seen) {
        var box = svg.getBoundingClientRect();
        var headX = box.left + (44 / VIEW_W) * box.width;
        var headY = box.top + (4 / VIEW_H) * box.height;
        var ax = pointer.x - headX;
        var ay = pointer.y - headY;

        /* A soft curve rather than a hard clamp, so the mast keeps
           responding instead of pinning at full lock. */
        var hx = ax / 300;
        var wantLean = 34 * (hx / Math.sqrt(1 + hx * hx));
        var hy = ay / 180;
        var wantTilt = 24 * (hy / Math.sqrt(1 + hy * hy));

        /* Ease toward it: a servo taking up the movement. */
        var k = 1 - Math.pow(0.001, dt);
        lean += (wantLean - lean) * k;
        tilt += (wantTilt - tilt) * k;
      }

      /* Mirroring flips the sense of a rotation applied inside it, and
         the mast rides on the pitched body, so take that back out. */
      var mastAngle = (dir === -1 ? -lean : lean) - pitch;
      mast.setAttribute('transform', 'rotate(' + mastAngle.toFixed(2) + ' 44 13)');
      cam.setAttribute('transform',
        'rotate(' + (dir === -1 ? -tilt : tilt).toFixed(2) + ' 44 4)');

      /* Finally, put the whole vehicle where the ground says it goes. */
      el.style.transform =
        'translate(' + x.toFixed(1) + 'px, ' + (-ride * perUnitY).toFixed(1) + 'px)' +
        (dir === -1 ? ' scaleX(-1)' : '');
    }

    function frame(now) {
      if (!MOUNTED) return;
      if (!last) last = now;
      var dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      if (fadeIn(now)) layoutTerrain();

      if (!still) {
        var travelSpan = host.clientWidth - el.offsetWidth;
        x += dir * speed * dt;
        if (x <= 0) { x = 0; dir = 1; }
        else if (x >= travelSpan) { x = travelSpan; dir = -1; }

        spin += dir * speed * dt * 7;
      }

      render(dt);
      window.requestAnimationFrame(frame);
    }

    window.requestAnimationFrame(frame);
    growTimer = window.setTimeout(grow, 2500 + Math.random() * 3500);

    window.roverFeatures = function () {
      return features.map(function (f) {
        return {
          id: f.id, at: f.at, scale: f.scale,
          alive: f.alive, amount: +f.amount.toFixed(3), major: f.major
        };
      });
    };

    TEARDOWN = function () {
      window.roverFeatures = function () { return []; };
      window.clearTimeout(growTimer);
      for (var i = 0; i < returnTimers.length; i++) window.clearTimeout(returnTimers[i]);
      returnTimers = [];
    };
  }

  /* Public handles, used by the terminal. */
  window.roverLaunch = function () {
    try { localStorage.setItem(KEY, '1'); } catch (e) { /* session only, then */ }
    spawn();
  };

  /* Read-only introspection. Handy in the console, and it lets the
     terrain be checked without guessing from the drawn path. */
  window.roverFeatures = function () { return []; };

  window.roverKill = function () {
    try { localStorage.removeItem(KEY); } catch (e) { /* nothing to forget */ }
    remove();
    return true;
  };

  /* Arriving on a new page with the flag already set. */
  var wanted = false;
  try { wanted = localStorage.getItem(KEY) === '1'; } catch (e) { wanted = false; }
  if (wanted) spawn();
})();
