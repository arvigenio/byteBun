// Prospecting: search by industry + location, ranked by chance of signing up; saving into groups.
import './env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { GeoapifySource, HereSource, matchIndustry } from '../src/prospects/place-sources';
import { scoreProspect } from '../src/prospects/scoring';
import { analyzeHtml, checkWebsite, cleanEmail, contactPageUrls, findEmail, fetchPublicPage, isPublicAddress, mergeSocials, websiteKind, type WebsiteCheckup } from '../src/prospects/website-checkup';
import { browser, enroll, JOSUE, resetState, startApp, type TestApp } from './helpers';

let t: TestApp;
before(async () => {
  t = await startApp();
});
after(async () => {
  await t?.close();
});
beforeEach(async () => {
  await resetState(t.prisma);
});

describe('prospecting API', () => {
  it('is admin-only', async () => {
    assert.equal((await request(t.server).get('/api/admin/prospects/meta')).status, 401);
    assert.equal((await request(t.server).post('/api/admin/prospects/search').send({ industry: 'Dentist', location: 'Makati' })).status, 401);
  });

  it('ranks businesses by chance of signing up, with website and social columns', async () => {
    const b = browser(t.server);
    await enroll(b, JOSUE);

    const meta = await b.get('/api/admin/prospects/meta');
    assert.equal(meta.status, 200);
    assert.equal(meta.body.hasReviews, true);

    const bad = await b.post('/api/admin/prospects/search', { industry: '', location: '<script>' });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.fields.industry);
    assert.ok(bad.body.fields.location);

    const res = await b.post('/api/admin/prospects/search', { industry: 'Dentist', location: 'Makati' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.reused, false);
    const names = res.body.items.map((p: any) => p.name);
    assert.deepEqual(names, ['Santos Family Dental Clinic', 'Reyes Dental Care', 'Bright Smile Dental Studio', 'Old Town Dental']);
    assert.deepEqual(res.body.items.map((p: any) => p.rank), [1, 2, 3, 4]);

    const [santos, reyes, bright, closed] = res.body.items;
    assert.equal(santos.tier, 'hot');
    assert.equal(santos.websiteKind, 'none');
    assert.equal(santos.website, null);
    assert.ok(santos.reasons.some((r: any) => r.label === 'No website'));
    assert.ok(santos.pitch.includes('Custom website design'));

    assert.equal(reyes.websiteKind, 'social');
    assert.equal(reyes.website, null, 'a Facebook page is not shown as the website');
    assert.deepEqual(reyes.socials, [{ network: 'facebook', url: 'https://www.facebook.com/reyesdentalcare' }]);
    assert.ok(reyes.reasons.some((r: any) => r.label === 'Active on Facebook but has no website'));

    assert.equal(bright.website, 'https://brightsmile.example.com');
    assert.equal(closed.score, 0);
    assert.deepEqual(res.body.search.tiers, { hot: 1, warm: 1, cold: 2 });

    // A repeat within 30 minutes reuses the results; "refresh" searches again.
    const again = await b.post('/api/admin/prospects/search', { industry: ' dentist ', location: 'makati' });
    assert.equal(again.body.reused, true);
    assert.equal(again.body.search.id, res.body.search.id);
    const fresh = await b.post('/api/admin/prospects/search', { industry: 'Dentist', location: 'Makati', refresh: true });
    assert.equal(fresh.body.reused, false);
    assert.notEqual(fresh.body.search.id, res.body.search.id);

    assert.equal((await b.get(`/api/admin/prospects/searches/${res.body.search.id}`)).status, 200);
    assert.equal((await b.get('/api/admin/prospects/searches/00000000-0000-4000-8000-000000000000')).status, 404);
    assert.equal((await b.get('/api/admin/prospects/searches/not-a-uuid')).status, 400);
  });

  it('serves map tiles only to admins, and only real tile numbers', async () => {
    assert.equal((await request(t.server).get('/api/admin/prospects/tiles/12/3424/1898.png')).status, 401);
    const b = browser(t.server);
    await enroll(b, JOSUE);
    assert.equal((await b.get('/api/admin/prospects/tiles/25/1/1.png')).status, 404, 'zoom too deep');
    assert.equal((await b.get('/api/admin/prospects/tiles/2/9/1.png')).status, 404, 'x outside the zoom level');
    assert.equal((await b.get('/api/admin/prospects/tiles/a/1/1.png')).status, 404);
    // A real tile reaches the handler: 200, or 502 if this machine has no internet.
    assert.ok([200, 502].includes((await b.get('/api/admin/prospects/tiles/2/1/1.png')).status));
  });

  it('saves chosen results into groups, admin-only', async () => {
    assert.equal((await request(t.server).get('/api/admin/prospects/saved')).status, 401);
    assert.equal((await request(t.server).post('/api/admin/prospects/groups').send({ name: 'x' })).status, 401);
    const b = browser(t.server);
    await enroll(b, JOSUE);

    // Nothing is kept until an admin saves it.
    const res = await b.post('/api/admin/prospects/search', { industry: 'Dentist', location: 'Makati' });
    assert.ok(res.body.items.every((p: any) => p.saved === null));
    assert.deepEqual((await b.get('/api/admin/prospects/groups')).body, { groups: [], total: 0, ungrouped: 0 });
    const [santos, reyes] = res.body.items;

    const group = await b.post('/api/admin/prospects/groups', { name: '  Makati   dentists ' });
    assert.equal(group.status, 201, JSON.stringify(group.body));
    assert.equal(group.body.name, 'Makati dentists');
    assert.equal((await b.post('/api/admin/prospects/groups', { name: 'makati DENTISTS' })).status, 409, 'names are unique, any case');
    assert.equal((await b.post('/api/admin/prospects/groups', { name: '' })).status, 400);

    const saved = await b.post('/api/admin/prospects/saved', { searchId: res.body.search.id, itemIds: [santos.id, reyes.id], groupId: group.body.id });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.created, 2);
    assert.ok(saved.body.saved.every((s: any) => s.groupId === group.body.id));

    // The results now show it; saving again (no group given) refreshes it and keeps its group.
    const again = await b.get(`/api/admin/prospects/searches/${res.body.search.id}`);
    assert.equal(again.body.items.find((p: any) => p.id === santos.id).saved.groupId, group.body.id);
    const resave = await b.post('/api/admin/prospects/saved', { searchId: res.body.search.id, itemIds: [santos.id] });
    assert.deepEqual([resave.body.created, resave.body.updated, resave.body.saved[0].groupId], [0, 1, group.body.id]);

    const list = await b.get(`/api/admin/prospects/saved?group=${group.body.id}`);
    assert.deepEqual(list.body.items.map((p: any) => p.name).sort(), ['Reyes Dental Care', 'Santos Family Dental Clinic']);
    const s = list.body.items.find((p: any) => p.name === 'Santos Family Dental Clinic');
    assert.equal(s.tier, santos.tier);
    assert.equal(s.score, santos.score);
    assert.ok(s.reasons.some((r: any) => r.label === 'No website'), 'the snapshot keeps why it ranked');
    assert.equal(s.industry, 'Dentist');
    assert.equal(s.savedBy, JOSUE);

    // Move one out of the group, with a note.
    const r = list.body.items.find((p: any) => p.name === 'Reyes Dental Care');
    const moved = await b.patch(`/api/admin/prospects/saved/${r.id}`, { groupId: null, note: '  Call after lunch ' });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.deepEqual([moved.body.groupId, moved.body.note], [null, 'Call after lunch']);
    assert.equal((await b.patch(`/api/admin/prospects/saved/${r.id}`, { groupId: 999999 })).status, 400);
    let groups = (await b.get('/api/admin/prospects/groups')).body;
    assert.deepEqual([groups.total, groups.ungrouped, groups.groups[0].count], [2, 1, 1]);
    assert.equal((await b.get('/api/admin/prospects/saved?group=none')).body.items.length, 1);
    assert.equal((await b.get('/api/admin/prospects/saved?group=abc')).status, 400);

    // Deleting a group keeps its prospects (ungrouped).
    assert.equal((await b.patch(`/api/admin/prospects/groups/${group.body.id}`, { name: 'Makati – call first' })).status, 200);
    groups = (await b.delete(`/api/admin/prospects/groups/${group.body.id}`)).body;
    assert.deepEqual([groups.groups.length, groups.total, groups.ungrouped], [0, 2, 2]);

    assert.equal((await b.delete(`/api/admin/prospects/saved/${r.id}`)).status, 200);
    assert.equal((await b.delete(`/api/admin/prospects/saved/${r.id}`)).status, 404);
    assert.equal((await b.post('/api/admin/prospects/saved', { searchId: res.body.search.id, itemIds: [] })).status, 400);
    assert.equal((await b.post('/api/admin/prospects/saved', { searchId: '00000000-0000-4000-8000-000000000000', itemIds: [1] })).status, 404, 'expired results');
  });
});

