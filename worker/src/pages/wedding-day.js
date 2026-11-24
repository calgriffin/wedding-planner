// Wedding Day (v4) page (moved verbatim from index.js, #3).

import { coupleNames, escHtml } from '../lib/text.js';
import { siteOrigin } from '../site.js';

// ---------------------------------------------------------------------------
// v4 "Wedding Day" page — served on the v4 preview host and on the public
// apex during the wedding day itself (from midnight of the wedding date).
// ---------------------------------------------------------------------------
export function weddingDayPage(method = 'GET', opts = {}) {
  const { n1, n2 } = coupleNames(opts);
  const weddingDate = opts.wedding_date || '';
  const ceremonyVenue = opts.ceremony_venue || '';
  const receptionVenue = opts.reception_venue || '';
  let dateLine = '';
  if (weddingDate) {
    const d = new Date(weddingDate);
    if (!Number.isNaN(d.getTime())) {
      dateLine = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
  }
  const venueLines = [];
  if (ceremonyVenue) venueLines.push(['Ceremony', ceremonyVenue]);
  if (receptionVenue) venueLines.push(['Reception', receptionVenue]);
  const venueHtml = venueLines.length
    ? venueLines.map(([label, value]) => `<div class="venue"><span class="venue-label">${label}</span><span class="venue-name">${escHtml(value)}</span></div>`).join('')
    : '<p class="message">All the details are waiting in your invitation — see you there!</p>';
  const html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${n1} &amp; ${n2} | Today's the day</title>
<meta name="description" content="Today's the day — ${n1} and ${n2} are getting married.">
<meta name="theme-color" content="#F2F3EA" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#161F1A" media="(prefers-color-scheme: dark)">

<meta property="og:type" content="website">
<meta property="og:url" content="${siteOrigin()}/">
<meta property="og:title" content="${n1} &amp; ${n2} are getting married — today!">
<meta property="og:description" content="Today's the day. See you at the wedding!">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${n1} &amp; ${n2} are getting married — today!">
<meta name="twitter:description" content="Today's the day. See you at the wedding!">

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

  .rings {
    width: clamp(64px, 12vw, 96px);
    height: auto;
    margin-bottom: 1.75rem;
    opacity: 0.9;
  }
  .rings circle {
    fill: none;
    stroke: var(--sage-deep);
    stroke-width: 2;
  }
  .rings circle.gold {
    stroke: var(--gold);
  }

  h1 {
    font-family: var(--serif);
    font-weight: 400;
    font-size: clamp(2.6rem, 9vw, 4.25rem);
    line-height: 1.06;
    letter-spacing: 0.01em;
    margin: 0 0 0.45em;
    color: var(--ink);
  }
  h1 em {
    font-style: italic;
    color: var(--sage-deep);
  }

  p.names {
    font-family: var(--serif);
    font-size: clamp(1.5rem, 5vw, 2.1rem);
    letter-spacing: 0.06em;
    margin: 0 0 0.5em;
    color: var(--sage-deep);
  }
  p.date {
    margin: 0 0 2.2em;
    font-size: 0.95rem;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--gold);
  }

  .venues {
    display: grid;
    gap: 1rem;
    width: 100%;
    max-width: 30rem;
    margin-bottom: 2rem;
  }
  .venue {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    background: color-mix(in srgb, var(--paper) 60%, transparent);
    border: 1px solid color-mix(in srgb, var(--sage) 45%, transparent);
    border-radius: 14px;
    padding: 0.9rem 1.25rem;
  }
  .venue-label {
    font-size: 0.75rem;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: var(--gold);
  }
  .venue-name {
    font-family: var(--serif);
    font-size: 1.25rem;
    color: var(--ink);
  }

  p.message {
    max-width: 34rem;
    margin: 0;
    font-size: 1.05rem;
    line-height: 1.7;
    color: var(--muted);
  }
</style>
</head>
<body>
<main>
  <svg class="rings" viewBox="0 0 120 96" aria-hidden="true">
    <circle cx="44" cy="52" r="34"/>
    <circle class="gold" cx="78" cy="40" r="34"/>
  </svg>
  <h1><em>Today&rsquo;s</em> the day!</h1>
  <p class="names">${n1} &amp; ${n2}</p>
  ${dateLine ? `<p class="date">${dateLine}</p>` : ''}
  <div class="venues">${venueHtml}</div>
  <p class="message">Thank you for being a part of our day. We can&rsquo;t wait to celebrate with you.</p>
</main>
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
