// Fit score: how likely a business is to sign up with Byte Bun, 0-100, with the reasons.
//
// It is a transparent points model, not a black box: every point comes with a reason the admin
// can read ("No website", "Not mobile-friendly", "120 Google reviews"). The idea:
//  - NEED: no website, only a Facebook page, or a weak website (not secure, not mobile-friendly,
//    no online booking, no chat, slow, outdated) = something we sell fixes it.
//  - ABILITY: an established business (many reviews) has customers and budget; few reviews or a
//    low rating = review requests and reputation work.
//  - REACH: a phone number means we can actually contact them.
// Closed businesses score 0. Tune the points here; scores update on the next search or re-check.
import type { PlaceFacts } from './place-sources';
import { websiteKind, type WebsiteCheckup } from './website-checkup';

export type Tier = 'hot' | 'warm' | 'cold';

export interface ScoreReason {
  key: string;
  label: string;
  points: number;
  /** Byte Bun features that answer this (src/leads/lead-options.ts FEATURES keys). */
  pitch: string[];
}

export interface Score {
  score: number;
  tier: Tier;
  reasons: ScoreReason[];
}

const BASE = 25;
export const HOT_AT = 70;
export const WARM_AT = 45;

const NETWORK_NAMES: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn', youtube: 'YouTube', x: 'X' };
const networkName = (n: string) => NETWORK_NAMES[n] ?? n;

export const tierOf = (score: number): Tier => (score >= HOT_AT ? 'hot' : score >= WARM_AT ? 'warm' : 'cold');

type Facts = Pick<PlaceFacts, 'website' | 'phone' | 'rating' | 'reviewCount' | 'businessStatus' | 'socials'>;

export function scoreProspect(p: Facts, checkup: WebsiteCheckup | null, now = new Date()): Score {
  if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') {
    const label = p.businessStatus === 'CLOSED_TEMPORARILY' ? 'Temporarily closed' : 'Permanently closed';
    return { score: 0, tier: 'cold', reasons: [{ key: 'closed', label, points: -BASE, pitch: [] }] };
  }

  const reasons: ScoreReason[] = [];
  const add = (key: string, label: string, points: number, pitch: string[] = []) => reasons.push({ key, label, points, pitch });

  // ---- need: their website ----
  const kind = websiteKind(p.website, p.socials);
  const networks = [...new Set([...p.socials, ...(checkup?.socials ?? [])].map((x) => x.network))];
  if (kind === 'none') {
    add('no-website', 'No website', 30, ['custom-website', 'domain-hosting', 'online-booking', 'local-seo']);
  } else if (kind === 'social') {
    add('social-only', `Active on ${networks.length ? networks.map(networkName).join(' and ') : 'social media'} but has no website`, 25, ['custom-website', 'domain-hosting', 'ai-chatbot']);
  } else if (checkup && !checkup.blocked) {
    if (!checkup.reachable) {
      add('site-down', "Website doesn't load", 20, ['custom-website', 'domain-hosting']);
    } else {
      let gaps = 0;
      if (!checkup.https) (gaps++, add('no-https', 'Website is not secure (no HTTPS)', 8, ['domain-hosting']));
      if (!checkup.mobileFriendly) (gaps++, add('not-mobile', 'Not mobile-friendly', 10, ['custom-website']));
      if (!checkup.onlineBooking) (gaps++, add('no-booking', 'No online booking', 10, ['online-booking', 'appointment-reminders']));
      if (!checkup.chat) (gaps++, add('no-chat', 'No chat or chatbot', 4, ['ai-chatbot', 'missed-call-text-back']));
      if (checkup.responseMs !== null && checkup.responseMs > 3500) (gaps++, add('slow', `Slow website (${(checkup.responseMs / 1000).toFixed(1)} s)`, 5, ['custom-website']));
      const age = checkup.copyrightYear ? now.getUTCFullYear() - checkup.copyrightYear : 0;
      if (age >= 3) (gaps++, add('outdated', `Website looks outdated (© ${checkup.copyrightYear})`, 6, ['custom-website']));
      if (gaps === 0) add('modern-site', 'Already has a modern website with booking and chat', -15);
    }
  }

  // ---- ability and reputation (Google data only) ----
  const reviews = p.reviewCount;
  if (reviews !== null) {
    if (reviews >= 50) add('established', `Established: ${reviews} Google reviews`, 12, ['crm-pipeline', 'recall-campaigns']);
    else if (reviews >= 15) add('steady', `Steady business: ${reviews} Google reviews`, 8, ['review-requests']);
    else if (reviews >= 1) add('few-reviews', `Only ${reviews} Google review${reviews === 1 ? '' : 's'}`, 6, ['review-requests', 'local-seo']);
    else add('no-reviews', 'No Google reviews yet', 2, ['review-requests', 'local-seo']);
    if (p.rating !== null && reviews >= 5 && p.rating < 4.0) add('low-rating', `Rating ${p.rating.toFixed(1)}: needs reputation help`, 6, ['review-requests']);
  }

  // ---- reach ----
  if (p.phone) add('phone', 'Has a phone number', 6, ['missed-call-text-back']);
  else if (kind === 'none') add('unreachable', 'Hard to reach (no phone or website)', -12);

  const score = Math.max(0, Math.min(100, BASE + reasons.reduce((n, r) => n + r.points, 0)));
  return { score, tier: tierOf(score), reasons };
}
