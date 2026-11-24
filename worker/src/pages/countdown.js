// Countdown (v2) page (moved verbatim from index.js, #3).

import { brand } from '../brand.js';
import { coupleNames, escHtml, escapeAttr } from '../lib/text.js';
import { siteHost, siteOrigin } from '../site.js';

// ---------------------------------------------------------------------------
// v2 "Countdown" page — the coming-soon layout (v1) plus a live countdown to
// the wedding date entered in the plan. Served on the v2 preview host and on
// the public apex whenever Countdown is the live mode.
// ---------------------------------------------------------------------------
export function countdownPage(method = 'GET', opts = {}) {
  const { n1, n2 } = coupleNames(opts);
  const weddingDate = opts.wedding_date || '';
  let dateLine = '';
  if (weddingDate) {
    const d = new Date(weddingDate);
    if (!Number.isNaN(d.getTime())) {
      dateLine = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    }
  }
  const countdownHtml = weddingDate
    ? `<div class="countdown" id="countdown-box" data-countdown="${escHtml(weddingDate)}" role="timer" aria-label="Countdown to the wedding">
      <div class="cell"><span class="num" id="cd-d">0</span><span class="lbl">days</span></div>
      <div class="cell"><span class="num" id="cd-h">00</span><span class="lbl">hours</span></div>
      <div class="cell"><span class="num" id="cd-m">00</span><span class="lbl">minutes</span></div>
      <div class="cell"><span class="num" id="cd-s">00</span><span class="lbl">seconds</span></div>
    </div>`
    : '';
  const dateLineHtml = weddingDate
    ? `<p class="weddate">${dateLine}</p>`
    : '<p class="weddate none">The date is coming soon</p>';
  const noteHtml = weddingDate
    ? "We&rsquo;re counting down the days &mdash; details and invitations will follow."
    : "The details are still being planned &mdash; we&rsquo;ll share them here soon.";
  const html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${n1} &amp; ${n2} | Counting down</title>
<meta name="description" content="${n1} and ${n2} are getting married. Counting down the days.">
<meta name="theme-color" content="#F2F3EA" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#161F1A" media="(prefers-color-scheme: dark)">

<meta property="og:type" content="website">
<meta property="og:url" content="${siteOrigin()}/">
<meta property="og:title" content="${n1} &amp; ${n2} are getting married">
<meta property="og:description" content="Counting down the days — ${n1} and ${n2} are getting married.">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${n1} &amp; ${n2} are getting married">
<meta name="twitter:description" content="Counting down the days — ${n1} and ${n2} are getting married.">

<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath d='M12 52C12 26 30 10 54 10 54 36 38 54 12 52Z' fill='%237D9382'/%3E%3Cpath d='M12 52L42 22' stroke='%23F2F3EA' stroke-width='3' fill='none' stroke-linecap='round'/%3E%3C/svg%3E">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Jost:wght@300;400&display=swap" rel="stylesheet">

<style>
  :root {
    --paper:     #F2F3EA;
    --ink:       #26362D;
    --muted:     #526158;
    --sage:      #86A08D;
    --sage-deep: #4C6455;
    --gold:      #9A7B3F;
    --serif: "Cormorant Garamond", "Iowan Old Style", Georgia, serif;
    --sans:  "Jost", "Avenir Next", "Segoe UI", system-ui, sans-serif;
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper:     #161F1A;
      --ink:       #ECEDE2;
      --muted:     #A9B5AB;
      --sage:      #7F9986;
      --sage-deep: #9DB6A4;
      --gold:      #C9AD6B;
    }
  }

  *, *::before, *::after { box-sizing: border-box; }
  html { height: 100%; }
  body {
    margin: 0;
    min-height: 100vh;
    min-height: 100svh;
    display: flex;
    flex-direction: column;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--sans);
    font-weight: 300;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: max(2rem, env(safe-area-inset-top)) 1.25rem 1rem;
    text-align: center;
  }

  /* ---------- Wreath + names ---------- */
  .crest {
    position: relative;
    width: min(92vw, 33rem);
    aspect-ratio: 1;
    container-type: inline-size;
  }
  #wreath {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .stem {
    fill: none;
    stroke: var(--sage-deep);
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    animation: draw 2.6s cubic-bezier(.45, 0, .2, 1) .2s forwards;
  }
  .leaf {
    opacity: 0;
    transform-origin: 0 0;
    animation: sprout .8s ease-out forwards;
    animation-delay: calc(.45s + var(--i) * .15s);
  }
  .leaf path:first-child {
    fill: var(--sage);
    fill-opacity: .24;
    stroke: var(--sage-deep);
    stroke-width: 1;
    stroke-linejoin: round;
  }
  .leaf .vein {
    fill: none;
    stroke: var(--sage-deep);
    stroke-width: .6;
    opacity: .65;
  }
  .berry {
    fill: var(--gold);
    opacity: 0;
    animation: pop .6s ease-out forwards;
    animation-delay: calc(.6s + var(--i) * .15s);
  }

  h1 {
    position: absolute;
    inset: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-family: var(--serif);
    font-weight: 300;
    font-size: clamp(2.6rem, 14vw, 5.2rem);
    font-size: 16cqw;
    line-height: .95;
    letter-spacing: .01em;
    opacity: 0;
    animation: fade 1.6s ease forwards 1.3s;
  }
  h1 .amp {
    font-style: italic;
    font-weight: 300;
    font-size: .5em;
    line-height: 1.15;
    color: var(--gold);
  }

  /* ---------- Copy ---------- */
  .lede {
    margin: 1.1rem 0 0;
    font-family: var(--serif);
    font-style: italic;
    font-weight: 400;
    font-size: clamp(1.5rem, 5.4vw, 2.1rem);
    line-height: 1.2;
    opacity: 0;
    animation: fade 1.4s ease forwards 2.3s;
  }

  /* ---------- Countdown ---------- */
  .countdown {
    display: flex;
    flex-wrap: wrap;
    gap: clamp(1rem, 5vw, 2.25rem);
    justify-content: center;
    margin: 2rem 0 0;
    opacity: 0;
    animation: fade 1.4s ease forwards 2.4s;
  }
  .cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: .35rem;
    min-width: 4.5rem;
    padding-bottom: .6rem;
    border-bottom: 1px solid color-mix(in srgb, var(--gold) 45%, transparent);
  }
  .cell .num {
    font-family: var(--serif);
    font-weight: 400;
    font-size: clamp(2.4rem, 9vw, 3.5rem);
    line-height: 1;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .cell .lbl {
    font-size: .72rem;
    letter-spacing: .22em;
    text-transform: uppercase;
    color: var(--gold);
  }
  .today {
    margin: 0;
    font-family: var(--serif);
    font-style: italic;
    font-weight: 400;
    font-size: clamp(1.6rem, 6vw, 2.4rem);
    color: var(--gold);
  }
  p.weddate {
    margin: 1.8rem 0 0;
    font-family: var(--serif);
    font-style: italic;
    font-size: clamp(1.15rem, 4vw, 1.45rem);
    color: var(--sage-deep);
    opacity: 0;
    animation: fade 1.4s ease forwards 2.6s;
  }
  p.weddate.none {
    color: var(--muted);
  }

  .rule {
    width: 2.75rem;
    height: 1px;
    margin: 1.4rem auto;
    border: 0;
    background: var(--gold);
    opacity: 0;
    animation: fade 1.4s ease forwards 2.8s;
  }
  .note {
    max-width: 30ch;
    margin: 0;
    color: var(--muted);
    font-size: 1rem;
    line-height: 1.65;
    opacity: 0;
    animation: fade 1.4s ease forwards 3s;
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: .35rem 1.75rem;
    padding: 1.25rem 1.25rem max(1.75rem, env(safe-area-inset-bottom));
    color: var(--muted);
    font-size: .875rem;
    letter-spacing: .04em;
    opacity: 0;
    animation: fade 1.4s ease forwards 3.1s;
  }

  /* ---------- Motion ---------- */
  @keyframes draw   { to { stroke-dashoffset: 0; } }
  @keyframes sprout { from { opacity: 0; transform: scale(.15); } to { opacity: 1; transform: scale(1); } }
  @keyframes pop    { from { opacity: 0; } to { opacity: 1; } }
  @keyframes fade   { to { opacity: 1; } }

  @media (prefers-reduced-motion: reduce) {
    .stem   { animation: none; stroke-dashoffset: 0; }
    .leaf, .berry, h1, .lede, .countdown, .weddate, .rule, .note, footer {
      animation: none;
      opacity: 1;
      transform: none;
    }
  }
</style>
</head>

<body>
  <main>
    <div class="crest">
      <svg id="wreath" viewBox="0 0 400 400" aria-hidden="true" focusable="false"></svg>
      <h1 aria-label="${n1} and ${n2}">
        <span>${n1}</span>
        <span class="amp" aria-hidden="true">&amp;</span>
        <span>${n2}</span>
      </h1>
    </div>

    <p class="lede">are getting married</p>
    ${countdownHtml}
    ${dateLineHtml}
    <hr class="rule">
    <p class="note">${noteHtml}</p>
  </main>

  <footer>
    <span>${siteHost()}</span>
    ${brand().hashtag ? `<span>${escapeAttr(brand().hashtag)}</span>` : ''}
  </footer>

<script>
/* Draws the laurel wreath. Tweak STEPS for a fuller or sparser branch. */
(function () {
  var NS = 'http://www.w3.org/2000/svg';
  var svg = document.getElementById('wreath');
  if (!svg) return;

  var C = 200, R = 165, STEPS = 14, SPAN = 155;
  var rad = function (d) { return d * Math.PI / 180; };
  var deg = function (r) { return r * 180 / Math.PI; };
  var pt  = function (th) { return [C + R * Math.cos(th), C + R * Math.sin(th)]; };
  var f   = function (n) { return n.toFixed(1); };

  function el(name, attrs) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function leaf(x, y, angle, len, i) {
    var w = len * 0.26;
    var outer = el('g', { transform: 'translate(' + f(x) + ' ' + f(y) + ') rotate(' + f(angle) + ')' });
    var inner = el('g', { 'class': 'leaf' });
    inner.style.setProperty('--i', i);
    inner.appendChild(el('path', {
      d: 'M0 0C' + f(len * .3) + ' ' + f(-w) + ' ' + f(len * .75) + ' ' + f(-w) + ' ' + f(len) + ' 0' +
         'C' + f(len * .75) + ' ' + f(w) + ' ' + f(len * .3) + ' ' + f(w) + ' 0 0Z'
    }));
    inner.appendChild(el('path', { 'class': 'vein', d: 'M0 0L' + f(len * .85) + ' 0' }));
    outer.appendChild(inner);
    return outer;
  }

  // dir = +1 sweeps clockwise from the bottom-left, -1 counter-clockwise from the bottom-right
  function branch(dir, startDeg) {
    var a = pt(rad(startDeg));
    var b = pt(rad(startDeg + dir * SPAN));
    svg.appendChild(el('path', {
      'class': 'stem',
      pathLength: 1,
      d: 'M' + f(a[0]) + ' ' + f(a[1]) + 'A' + R + ' ' + R + ' 0 0 ' + (dir > 0 ? 1 : 0) + ' ' + f(b[0]) + ' ' + f(b[1])
    }));

    for (var i = 0; i < STEPS; i++) {
      var t = (i + 1) / STEPS;
      var len = 30 - 14 * t;

      // Outward leaf and a slightly offset inward leaf
      [[0, 1, 1], [0.5 / STEPS, -1, 0.82]].forEach(function (cfg) {
        var th = rad(startDeg + dir * SPAN * (t - 1 / STEPS + cfg[0] * 1));
        var p = pt(th);
        var base = deg(Math.atan2(dir * Math.cos(th), -dir * Math.sin(th)));
        var phi = base + 42 * cfg[1];
        var outward = Math.cos(rad(phi)) * Math.cos(th) + Math.sin(rad(phi)) * Math.sin(th) > 0;
        if ((cfg[1] === 1) !== outward) phi = base - 42 * cfg[1];
        svg.appendChild(leaf(p[0], p[1], phi, len * cfg[2], i));
      });

      if (i % 3 === 1) {
        var bp = pt(rad(startDeg + dir * SPAN * (t - 0.5 / STEPS)));
        var berry = el('circle', { 'class': 'berry', cx: f(bp[0]), cy: f(bp[1]), r: 2.4 });
        berry.style.setProperty('--i', i);
        svg.appendChild(berry);
      }
    }

    // Tip leaf
    var tipTh = rad(startDeg + dir * SPAN);
    var tp = pt(tipTh);
    var tipAngle = deg(Math.atan2(dir * Math.cos(tipTh), -dir * Math.sin(tipTh)));
    svg.appendChild(leaf(tp[0], tp[1], tipAngle, 15, STEPS));
  }

  branch(+1, 100);
  branch(-1, 80);
})();

/* Countdown to midnight of the wedding date entered in the plan. */
(function () {
  var box = document.getElementById('countdown-box');
  if (!box) return;
  var target = box.getAttribute('data-countdown') || '';
  var parts = target.split('-').map(Number);
  if (target.length !== 10 || parts.length !== 3 || parts.some(isNaN)) return;
  // Local midnight of the wedding date (the public site switches to the
  // Wedding Day page at that moment).
  var end = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0).getTime();
  var cells = {
    days: document.getElementById('cd-d'),
    hours: document.getElementById('cd-h'),
    minutes: document.getElementById('cd-m'),
    seconds: document.getElementById('cd-s')
  };
  var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  var done = false;
  function tick() {
    var diff = end - Date.now();
    if (diff <= 0) {
      if (!done) {
        done = true;
        box.classList.add('done');
        box.innerHTML = '<p class="today">Today&rsquo;s the day!</p>';
      }
      return;
    }
    var s = Math.floor(diff / 1000);
    var d = Math.floor(s / 86400); s -= d * 86400;
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60); s -= m * 60;
    if (cells.days) cells.days.textContent = String(d);
    if (cells.hours) cells.hours.textContent = pad(h);
    if (cells.minutes) cells.minutes.textContent = pad(m);
    if (cells.seconds) cells.seconds.textContent = pad(s);
  }
  tick();
  setInterval(tick, 1000);
})();
</script>
</body>
</html>
`;
  return new Response(method === 'HEAD' ? null : html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  });
}
