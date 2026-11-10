// Where a booking came from: the classifier, and the lead form -> admin list round trip.
import './env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { channelOf, classifyAttribution, describeOrigin } from '../src/leads/attribution';
import { browser, enroll, JOSUE, ORIGIN, resetState, startApp, type TestApp } from './helpers';

const OWN = ['bytebuntech.com', 'localhost'];
const classify = (raw: unknown) => classifyAttribution(raw, OWN);
const pick = (raw: unknown) => {
  const a = classify(raw);
  return a && [a.origin, a.originDetail];
};

describe('attribution: classifyAttribution', () => {
  it('reads social media from UTM tags, click IDs and referrers', () => {
    assert.deepEqual(pick({ utmSource: 'instagram', utmMedium: 'social', utmCampaign: 'bio' }), ['social', 'Instagram']);
    assert.deepEqual(pick({ utmSource: 'FB' }), ['social', 'Facebook']);
    assert.deepEqual(pick({ utmSource: 'facebook', utmMedium: 'cpc' }), ['social', 'Facebook (paid)']);
    assert.deepEqual(pick({ utmSource: 'tiktok', utmMedium: 'paid_social' }), ['social', 'TikTok (paid)']);
    assert.deepEqual(pick({ utmSource: 'partner_blog', utmMedium: 'social' }), ['social', 'Partner Blog']);
    assert.deepEqual(pick({ referrer: 'https://l.facebook.com' }), ['social', 'Facebook']);
    assert.deepEqual(pick({ referrer: 'https://l.instagram.com', clickIds: ['fbclid'] }), ['social', 'Instagram']); // referrer refines fbclid
    assert.deepEqual(pick({ clickIds: ['fbclid'] }), ['social', 'Facebook']); // in-app browser, no referrer
    assert.deepEqual(pick({ referrer: 'https://t.co' }), ['social', 'X (Twitter)']);
    assert.deepEqual(pick({ referrer: 'https://www.linkedin.com' }), ['social', 'LinkedIn']);
  });

  it('tells search, ads, email, other sites and direct visits apart', () => {
    assert.deepEqual(pick({ referrer: 'https://www.google.com.ph' }), ['search', 'Google']);
    assert.deepEqual(pick({ referrer: 'https://www.google.com', clickIds: ['gclid'] }), ['ads', 'Google']); // paid, not organic
    assert.deepEqual(pick({ utmSource: 'google', utmMedium: 'cpc' }), ['ads', 'Google']);
    assert.deepEqual(pick({ referrer: 'https://mail.google.com' }), ['email', 'Gmail']);
    assert.deepEqual(pick({ utmSource: 'newsletter', utmMedium: 'email' }), ['email', null]);
    assert.deepEqual(pick({ referrer: 'https://dentistsph.org' }), ['referral', 'dentistsph.org']);
    assert.deepEqual(pick({ landingPath: '/' }), ['direct', null]);
    assert.deepEqual(pick({ referrer: 'https://www.bytebuntech.com' }), ['direct', null]); // the site itself
  });

  it('keeps only clean values and never trusts a label from the browser', () => {
    assert.equal(classify(undefined), null);
    assert.equal(classify('social'), null);
    const a = classify({
      origin: 'ads',
      utmCampaign: `<script>${'x'.repeat(300)}`,
      referrer: 'javascript:alert(1)',
      clickIds: ['fbclid', 'evil'],
      landingPath: '//evil.example/path?email=a@b.c',
    })!;
    assert.equal(a.origin, 'social'); // from fbclid, not the "origin" it sent
    assert.equal(a.utmCampaign?.length, 100);
    assert.doesNotMatch(a.utmCampaign ?? '', /</);
    assert.equal(a.referrerHost, null);
    assert.equal(a.landingPath, null);
    assert.equal(classify({ landingPath: '/get-started?from=hero&email=a@b.c' })?.landingPath, '/get-started');
  });

  it('names the channel and describes it all', () => {
    assert.equal(channelOf('chatbot'), 'chatbot');
    assert.equal(channelOf('hero'), 'web_form');
    assert.equal(channelOf('chat-link'), 'web_form'); // the chat's link to the full form
    assert.equal(describeOrigin({ channel: 'chatbot', origin: 'social', originDetail: 'Facebook' }), 'Chatbot · Social media (Facebook)');
    assert.equal(describeOrigin({ channel: 'web_form', origin: null, originDetail: null }), 'Web form');
  });
});

