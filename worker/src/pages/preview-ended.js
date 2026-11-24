// Preview-ended (leak screen) and Coming soon (teaser) pages (moved verbatim
// from index.js, #3).

import { brand } from '../brand.js';
import { coupleNames, escapeAttr } from '../lib/text.js';
import { siteHost, siteOrigin } from '../site.js';

// ---------------------------------------------------------------------------
// Leak screen — the ONLY thing served to non-whitelisted devices that reach
// the v1…v5 preview hosts. Self-contained static HTML: no SPA bundle,
// no API calls, no external network — production data is never exposed here.
// ---------------------------------------------------------------------------
export function previewEndedPage() {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Preview ended ✨</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100%;
    font-family: ui-serif, Georgia, 'Times New Roman', serif;
    color: #4a3f35;
    background: radial-gradient(
      1200px 600px at 50% -10%,
      #fff8ef 0%,
      #fdf3e3 45%,
      #f8e9d2 100%
    );
    padding: 24px;
    text-align: center;
  }
  .card {
    max-width: 480px;
    width: 100%;
    background: rgba(255, 253, 248, 0.88);
    border: 1px solid #ead9bd;
    border-radius: 22px;
    padding: 52px 36px;
    box-shadow: 0 20px 44px rgba(122, 92, 52, 0.14);
  }
  .sparkle { font-size: 36px; line-height: 1; margin-bottom: 18px; }
  h1 {
    margin: 0 0 10px;
    font-size: 30px;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: #3c3329;
  }
  h1 .amp {
    font-style: italic;
    font-weight: 400;
    color: #b18a5e;
    padding: 0 4px;
  }
  .eye {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.3em;
    color: #9c8260;
    margin-bottom: 22px;
  }
  p {
    margin: 0 0 14px;
    font-size: 16px;
    line-height: 1.6;
    color: #5d5143;
  }
  p:last-child {
    margin-bottom: 0;
    color: #8a6f50;
    font-size: 15px;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="sparkle">✨</div>
    <h1>See you at the wedding</h1>
    <div class="eye">Preview ended</div>
    <p>Thanks for checking in on us — the surprises are safe, and the wedding is close.</p>
    <p>We can&#39;t wait to celebrate with you. See you at the wedding ✨</p>
  </div>
</body>
</html>`;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// Teaser page — "Coming soon". Names are injected from Setup at request time
// (this repo contains no personal data). Served on the apex in Teaser mode
// and on the v1 preview host.
export function comingSoonPage(method = 'GET', opts = {}) {
  const { n1, n2 } = coupleNames(opts);
  const html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${n1} &amp; ${n2} | Coming soon</title>
<meta name="description" content="${n1} and ${n2} are getting married. Our wedding website is coming soon.">
<meta name="theme-color" content="#F2F3EA" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#161F1A" media="(prefers-color-scheme: dark)">

<meta property="og:type" content="website">
<meta property="og:url" content="${siteOrigin()}/">
<meta property="og:title" content="${n1} &amp; ${n2} are getting married">
<meta property="og:description" content="Our wedding website is coming soon. Details and invitations will follow.">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${n1} &amp; ${n2} are getting married">
<meta name="twitter:description" content="Our wedding website is coming soon. Details and invitations will follow.">

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
  .rule {
    width: 2.75rem;
    height: 1px;
    margin: 1.4rem auto;
    border: 0;
    background: var(--gold);
    opacity: 0;
    animation: fade 1.4s ease forwards 2.6s;
  }
  .note {
    max-width: 30ch;
    margin: 0;
    color: var(--muted);
    font-size: 1rem;
    line-height: 1.65;
    opacity: 0;
    animation: fade 1.4s ease forwards 2.8s;
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
    .leaf, .berry, h1, .lede, .rule, .note, footer {
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
    <hr class="rule">
    <p class="note">Our wedding website is coming soon. Details and invitations will follow.</p>
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
