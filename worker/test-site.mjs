/**
 * Unit tests for src/site.js: every host, link and the session-cookie domain
 * derive from SITE_DOMAIN (or, unset, from the request hostname).
 * Usage: node test-site.mjs
 */
import {
  configureSite, domainFromHostname, siteDomain, siteHost, siteOrigin, isApexHost, cookieDomainAttr,
} from './src/site.js';
import { familyHost, isFamilyHost } from './src/family.js';

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ''}`); }
}

console.log('\n== SITE_DOMAIN drives every host ==');
{
  const env = { SITE_DOMAIN: 'example.test' };
  configureSite(env, 'plan.example.test');
  check('domain', siteDomain() === 'example.test');
  check('apex origin', siteOrigin() === 'https://example.test');
  check('plan origin', siteOrigin('plan') === 'https://plan.example.test');
  check('preview hosts v1–v5', [1, 2, 3, 4, 5].every((n) => siteHost(`v${n}`) === `v${n}.example.test`));
  check('family host', familyHost(env) === 'family.example.test' && isFamilyHost('FAMILY.example.test', env));
  check('FAMILY_HOST still overrides', familyHost({ ...env, FAMILY_HOST: 'pay.other.test' }) === 'pay.other.test');
  check('cookie domain', cookieDomainAttr() === '; Domain=.example.test');
  check('apex + www match', isApexHost('example.test') && isApexHost('WWW.example.test'));
  check('plan / previews are not the apex', !isApexHost('plan.example.test') && !isApexHost('v3.example.test'));
  check('SITE_DOMAIN beats the request host', configureSite(env, 'plan.other.test') === 'example.test');
}

console.log('\n== SITE_DOMAIN is normalised ==');
{
  configureSite({ SITE_DOMAIN: ' https://Example.Test/ ' });
  check('scheme, slash, case and spaces stripped', siteDomain() === 'example.test', siteDomain());
  configureSite({ SITE_DOMAIN: '.example.test' });
  check('leading dot stripped', cookieDomainAttr() === '; Domain=.example.test', cookieDomainAttr());
}

console.log('\n== Unset: derived from the request hostname ==');
{
  const realError = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a.join(' '));
  try {
    configureSite({});
    configureSite({}, 'plan.example.test');
    configureSite({});
  } finally {
    console.error = realError;
  }
  check('missing SITE_DOMAIN logged once per isolate', logged.length === 1 && logged[0].includes('SITE_DOMAIN is not set'), logged);

  for (const h of ['plan.example.test', 'www.example.test', 'v4.example.test', 'family.example.test', 'example.test']) {
    check(`${h} → example.test`, domainFromHostname(h) === 'example.test', domainFromHostname(h));
  }
  check('port stripped', domainFromHostname('v1.127.0.0.1.nip.io:8787') === '127.0.0.1.nip.io');
  configureSite({}, 'localhost');
  check('localhost: host-only cookie (no Domain attribute)', cookieDomainAttr() === '');
  configureSite({});
  check('nothing known: empty, never a wrong domain', siteDomain() === '' && siteOrigin('plan') === '' && cookieDomainAttr() === '' && !isApexHost(''));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
