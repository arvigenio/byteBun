// Prospecting: find businesses by industry + location and rank them by how likely they are to
// sign up. A search's results live in this process's memory for a short time (so a repeat search
// is instant, and website checkups can fill in live), then they are gone. Admins can keep any of
// them in the database (saved-prospects.service.ts); results show which ones are saved.
import crypto from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { hitCounter } from '../auth/security-counter';
import { ApiError } from '../common/api-error';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../database/prisma.service';
import { featureLabel } from '../leads/lead-options';
import { AdminEvents } from '../realtime/admin-events';
import { createPlaceSource, type PlaceFacts, type PlaceSource } from './place-sources';
import { scoreProspect } from './scoring';
import { checkWebsite, mergeSocials, websiteKind, type WebsiteCheckup } from './website-checkup';

/** How long a search's results are kept in memory (and a repeat search reuses them). */
const KEEP_MS = 30 * 60_000;
const MAX_SEARCHES_KEPT = 40;
const SEARCH_LIMIT = { max: 30, windowMs: 3_600_000 };
const CHECKUP_CONCURRENCY = 4;

interface Item {
  id: number;
  facts: PlaceFacts;
  checkup: WebsiteCheckup | null;
  checking: boolean;
}

interface Search {
  id: string;
  key: string;
  industry: string;
  location: string;
  source: string;
  createdBy: string;
  createdAt: Date;
  expiresAt: number;
  items: Item[];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export type PresentedProspect = ReturnType<ProspectsService['present']>;
/** Already saved (saved-prospects.service.ts): its saved id and group. */
type SavedMark = { id: number; groupId: number | null };

/** The saved_prospects columns a search result fills in (all but group, note, who saved it). */
export function snapshotOf(p: PresentedProspect) {
  return {
    name: p.name.slice(0, 200),
    category: p.category,
    address: p.address,
    city: p.city,
    country: p.country,
    latitude: p.lat,
    longitude: p.lng,
    phone: p.phone,
    email: p.email,
    website: p.website,
    mapsUrl: p.mapsUrl?.slice(0, 1000) ?? null,
    rating: p.rating,
    reviewCount: p.reviewCount,
    score: p.score,
    tier: p.tier,
    websiteKind: p.websiteKind,
    socials: p.socials as unknown as Prisma.InputJsonValue,
    reasons: p.reasons as unknown as Prisma.InputJsonValue,
    pitch: p.pitch as unknown as Prisma.InputJsonValue,
    checkup: p.checkup ? (p.checkup as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
  };
}

@Injectable()
export class ProspectsService {
  private readonly log = new Logger('Prospects');
  private readonly source: PlaceSource;
  private readonly searches = new Map<string, Search>();
  /** Background checkups in flight (tests wait for these). */
  readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: AdminEvents,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {
    this.source = createPlaceSource(cfg.prospects);
  }

  meta() {
    return {
      source: this.source.name,
      sourceLabel: this.source.label,
      // Only Google has ratings and reviews; with the others, scores lean on website, socials and phone.
      hasReviews: this.source.name === 'google' || this.source.name === 'fixture',
      websiteChecks: this.cfg.prospects.websiteChecks,
      // Who draws the map tiles (map-tiles.controller.ts), for the map's attribution line.
      tiles: this.cfg.prospects.hereApiKey ? 'here' : this.cfg.prospects.geoapifyApiKey ? 'geoapify' : 'osm',
      maxResults: this.cfg.prospects.maxResults,
    };
  }

  // ---------------------------------------------------------------- results

  present(item: Item) {
    const { facts: f, checkup } = item;
    const { score, tier, reasons } = scoreProspect(f, checkup);
    const socials = mergeSocials(f.socials, checkup?.socials ?? []);
    return {
      id: item.id,
      name: f.name,
      category: f.category,
      address: f.address,
      city: f.city,
      country: f.country,
      lat: f.latitude,
      lng: f.longitude,
      phone: f.phone,
      email: f.email ?? checkup?.email ?? null,
      website: websiteKind(f.website) === 'site' ? f.website : null,
      websiteKind: websiteKind(f.website, socials),
      socials,
      mapsUrl: f.mapsUrl,
      rating: f.rating,
      reviewCount: f.reviewCount,
      businessStatus: f.businessStatus,
      score,
      tier,
      reasons: reasons.map(({ key, label, points }) => ({ key, label, points })),
      // What to pitch, most valuable reasons first, without repeats.
      pitch: [...new Set([...reasons].sort((a, b) => b.points - a.points).flatMap((r) => r.pitch))].slice(0, 5).map(featureLabel),
      checkup,
      checkingWebsite: item.checking,
    };
  }

  /** Which of these businesses are saved, by external id. */
  private async savedMarks(items: Item[]): Promise<Map<string, SavedMark>> {
    if (!items.length) return new Map();
    const rows = await this.prisma.savedProspect.findMany({
      where: { externalId: { in: items.map((i) => i.facts.externalId) } },
      select: { id: true, externalId: true, groupId: true },
    });
    return new Map(rows.map((r) => [r.externalId, { id: r.id, groupId: r.groupId }]));
  }

  /** Best chance of signing up first; ties go to the busier business (more reviews). */
  private async ranked(search: Search) {
    const saved = await this.savedMarks(search.items);
    const items = search.items
      .map((i) => ({ ...this.present(i), saved: saved.get(i.facts.externalId) ?? null }))
      .sort((a, b) => b.score - a.score || (b.reviewCount ?? -1) - (a.reviewCount ?? -1) || a.name.localeCompare(b.name))
      .map((p, i) => ({ ...p, rank: i + 1 }));
    const tiers = { hot: 0, warm: 0, cold: 0 };
    for (const p of items) tiers[p.tier]++;
    return {
      search: { id: search.id, industry: search.industry, location: search.location, source: search.source, createdBy: search.createdBy, createdAt: search.createdAt, total: items.length, tiers },
      items,
    };
  }

  private prune() {
    const now = Date.now();
    for (const [id, s] of this.searches) if (s.expiresAt <= now) this.searches.delete(id);
    // Oldest first (Map keeps insertion order).
    while (this.searches.size > MAX_SEARCHES_KEPT) this.searches.delete(this.searches.keys().next().value!);
  }

  private find(id: string): Search {
    this.prune();
    const s = this.searches.get(id);
    if (!s) throw new ApiError(404, { error: 'not_found', message: 'Those results have expired. Please search again.' });
    return s;
  }

  // ---------------------------------------------------------------- searching

  async search(input: { industry: string; location: string; refresh?: boolean }, actor: { email: string }) {
    const industry = input.industry.trim().replace(/\s+/g, ' ');
    const location = input.location.trim().replace(/\s+/g, ' ');
    const key = `${this.source.name}|${norm(industry)}|${norm(location)}`;

    this.prune();
    if (!input.refresh) {
      const recent = [...this.searches.values()].reverse().find((s) => s.key === key);
      if (recent) return { ...(await this.ranked(recent)), reused: true };
    }

    if (!this.cfg.rateLimitsDisabled) {
      const hit = await hitCounter(this.prisma as unknown as PrismaClient, `prospect-search:${actor.email}`, SEARCH_LIMIT.windowMs);
      if (hit.count > SEARCH_LIMIT.max) {
        throw new ApiError(429, { error: 'rate_limited', message: `That's ${SEARCH_LIMIT.max} searches this hour. Please wait a while and try again.` });
      }
    }

    const facts = await this.source.search(industry, location, this.cfg.prospects.maxResults);
    const unique = [...new Map(facts.map((f) => [f.externalId, f])).values()];
    const checks = this.cfg.prospects.websiteChecks;
    const search: Search = {
      id: crypto.randomUUID(),
      key,
      industry,
      location,
      source: this.source.name,
      createdBy: actor.email,
      createdAt: new Date(),
      expiresAt: Date.now() + KEEP_MS,
      items: unique.map((f, i) => ({ id: i + 1, facts: f, checkup: null, checking: checks && websiteKind(f.website) === 'site' })),
    };
    this.searches.set(search.id, search);
    this.log.log(`${actor.email} searched "${industry}" in "${location}": ${unique.length} businesses`);
    this.runCheckups(search, search.items.filter((i) => i.checking));
    return { ...(await this.ranked(search)), reused: false };
  }

  /** The current results (with any checkups finished since). */
  get(searchId: string) {
    return this.ranked(this.find(searchId));
  }

  /** Results to save (saved-prospects.service.ts): the server's own copy, never the browser's. */
  itemsForSaving(searchId: string, itemIds: number[]) {
    const search = this.find(searchId);
    const wanted = new Set(itemIds);
    const items = search.items.filter((i) => wanted.has(i.id)).map((i) => ({ externalId: i.facts.externalId, item: this.present(i) }));
    if (!items.length) throw new ApiError(404, { error: 'not_found', message: 'Those businesses are not in these results.' });
    return { search, items };
  }

  // ---------------------------------------------------------------- website checkups

  /** Checks one business's website again, now (the admin's "Check again"). */
  async recheck(searchId: string, itemId: number) {
    const search = this.find(searchId);
    const item = search.items.find((i) => i.id === itemId);
    if (!item) throw new ApiError(404, { error: 'not_found', message: 'That business is not in these results.' });
    if (websiteKind(item.facts.website) === 'site') await this.checkOne(item);
    return this.get(searchId);
  }

  /** Background: checks each website; every result is pushed live to the admin site. */
  private runCheckups(search: Search, items: Item[]) {
    if (!items.length) return;
    const queue = [...items];
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        if (!this.searches.has(search.id)) return; // expired meanwhile
        await this.checkOne(item);
        // Just this business; the admin page re-sorts the list.
        this.events.prospectsUpdated({ searchId: search.id, item: this.present(item) });
      }
    };
    const run = Promise.all(Array.from({ length: CHECKUP_CONCURRENCY }, worker))
      .then(() => undefined)
      .catch((err: Error) => this.log.error(`Website checkups failed: ${err.message}`));
    this.pending.add(run);
    void run.finally(() => this.pending.delete(run));
  }

  private async checkOne(item: Item) {
    item.checking = true;
    try {
      item.checkup = await checkWebsite(item.facts.website!);
    } finally {
      item.checking = false;
    }
    // Already saved: keep the saved copy up to date (score, email, checkup).
    await this.prisma.savedProspect
      .updateMany({ where: { externalId: item.facts.externalId }, data: snapshotOf(this.present(item)) })
      .then(({ count }) => count && this.events.savedProspectsChanged())
      .catch((err: Error) => this.log.warn(`Could not refresh a saved prospect: ${err.message}`));
  }
}
