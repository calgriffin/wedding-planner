// Unit checks for src/brand.js: configured values, neutral fallbacks, the
// one-time warning, and placeholder filling with the right escaping.
import { configureBrand, brand, fillBrand, slugify } from './src/brand.js';

let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`, got); }
}

const warnings = [];
const origWarn = console.warn;
console.warn = (...a) => warnings.push(a.join(' '));

// --- Unset: neutral fallbacks + one warning per isolate
configureBrand({});
configureBrand({});
let b = brand();
check('unset: warns once (not per request)', warnings.length === 1 && /WEDDING_NAME and WEDDING_SHORT_NAME not set/.test(warnings[0]), warnings);
check('unset: neutral name/title/nav', b.name === 'Wedding Planner' && b.plannerTitle === 'Wedding Planner' && b.navLabel === 'Wedding Planner' && b.appShortName === 'Wedding', b);
check('unset: neutral ids', b.slugBase === 'wedding' && b.mcpServerName === 'wedding-planner' && b.codePrefix === 'WEDDING', b);
check('unset: neutral running text', b.weddingPhrase === 'the wedding' && b.emailFooter === 'From your Wedding Planner' && b.backupTitle === 'Wedding planner' && b.hashtag === '', b);
check('unset: description', b.description === 'Wedding Planner - Complete Wedding Planning System', b.description);

// --- Configured: every derived string
configureBrand({ WEDDING_NAME: 'The Smith Wedding', WEDDING_SHORT_NAME: 'Smith', WEDDING_HASHTAG: '#TheSmithWedding' });
b = brand();
check('configured: name / title / description', b.name === 'The Smith Wedding' && b.plannerTitle === 'The Smith Wedding Planner' && b.description === 'The Smith Wedding - Complete Wedding Planning System', b);
check('configured: short / nav / hashtag', b.appShortName === 'Smith' && b.navLabel === 'Smith Wedding' && b.hashtag === '#TheSmithWedding', b);
check('configured: ids', b.slugBase === 'smith-wedding' && b.mcpServerName === 'smith-wedding-planner' && b.codePrefix === 'SMITH', b);
check('configured: running text', b.weddingPhrase === 'the Smith wedding' && b.emailFooter === 'From the Smith Wedding Planner' && b.backupTitle === 'Smith wedding planner', b);
check('configured: no further warning', warnings.length === 1, warnings);

// --- Values are trimmed and capped; slugs are safe
configureBrand({ WEDDING_NAME: '  The   Lee  Wedding ', WEDDING_SHORT_NAME: " O'Brien-Lee ", WEDDING_HASHTAG: '' });
b = brand();
check('whitespace collapsed', b.name === 'The Lee Wedding', b.name);
check('slug and code from a punctuated name', b.slugBase === 'o-brien-lee-wedding' && b.codePrefix === 'OBRIENLEE', b);
check('empty hashtag stays empty', b.hashtag === '', b.hashtag);
check('slugify', slugify('  Ünïcode & Co ') === 'n-code-co' && slugify('') === '', slugify('  Ünïcode & Co '));

// --- fillBrand: escaping per kind
configureBrand({ WEDDING_NAME: 'The "<Smith> & Co" Wedding', WEDDING_SHORT_NAME: 'Smith', WEDDING_HASHTAG: '' });
const html = fillBrand('<title>%WP_BRAND_TITLE%</title><meta content="%WP_BRAND_JSON%">');
check('html: values are HTML-escaped', html.includes('<title>The &quot;&lt;Smith&gt; &amp; Co&quot; Wedding Planner</title>') && !html.includes('<Smith>'), html);
const meta = /content="([^"]*)"/.exec(html)[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
let parsed = null; try { parsed = JSON.parse(meta); } catch {}
check('html: the wp-brand meta round-trips to JSON', parsed && parsed.name === 'The "<Smith> & Co" Wedding' && parsed.nav === 'Smith Wedding' && parsed.slug === 'smith-wedding' && parsed.code === 'SMITH', meta);
const json = fillBrand('{"name": "%WP_BRAND_NAME%", "short_name": "%WP_BRAND_SHORT%"}', 'json');
let mj = null; try { mj = JSON.parse(json); } catch {}
check('json: manifest stays valid JSON', mj && mj.name === 'The "<Smith> & Co" Wedding' && mj.short_name === 'Smith', json);
const js = fillBrand("const CACHE = '%WP_BRAND_SLUG%-v2';", 'js');
check('js: service-worker cache name', js === "const CACHE = 'smith-wedding-v2';", js);
check('unknown placeholders and plain text are left alone', fillBrand('%WP_BRAND_NOPE% x') === '%WP_BRAND_NOPE% x' && fillBrand('plain') === 'plain' && fillBrand(null) === null);

console.warn = origWarn;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