describe('attribution: bookings and the admin leads list', () => {
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

  async function book(n: number, extra: Record<string, unknown>) {
    const slots = (await request(t.server).get('/api/booking/slots')).body;
    const taken = new Set<string>(slots.taken);
    const free = (slots.slots as string[]).filter((s) => !taken.has(s));
    const res = await request(t.server)
      .post('/api/leads')
      .set('Origin', ORIGIN)
      .send({
        firstName: 'Ana',
        lastName: `Lead${n}`,
        email: `ana.${n}.${Date.now()}@example.com`,
        businessType: 'Dental clinic',
        goals: ['more-bookings'],
        meetingAt: free[0],
        timeZone: 'Asia/Manila',
        fillMs: 20_000,
        ...extra,
      });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.id as number;
  }

  it('saves where each booking came from, and the admin can filter and count by it', async () => {
    const fb = await book(1, { source: 'chatbot', attribution: { utmSource: 'facebook', utmMedium: 'social', utmCampaign: 'nov-promo', landingPath: '/' } });
    const ig = await book(2, { source: 'hero', attribution: { referrer: 'https://l.instagram.com', clickIds: ['fbclid'], landingPath: '/' } });
    const google = await book(3, { source: 'final-cta', attribution: { referrer: 'https://www.google.com' } });
    const old = await book(4, { source: 'hero' }); // a page from before attribution existed

    const saved = await t.prisma.lead.findUniqueOrThrow({ where: { id: fb } });
    assert.equal(saved.channel, 'chatbot');
    assert.equal(saved.origin, 'social');
    assert.equal(saved.originDetail, 'Facebook');
    assert.equal(saved.utmCampaign, 'nov-promo');
    assert.equal((await t.prisma.lead.findUniqueOrThrow({ where: { id: old } })).origin, null);

    const b = browser(t.server);
    await enroll(b, JOSUE);
    const ids = async (from: string) => ((await b.get(`/api/admin/leads?from=${from}`)).body.items as any[]).map((l) => l.id).sort();
    assert.deepEqual(await ids('chatbot'), [fb]);
    assert.deepEqual(await ids('web_form'), [ig, google, old].sort());
    assert.deepEqual(await ids('social'), [fb, ig].sort());
    assert.deepEqual(await ids('search'), [google]);
    assert.deepEqual(await ids('unknown'), [old]);
    assert.equal((await b.get('/api/admin/leads?from=myspace')).status, 400);

    const list = (await b.get('/api/admin/leads?from=search')).body;
    // The counts cover every lead in the search, not just the filtered ones.
    assert.deepEqual(list.sources.channels, { chatbot: 1, web_form: 3 });
    assert.equal(list.sources.origins.social.count, 2);
    assert.deepEqual(list.sources.origins.social.details.map((d: any) => d.name).sort(), ['Facebook', 'Instagram']);
    assert.equal(list.sources.origins.unknown.count, 1);
    assert.equal(list.items[0].originDetail, 'Google');

    const csv = (await b.get('/api/admin/leads/export.csv?from=social')).text;
    assert.match(csv, /came_from,channel,origin,origin_detail/);
    assert.match(csv, /Chatbot · Social media \(Facebook\),chatbot,social,Facebook,facebook,social,nov-promo/);
    assert.doesNotMatch(csv, /Google/);
  });
});