describe('Geoapify source', () => {
  it('geocodes the location, searches its boundary by category, and reads phone, website and socials', async () => {
    const calls: URL[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.pathname === '/v1/geocode/search') return json({ results: [{ place_id: 'makati-id', lat: 14.55, lon: 121.02, result_type: 'city', city: 'Makati', country: 'Philippines' }] });
      return json({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {
              place_id: 'p1', name: 'Smile Dental', categories: ['healthcare', 'healthcare.dentist'], formatted: 'Smile Dental, 5 Ayala Ave, Makati', city: 'Makati', country: 'Philippines',
              lat: 14.556, lon: 121.024, contact: { phone: '+63 2 8123 4567' },
              datasource: { raw: { osm_type: 'n', osm_id: 123, website: 'https://smile.example.ph', 'contact:facebook': 'smiledentalph', 'contact:instagram': 'https://instagram.com/smiledental' } },
            },
          },
          { type: 'Feature', properties: { place_id: 'p2', name: 'FB Only Dental', categories: ['healthcare.dentist'], lat: 14.56, lon: 121.03, website: 'https://www.facebook.com/fbonlydental' } },
          { type: 'Feature', properties: { place_id: 'p3', categories: ['healthcare.dentist'], lat: 1, lon: 1 } },
        ],
      });
    }) as typeof fetch;
    try {
      const rows = await new GeoapifySource('key-123').search('Dentist', 'Makati', 50);
      const places = calls.find((u) => u.pathname === '/v2/places')!;
      assert.equal(places.searchParams.get('categories'), 'healthcare.dentist');
      assert.equal(places.searchParams.get('filter'), 'place:makati-id');
      assert.equal(places.searchParams.get('apiKey'), 'key-123');
      assert.equal(rows.length, 2, 'unnamed places are skipped');
      const [smile, fbOnly] = rows;
      assert.equal(smile!.phone, '+63 2 8123 4567');
      assert.equal(smile!.website, 'https://smile.example.ph');
      assert.equal(smile!.category, 'Dentist');
      assert.equal(smile!.mapsUrl, 'https://www.openstreetmap.org/node/123');
      assert.deepEqual(smile!.socials.map((s) => s.url), ['https://www.facebook.com/smiledentalph', 'https://instagram.com/smiledental']);
      assert.equal(fbOnly!.website, null);
      assert.deepEqual(fbOnly!.socials.map((s) => s.network), ['facebook']);

      await new GeoapifySource('key-123').search('Plumber', 'Makati', 50);
      const byName = calls.filter((u) => u.pathname === '/v2/places').pop()!;
      assert.equal(byName.searchParams.get('name'), 'Plumber', 'no category for plumbers: match by name');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('HERE source', () => {
  it('geocodes the location, discovers businesses around it, and reads phone, website, email and socials', async () => {
    const calls: URL[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.hostname === 'geocode.search.hereapi.com') {
        if (url.searchParams.get('q') === 'Philippines') return json({ items: [{ resultType: 'administrativeArea', position: { lat: 12.9, lng: 121.8 }, address: { countryCode: 'PHL', countryName: 'Philippines' } }] });
        return json({ items: [{ resultType: 'locality', position: { lat: 14.55, lng: 121.02 }, mapView: { west: 120.98, south: 14.52, east: 121.07, north: 14.58 }, address: { city: 'Makati', countryCode: 'PHL', countryName: 'Philippines' } }] });
      }
      return json({
        items: [
          {
            id: 'here:pds:place:1', title: 'Smile Dental', resultType: 'place', position: { lat: 14.556, lng: 121.024 },
            address: { label: 'Smile Dental, 5 Ayala Ave, Makati', city: 'Makati', countryName: 'Philippines' },
            categories: [{ id: '800-8000-0158', name: 'Dentist/Dental Office', primary: true }],
            contacts: [{ phone: [{ value: '+6328123 4567' }], www: [{ value: 'https://www.facebook.com/smiledentalph' }, { value: 'https://smile.example.ph' }], email: [{ value: 'Hello@Smile.example.ph' }] }],
          },
          { id: 'x2', title: 'FB Only Dental', resultType: 'place', position: { lat: 14.56, lng: 121.03 }, contacts: [{ mobile: [{ value: '+639171234567' }], www: [{ value: 'https://facebook.com/fbonly' }] }] },
          { id: 'x3', title: 'Ayala Avenue', resultType: 'street', position: { lat: 1, lng: 1 } },
        ],
      });
    }) as typeof fetch;
    try {
      const rows = await new HereSource('key-123').search('Dentist', 'Makati', 50);
      const discover = calls.find((u) => u.hostname === 'discover.search.hereapi.com')!;
      assert.equal(discover.searchParams.get('q'), 'Dentist');
      assert.match(discover.searchParams.get('in')!, /^circle:14\.55,121\.02;r=\d+$/);
      assert.equal(discover.searchParams.get('apiKey'), 'key-123');
      assert.equal(discover.searchParams.get('limit'), '50');
      assert.equal(rows.length, 2, 'streets and other non-places are skipped');
      const [smile, fbOnly] = rows;
      assert.equal(smile!.phone, '+6328123 4567');
      assert.equal(smile!.website, 'https://smile.example.ph');
      assert.equal(smile!.email, 'hello@smile.example.ph');
      assert.equal(smile!.category, 'Dentist/Dental Office');
      assert.deepEqual(smile!.socials.map((s) => s.network), ['facebook']);
      assert.equal(fbOnly!.website, null);
      assert.equal(fbOnly!.phone, '+639171234567');
      assert.deepEqual(fbOnly!.socials.map((s) => s.network), ['facebook']);

      await new HereSource('key-123').search('Dentist', 'Philippines', 50);
      const country = calls.filter((u) => u.hostname === 'discover.search.hereapi.com').pop()!;
      assert.equal(country.searchParams.get('in'), 'countryCode:PHL');
      assert.equal(country.searchParams.get('at'), '12.9,121.8');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('industry matching', () => {
  const list = [
    { match: /\bvet|animal/, categories: ['pet.veterinary'] },
    { match: /dent/, categories: ['healthcare.dentist'] },
    { match: /medical|doctor/, categories: ['healthcare.clinic_or_praxis'] },
    { match: /clinic/, generic: true, categories: ['healthcare.clinic_or_praxis'] },
  ];
  const cats = (term: string) => matchIndustry(list, term).flatMap((e) => e.categories);
  it('"clinic" only counts when nothing more specific matched', () => {
    assert.deepEqual(cats('vetenerary clinic'), ['pet.veterinary']);
    assert.deepEqual(cats('dental clinic'), ['healthcare.dentist']);
    assert.deepEqual(cats('medical clinic'), ['healthcare.clinic_or_praxis']);
    assert.deepEqual(cats('skin clinic'), ['healthcare.clinic_or_praxis']);
    assert.deepEqual(cats('plumber'), []);
  });
});

describe('contact email', () => {
  it('finds the business email on its homepage, not image names or placeholders', () => {
    const html = `<img src="logo@2x.png"><a href="mailto:hello@agency.com">x</a><p>Write to info@smileclinic.ph or user@example.com</p>
      <script>var x = "tracking@sentry.io";</script><a href="mailto:Appointments@SmileClinic.ph?subject=Hi">Book</a>`;
    assert.equal(findEmail(html, 'https://www.smileclinic.ph/'), 'appointments@smileclinic.ph', 'own domain first');
    assert.equal(findEmail('<p>no email here</p>'), null);
    assert.equal(cleanEmail('mailto:Info@Clinic.PH'), 'info@clinic.ph');
    assert.equal(cleanEmail('noreply@clinic.ph'), null);
    assert.equal(cleanEmail('icon@2x.png'), null);
  });

  it('decodes hidden addresses: Cloudflare, entities, JSON-LD and [at]/[dot]', () => {
    // "info@clinic.ph" XOR 0x42
    const cf = '42' + [...'info@clinic.ph'].map((c) => (c.charCodeAt(0) ^ 0x42).toString(16).padStart(2, '0')).join('');
    assert.equal(findEmail(`<a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="${cf}">[email&#160;protected]</a>`), 'info@clinic.ph');
    assert.equal(findEmail(`<a href="/cdn-cgi/l/email-protection#${cf}">Email us</a>`), 'info@clinic.ph');
    assert.equal(findEmail('<p>hello&#64;clinic&#46;ph</p>'), 'hello@clinic.ph');
    assert.equal(findEmail('<script type="application/ld+json">{"@type":"Dentist","email":"desk@clinic.ph"}</script>'), 'desk@clinic.ph');
    assert.equal(findEmail('<p>Email: frontdesk [at] smile-clinic [dot] com [dot] ph</p>'), 'frontdesk@smile-clinic.com.ph');
  });

  it('follows Contact pages on the same site when the homepage has no email', async () => {
    const home = `<a href="/about-us">About</a><a href="https://other.com/contact">x</a><a href="/files/menu.pdf">Contact PDF</a><a href="/reach-us">Get in touch</a>`;
    assert.deepEqual(contactPageUrls(home, 'https://www.clinic.ph/'), ['https://www.clinic.ph/reach-us', 'https://www.clinic.ph/about-us']);
    assert.deepEqual(contactPageUrls('<p>nothing</p>', 'https://clinic.ph/'), ['https://clinic.ph/contact', 'https://clinic.ph/contact-us']);
    const opened: string[] = [];
    const c = await checkWebsite('https://www.clinic.ph/', async (url) => {
      opened.push(url);
      return { status: 200, finalUrl: url, body: url.endsWith('/reach-us') ? '<a href="mailto:book@clinic.ph">Email</a>' : home, ms: 10 };
    });
    assert.equal(c.email, 'book@clinic.ph');
    assert.deepEqual(opened, ['https://www.clinic.ph/', 'https://www.clinic.ph/reach-us']);
  });
});

describe('fit score', () => {
  const base = { website: 'https://clinic.example.com', phone: '+63 2 1234', rating: 4.7, reviewCount: 120, businessStatus: 'OPERATIONAL', socials: [] };
  const checkup = (over: Partial<WebsiteCheckup>): WebsiteCheckup => ({
    reachable: true, finalUrl: 'https://clinic.example.com/', https: true, mobileFriendly: true, onlineBooking: true, chat: true, responseMs: 800,
    copyrightYear: new Date().getUTCFullYear(), platform: null, title: null, socials: [], error: null, checkedAt: new Date().toISOString(), ...over,
  });

  it('a weak website scores higher than a modern one', () => {
    const modern = scoreProspect(base, checkup({}));
    const weak = scoreProspect(base, checkup({ https: false, mobileFriendly: false, onlineBooking: false, chat: false, copyrightYear: 2018 }));
    assert.ok(weak.score > modern.score + 30, `${weak.score} vs ${modern.score}`);
    assert.equal(weak.tier, 'hot');
    assert.ok(modern.reasons.some((r) => r.key === 'modern-site'));
    assert.ok(weak.reasons.some((r) => r.label === 'Website looks outdated (© 2018)'));
  });

  it('a refused address is not scored as "site is down"', () => {
    const s = scoreProspect(base, checkup({ reachable: false, blocked: true }));
    assert.ok(!s.reasons.some((r) => r.key === 'site-down'));
  });
});

describe('website checkup', () => {
  it('reads the signals from a homepage', () => {
    const html = `<html><head><title>Bright &amp; Smile</title><meta name="viewport" content="width=device-width"></head>
      <body><a href="https://calendly.com/bright">Book now</a><script src="https://embed.tawk.to/x"></script>
      <a href="https://www.facebook.com/brightsmile">FB</a><a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
      <a href="https://instagram.com/brightsmile/">IG</a><img src="/wp-content/x.png"><footer>© 2016 - 2019 Bright</footer></body></html>`;
    const r = analyzeHtml(html, new Date('2026-06-01'));
    assert.equal(r.title, 'Bright & Smile');
    assert.equal(r.mobileFriendly, true);
    assert.equal(r.onlineBooking, true);
    assert.equal(r.chat, true);
    assert.equal(r.copyrightYear, 2019);
    assert.equal(r.platform, 'WordPress');
    assert.deepEqual(r.socials.map((s) => s.network), ['facebook', 'instagram']);
  });

  it('tells websites from social pages', () => {
    assert.equal(websiteKind('https://m.facebook.com/x'), 'social');
    assert.equal(websiteKind('linktr.ee/x'), 'social');
    assert.equal(websiteKind('clinic.ph'), 'site');
    assert.equal(websiteKind(null, mergeSocials(['https://instagram.com/x'])), 'social');
    assert.equal(websiteKind(null), 'none');
  });

  it('never opens private or internal addresses (SSRF)', async () => {
    for (const a of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.17.0.1', '192.168.1.1', '::1', 'fe80::1', '::ffff:10.0.0.1', '100.64.0.1']) assert.equal(isPublicAddress(a), false, a);
    for (const a of ['8.8.8.8', '66.6.42.252', '2620:109:b00a::4206:2afc']) assert.equal(isPublicAddress(a), true, a);
    for (const url of ['http://127.0.0.1/', 'http://localhost/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data', 'http://example.com:8080/', 'ftp://example.com/', 'http://user:pw@example.com/']) {
      await assert.rejects(fetchPublicPage(url, 2000), url);
    }
    const c = await checkWebsite('http://127.0.0.1/');
    assert.equal(c.reachable, false);
    assert.equal(c.blocked, true);
  });

  it('records what a reachable page shows', async () => {
    const c = await checkWebsite('clinic.example.com', async (url) => ({ status: 200, finalUrl: url, body: '<meta name="viewport"><p>© 2025</p>', ms: 4200 }));
    assert.equal(c.reachable, true);
    assert.equal(c.https, true);
    assert.equal(c.responseMs, 4200);
    assert.equal(c.onlineBooking, false);
    assert.ok(scoreProspect({ website: 'clinic.example.com', phone: null, rating: null, reviewCount: null, businessStatus: null, socials: [] }, c).reasons.some((r) => r.key === 'slow'));
  });
});
