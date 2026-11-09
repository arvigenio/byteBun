// Where prospects come from. One search = "<industry> in <location>" (a city or a country).
//
//  - HERE Geocoding & Search, when HERE_API_KEY is set (the default then): HERE's own business
//    listings with phone, website and sometimes email; much better coverage than OpenStreetMap in
//    the Philippines. No ratings or reviews.
//  - Geoapify Places API, when GEOAPIFY_API_KEY is set: OpenStreetMap business
//    data with phone, website and social pages, fast and reliable. No ratings or reviews.
//  - Google Places API (New), when GOOGLE_PLACES_API_KEY is set: the same business listings as
//    Google Maps, with ratings, review counts, websites and phone numbers. Best results.
//  - OpenStreetMap (free, no key): Nominatim finds the place, Overpass lists matching
//    businesses. Coverage varies by country and there are no ratings.
//  - A JSON file (tests only, PROSPECTS_FIXTURE_FILE).
import fs from 'node:fs';
import type { ProspectsConfig } from '../config/config';
import { cleanEmail, mergeSocials, socialNetworkOf, type SocialLink } from './website-checkup';
import { ApiError } from '../common/api-error';

export type SourceName = 'here' | 'geoapify' | 'google' | 'osm' | 'fixture';

/** One business, as a source describes it. */
export interface PlaceFacts {
  externalId: string;
  name: string;
  category: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  phone: string | null;
  /** Public contact email, when the listing has one (the website checkup may find one too). */
  email: string | null;
  website: string | null;
  mapsUrl: string | null;
  rating: number | null;
  reviewCount: number | null;
  businessStatus: string | null;
  /** Facebook, Instagram, ... pages (from the listing; the website checkup adds more). */
  socials: SocialLink[];
}

export interface PlaceSource {
  readonly name: SourceName;
  /** Human name for the admin page. */
  readonly label: string;
  search(industry: string, location: string, max: number): Promise<PlaceFacts[]>;
}

// Nominatim and Overpass ask every client to identify itself (no personal contact details).
const USER_AGENT = 'ByteBunAdmin/1.0 (+https://bytebuntech.com)';
const TIMEOUT_MS = 30_000;

/**
 * The industry's entries from a category list. Entries marked `generic` ("clinic") count only
 * when nothing more specific matched, so "veterinary clinic" finds vets, not family doctors.
 */
export function matchIndustry<T extends { match: RegExp; generic?: boolean }>(list: T[], term: string): T[] {
  const specific = list.filter((e) => !e.generic && e.match.test(term));
  return specific.length ? specific : list.filter((e) => e.generic && e.match.test(term));
}

const sourceDown = (what: string) =>
  new ApiError(502, { error: 'source_unavailable', message: `${what} did not answer. Please try again in a minute.` });
const clip = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s.slice(0, max) : null;
};

// ---------------------------------------------------------------- Google Places (New)

interface GooglePlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: { longText?: string; types?: string[] }[];
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  businessStatus?: string;
  googleMapsUri?: string;
  primaryTypeDisplayName?: { text?: string };
}

const GOOGLE_FIELDS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.addressComponents',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.websiteUri',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.businessStatus',
  'places.googleMapsUri',
  'places.primaryTypeDisplayName',
  'nextPageToken',
].join(',');

export class GooglePlacesSource implements PlaceSource {
  readonly name = 'google' as const;
  readonly label = 'Google Maps';
  constructor(private readonly apiKey: string) {}

  async search(industry: string, location: string, max: number): Promise<PlaceFacts[]> {
    const out: PlaceFacts[] = [];
    let pageToken: string | undefined;
    // 20 per page, at most 3 pages (Google's limit for one text search).
    for (let page = 0; page < 3 && out.length < max; page++) {
      let res: Response;
      try {
        res = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': GOOGLE_FIELDS },
          body: JSON.stringify({ textQuery: `${industry} in ${location}`, pageSize: 20, ...(pageToken && { pageToken }) }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw sourceDown('Google Maps');
      }
      const body = (await res.json().catch(() => ({}))) as { places?: GooglePlace[]; nextPageToken?: string; error?: { message?: string } };
      if (!res.ok) {
        if (res.status === 400 || res.status === 403) {
          throw new ApiError(502, {
            error: 'source_rejected',
            message: `Google Maps refused the search: ${body.error?.message ?? res.statusText}. Check GOOGLE_PLACES_API_KEY and that "Places API (New)" is enabled.`,
          });
        }
        if (res.status === 429) throw new ApiError(429, { error: 'rate_limited', message: 'Google Maps quota reached. Please try again later.' });
        throw sourceDown('Google Maps');
      }
      for (const p of body.places ?? []) {
        const lat = p.location?.latitude;
        const lng = p.location?.longitude;
        const name = clip(p.displayName?.text, 200);
        if (!p.id || !name || typeof lat !== 'number' || typeof lng !== 'number') continue;
        const part = (type: string) => p.addressComponents?.find((c) => c.types?.includes(type))?.longText ?? null;
        out.push({
          externalId: `google:${p.id}`.slice(0, 200),
          name,
          category: clip(p.primaryTypeDisplayName?.text, 120),
          address: clip(p.formattedAddress, 400),
          city: clip(part('locality') ?? part('administrative_area_level_2'), 120),
          country: clip(part('country'), 120),
          latitude: lat,
          longitude: lng,
          phone: clip(p.internationalPhoneNumber ?? p.nationalPhoneNumber, 60),
          email: null, // Google doesn't list emails; the website checkup looks for one
          website: clip(p.websiteUri, 500),
          mapsUrl: clip(p.googleMapsUri, 500),
          rating: typeof p.rating === 'number' ? p.rating : null,
          reviewCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : 0,
          businessStatus: clip(p.businessStatus, 40),
          // Google lists one website; when it is a Facebook/Instagram page, that's their social.
          socials: mergeSocials([p.websiteUri]),
        });
      }
      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }
    return out.slice(0, max);
  }
}

// ---------------------------------------------------------------- OpenStreetMap

// Common industries -> OpenStreetMap tags. Anything else is matched by business name.
const OSM_TAGS: { match: RegExp; generic?: boolean; tags: [string, string][] }[] = [
  { match: /dent|orthodont/, tags: [['amenity', 'dentist'], ['healthcare', 'dentist']] },
  { match: /medical|doctor|physician|dermatolog|pediatric|family medicine|health ?care/, tags: [['amenity', 'clinic'], ['amenity', 'doctors'], ['healthcare', 'clinic'], ['healthcare', 'doctor']] },
  // "clinic" alone: only when nothing more specific matched ("vet clinic" = vets, not doctors).
  { match: /clinic/, generic: true, tags: [['amenity', 'clinic'], ['amenity', 'doctors'], ['healthcare', 'clinic'], ['healthcare', 'doctor']] },
  { match: /\bvet|animal|pet clinic/, tags: [['amenity', 'veterinary']] },
  { match: /physio|rehab/, tags: [['healthcare', 'physiotherapist']] },
  { match: /chiropract/, tags: [['healthcare', 'chiropractor']] },
  { match: /optic|optometr|eye/, tags: [['shop', 'optician'], ['healthcare', 'optometrist']] },
  { match: /pharma|drug ?store/, tags: [['amenity', 'pharmacy']] },
  { match: /salon|hair|barber/, tags: [['shop', 'hairdresser']] },
  { match: /beauty|nail|lash|brow|aesthetic|cosmetic/, tags: [['shop', 'beauty'], ['shop', 'cosmetics']] },
  { match: /\bspas?\b|massage|wellness/, tags: [['shop', 'massage'], ['leisure', 'spa'], ['amenity', 'spa']] },
  { match: /gym|fitness|crossfit|yoga|pilates/, tags: [['leisure', 'fitness_centre'], ['leisure', 'sports_centre']] },
  { match: /restaurant|diner|grill|eatery/, tags: [['amenity', 'restaurant']] },
  { match: /cafe|coffee/, tags: [['amenity', 'cafe']] },
  { match: /bakery|bake shop|pastry/, tags: [['shop', 'bakery'], ['shop', 'pastry']] },
  { match: /\bbars?\b|\bpubs?\b/, tags: [['amenity', 'bar'], ['amenity', 'pub']] },
  { match: /hotel|resort|\binns?\b|hostel/, tags: [['tourism', 'hotel'], ['tourism', 'guest_house'], ['tourism', 'hostel']] },
  { match: /\blaw(yer|yers|s| firm)?\b|attorney|legal/, tags: [['office', 'lawyer']] },
  { match: /account|bookkeep|tax/, tags: [['office', 'accountant'], ['office', 'tax_advisor']] },
  { match: /real ?estate|realtor|property/, tags: [['office', 'estate_agent']] },
  { match: /insurance/, tags: [['office', 'insurance']] },
  { match: /car repair|auto|mechanic|garage/, tags: [['shop', 'car_repair']] },
  { match: /car dealer|car sales/, tags: [['shop', 'car']] },
  { match: /car wash/, tags: [['amenity', 'car_wash']] },
  { match: /plumb/, tags: [['craft', 'plumber']] },
  { match: /electric/, tags: [['craft', 'electrician']] },
  { match: /roof/, tags: [['craft', 'roofer']] },
  { match: /hvac|air ?con|heating/, tags: [['craft', 'hvac']] },
  { match: /tutor|school|learning|academy/, tags: [['amenity', 'school'], ['amenity', 'language_school'], ['amenity', 'music_school']] },
  { match: /daycare|child ?care|preschool|kindergarten/, tags: [['amenity', 'kindergarten'], ['amenity', 'childcare']] },
  { match: /florist|flower/, tags: [['shop', 'florist']] },
  { match: /laundry|dry clean/, tags: [['shop', 'laundry'], ['shop', 'dry_cleaning']] },
  { match: /photo/, tags: [['shop', 'photo'], ['craft', 'photographer']] },
];
const BUSINESS_KEYS = 'shop|amenity|office|craft|healthcare|tourism|leisure';

// Overpass QL strings are double-quoted; the value is also a regex for name matching.
const OSM_SOCIAL_TAGS: [string, string][] = [
  ['facebook', 'https://www.facebook.com/'],
  ['instagram', 'https://www.instagram.com/'],
  ['tiktok', 'https://www.tiktok.com/@'],
  ['linkedin', 'https://www.linkedin.com/company/'],
  ['youtube', 'https://www.youtube.com/@'],
  ['twitter', 'https://x.com/'],
];
const OVERPASS_ENDPOINTS =['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const ovString =(s: string) => s.replace(/[\\"]/g, '\\$&');
const ovRegex = (s: string) => ovString(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

interface NominatimPlace {
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
  display_name?: string;
  /** [south, north, west, east] as strings */
  boundingbox?: string[];
  address?: { country?: string; city?: string; town?: string; state?: string };
}
interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export class OpenStreetMapSource implements PlaceSource {
  readonly name = 'osm' as const;
  readonly label = 'OpenStreetMap';

  private async getJson<T>(url: string, init: RequestInit, what: string, timeoutMs = TIMEOUT_MS): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...init.headers }, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw sourceDown(what);
    }
    if (res.status === 429) throw new ApiError(429, { error: 'rate_limited', message: `${what} is busy. Please wait a minute and try again.` });
    if (res.status === 504) {
      throw new ApiError(502, { error: 'source_timeout', message: 'That area is too big for the free map data. Try a city instead of a whole country.' });
    }
    if (!res.ok) throw sourceDown(what);
    return (await res.json()) as T;
  }

  async search(industry: string, location: string, max: number): Promise<PlaceFacts[]> {
    const params = new URLSearchParams({ q: location, format: 'jsonv2', limit: '1', addressdetails: '1' });
    const [place] = await this.getJson<NominatimPlace[]>(`https://nominatim.openstreetmap.org/search?${params}`, {}, 'The map search');
    if (!place?.osm_id) throw new ApiError(400, { error: 'location_not_found', message: `We couldn't find "${location}" on the map. Try a city or country name.`, fields: { location: 'Location not found.' } });

    // Search the place's bounding box (much faster on Overpass than its exact boundary), or about
    // 15 km around it when it is a single point.
    let [s, n, w, e] = (place.boundingbox ?? []).map(Number) as (number | undefined)[];
    if (![s, n, w, e].every((v) => Number.isFinite(v)) || (n! - s! < 0.01 && e! - w! < 0.01)) {
      const lat = Number(place.lat);
      const lon = Number(place.lon);
      [s, n, w, e] = [lat - 0.135, lat + 0.135, lon - 0.135, lon + 0.135];
    }
    const term = industry.toLowerCase();
    const tags = matchIndustry(OSM_TAGS, term).flatMap((t) => t.tags);
    const nameKeys = BUSINESS_KEYS.split('|').slice(0, tags.length ? 5 : 7);
    const lines = [
      ...tags.map(([k, v]) => `nwr["${k}"="${v}"]["name"];`),
      // Also match the industry in business names (e.g. "Bright Smile Dental Studio").
      ...nameKeys.map((k) => `nwr["${k}"]["name"~"${ovRegex(industry)}",i];`),
    ];
    const query = `[out:json][timeout:55][bbox:${s},${w},${n},${e}];(${lines.join('')});out center tags ${Math.min(max * 2, 300)};`;
    const body = new URLSearchParams({ data: query }).toString();
    // The public Overpass servers are sometimes overloaded: try the next one.
    let data: { elements?: OsmElement[] } | null = null;
    let lastError: unknown;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        data = await this.getJson(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }, 'The free map data service', 60_000);
        break;
      } catch (err) {
        lastError = err;
        if (err instanceof ApiError && err.getStatus() === 400) throw err;
      }
    }
    if (!data) {
      throw lastError instanceof ApiError && lastError.getStatus() !== 502
        ? lastError
        : new ApiError(502, {
            error: 'source_unavailable',
            message: 'The free map data service is busy right now. Try again in a minute, or try a smaller area (a city instead of a country). Adding a Google Places key makes searches fast and reliable.',
          });
    }

    const country = place.address?.country ?? place.display_name?.split(',').pop()?.trim() ?? null;
    const out: PlaceFacts[] = [];
    const seen = new Set<string>();
    for (const el of data.elements ?? []) {
      const t = el.tags ?? {};
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      const name = clip(t.name, 200);
      if (!name || typeof lat !== 'number' || typeof lng !== 'number') continue;
      const key = `${name.toLowerCase()}|${lat.toFixed(3)}|${lng.toFixed(3)}`; // a shop drawn as both a point and a building
      if (seen.has(key)) continue;
      seen.add(key);
      const kind = t.healthcare ?? t.amenity ?? t.shop ?? t.office ?? t.craft ?? t.tourism ?? t.leisure ?? null;
      const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
      const city = t['addr:city'] ?? place.address?.city ?? place.address?.town ?? null;
      out.push({
        externalId: `osm:${el.type}/${el.id}`,
        name,
        category: kind ? clip(kind.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), 120) : null,
        address: clip([street, t['addr:city'], t['addr:postcode']].filter(Boolean).join(', '), 400),
        city: clip(city, 120),
        country: clip(country, 120),
        latitude: lat,
        longitude: lng,
        phone: clip(t.phone ?? t['contact:phone'] ?? t['contact:mobile'], 60),
        email: cleanEmail(t.email ?? t['contact:email']),
        // A Facebook/Instagram page counts as the business's only web presence.
        website: clip(t.website ?? t['contact:website'] ?? t.url, 500),
        socials: mergeSocials(
          [t.website, t['contact:website'], t.url].filter((u) => u && socialNetworkOf(u)),
          // contact:* tags hold a URL or just the page name ("smiledentalph").
          OSM_SOCIAL_TAGS.map(([tag, base]) => {
            const v = t[`contact:${tag}`] ?? t[tag];
            if (!v) return null;
            return /^(https?:\/\/|www\.)|\.(com|me|be)\//i.test(v) ? v : `${base}${v.replace(/^@/, '')}`;
          }),
        ),
        mapsUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
        rating: null,
        reviewCount: null,
        businessStatus: null,
      });
      if (out.length >= max) break;
    }
    return out;
  }
}

// ---------------------------------------------------------------- Geoapify

// Common industries -> Geoapify Places categories (apidocs.geoapify.com/docs/places/#categories).
// Industries not listed (plumber, physiotherapy, ...) are matched by business name instead.
const GEOAPIFY_CATEGORIES: { match: RegExp; generic?: boolean; categories: string[] }[] = [
  { match: /dent|orthodont/, categories: ['healthcare.dentist'] },
  { match: /medical|doctor|physician|dermatolog|pediatric|family medicine|health ?care/, categories: ['healthcare.clinic_or_praxis'] },
  // "clinic" alone: only when nothing more specific matched ("vet clinic" = vets, not doctors).
  { match: /clinic/, generic: true, categories: ['healthcare.clinic_or_praxis'] },
  { match: /\bvet|animal|pet clinic/, categories: ['pet.veterinary'] },
  { match: /pharma|drug ?store/, categories: ['healthcare.pharmacy'] },
  { match: /optic|optometr|eye/, categories: ['commercial.health_and_beauty.optician'] },
  { match: /salon|hair|barber/, categories: ['service.beauty.hairdresser'] },
  { match: /beauty|nail|lash|brow|aesthetic|cosmetic/, categories: ['service.beauty'] },
  { match: /\bspas?\b|massage|wellness/, categories: ['service.beauty.spa', 'service.beauty.massage', 'leisure.spa'] },
  { match: /gym|fitness|crossfit|yoga|pilates/, categories: ['sport.fitness'] },
  { match: /restaurant|diner|grill|eatery/, categories: ['catering.restaurant'] },
  { match: /cafe|coffee/, categories: ['catering.cafe'] },
  { match: /bakery|bake shop|pastry/, categories: ['commercial.food_and_drink.bakery'] },
  { match: /\bbars?\b|\bpubs?\b/, categories: ['catering.bar', 'catering.pub'] },
  { match: /hotel|resort|\binns?\b|hostel/, categories: ['accommodation.hotel'] },
  { match: /\blaw(yer|yers|s| firm)?\b|attorney|legal/, categories: ['office.lawyer'] },
  { match: /account|bookkeep|tax/, categories: ['office.accountant', 'office.tax_advisor'] },
  { match: /real ?estate|realtor|property/, categories: ['office.estate_agent', 'service.estate_agent'] },
  { match: /insurance/, categories: ['office.insurance'] },
  { match: /car repair|auto|mechanic|garage/, categories: ['service.vehicle.repair'] },
  { match: /car wash/, categories: ['service.vehicle.car_wash'] },
  { match: /electric/, categories: ['service.electrician'] },
  { match: /tutor|school|learning|academy/, categories: ['education.school', 'education.language_school', 'education.driving_school'] },
  { match: /daycare|child ?care|preschool|kindergarten/, categories: ['childcare.kindergarten'] },
  { match: /florist|flower/, categories: ['commercial.florist'] },
  { match: /laundry|dry clean/, categories: ['service.cleaning.laundry', 'service.cleaning.dry_cleaning'] },
];
// Broad parents for a name search when the industry has no category of its own.
const GEOAPIFY_BUSINESS = ['commercial', 'service', 'office', 'healthcare', 'catering', 'education', 'sport', 'leisure', 'accommodation', 'pet', 'childcare'];

interface GeoapifyFeature {
  properties?: {
    place_id?: string;
    name?: string;
    categories?: string[];
    formatted?: string;
    address_line2?: string;
    city?: string;
    county?: string;
    country?: string;
    lat?: number;
    lon?: number;
    website?: string;
    contact?: { phone?: string; email?: string };
    datasource?: { raw?: Record<string, string | number> };
  };
}

export class GeoapifySource implements PlaceSource {
  readonly name = 'geoapify' as const;
  readonly label = 'Geoapify (OpenStreetMap data)';
  constructor(private readonly apiKey: string) {}

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = `https://api.geoapify.com${path}?${new URLSearchParams({ ...params, apiKey: this.apiKey })}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw sourceDown('Geoapify');
    }
    const body = (await res.json().catch(() => ({}))) as T & { message?: string };
    if (res.status === 401 || res.status === 403) {
      throw new ApiError(502, { error: 'source_rejected', message: `Geoapify refused the search${body.message ? `: ${body.message}` : ''}. Check GEOAPIFY_API_KEY.` });
    }
    if (res.status === 429) throw new ApiError(429, { error: 'rate_limited', message: "Geoapify's daily limit is used up. Please try again tomorrow or upgrade the Geoapify plan." });
    if (res.status === 400) throw new ApiError(400, { error: 'bad_search', message: `Geoapify could not run that search${body.message ? `: ${body.message}` : ''}.` });
    if (!res.ok) throw sourceDown('Geoapify');
    return body;
  }

  async search(industry: string, location: string, max: number): Promise<PlaceFacts[]> {
    // 1. Where: the city or country (1 credit).
    const geo = await this.get<{ results?: { place_id?: string; lat?: number; lon?: number; result_type?: string; country?: string; city?: string }[] }>('/v1/geocode/search', {
      text: location,
      format: 'json',
      limit: '1',
      lang: 'en',
      bias: 'countrycode:none',
    });
    const place = geo.results?.[0];
    if (!place?.place_id || typeof place.lat !== 'number' || typeof place.lon !== 'number') {
      throw new ApiError(400, { error: 'location_not_found', message: `We couldn't find "${location}" on the map. Try a city or country name.`, fields: { location: 'Location not found.' } });
    }
    // An area (city, region, country) is searched inside its boundary; a point within 15 km.
    const isArea = ['city', 'county', 'state', 'country', 'district', 'suburb', 'postcode'].includes(place.result_type ?? '');
    const filter = isArea ? `place:${place.place_id}` : `circle:${place.lon},${place.lat},15000`;

    // 2. What: by category when we know one for this industry, else by business name.
    const term = industry.toLowerCase();
    const categories = [...new Set(matchIndustry(GEOAPIFY_CATEGORIES, term).flatMap((c) => c.categories))];
    const data = await this.get<{ features?: GeoapifyFeature[] }>('/v2/places', {
      categories: (categories.length ? categories : GEOAPIFY_BUSINESS).join(','),
      ...(!categories.length && { name: industry }),
      filter,
      bias: `proximity:${place.lon},${place.lat}`,
      limit: String(Math.min(max, 200)),
      lang: 'en',
    });

    const out: PlaceFacts[] = [];
    for (const f of data.features ?? []) {
      const p = f.properties ?? {};
      const name = clip(p.name, 200);
      if (!p.place_id || !name || typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      // The original OpenStreetMap tags: phone, website and social pages live here.
      const raw = Object.fromEntries(Object.entries(p.datasource?.raw ?? {}).map(([k, v]) => [k, String(v)]));
      const website = clip(p.website ?? raw.website ?? raw['contact:website'] ?? raw.url, 500);
      const kind = (p.categories ?? []).filter((c) => !c.includes('wheelchair') && !c.startsWith('building')).sort((a, b) => b.split('.').length - a.split('.').length)[0];
      const osmType = { n: 'node', w: 'way', r: 'relation' }[String(raw.osm_type ?? '')] ?? null;
      out.push({
        externalId: `geoapify:${p.place_id}`.slice(0, 200),
        name,
        category: kind ? clip(kind.split('.').pop()!.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), 120) : null,
        address: clip(p.formatted, 400),
        city: clip(p.city ?? p.county ?? place.city, 120),
        country: clip(p.country ?? place.country, 120),
        latitude: p.lat,
        longitude: p.lon,
        phone: clip(p.contact?.phone ?? raw.phone ?? raw['contact:phone'] ?? raw['contact:mobile'], 60),
        email: cleanEmail(p.contact?.email ?? raw.email ?? raw['contact:email']),
        website: website && socialNetworkOf(website) ? null : website,
        mapsUrl: osmType && raw.osm_id ? `https://www.openstreetmap.org/${osmType}/${raw.osm_id}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${p.formatted ?? ''}`.trim())}`,
        rating: null,
        reviewCount: null,
        businessStatus: null,
        socials: mergeSocials(
          [website].filter((u) => u && socialNetworkOf(u)),
          OSM_SOCIAL_TAGS.map(([tag, base]) => {
            const v = raw[`contact:${tag}`] ?? raw[tag];
            if (!v) return null;
            return /^(https?:\/\/|www\.)|\.(com|me|be)\//i.test(v) ? v : `${base}${v.replace(/^@/, '')}`;
          }),
        ),
      });
    }
    return out.slice(0, max);
  }
}

// ---------------------------------------------------------------- HERE

interface HereGeocodeItem {
  resultType?: string;
  position?: { lat?: number; lng?: number };
  mapView?: { west?: number; south?: number; east?: number; north?: number };
  address?: { countryCode?: string; countryName?: string; city?: string };
}
type HereValues = { value?: string }[];
interface HerePlace {
  id?: string;
  title?: string;
  resultType?: string;
  position?: { lat?: number; lng?: number };
  address?: { label?: string; city?: string; district?: string; countryName?: string };
  categories?: { id?: string; name?: string; primary?: boolean }[];
  contacts?: { phone?: HereValues; mobile?: HereValues; www?: HereValues; email?: HereValues }[];
}

/** Straight-line distance in meters. */
function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

export class HereSource implements PlaceSource {
  readonly name = 'here' as const;
  readonly label = 'HERE';
  constructor(private readonly apiKey: string) {}

  private async get<T>(host: string, path: string, params: Record<string, string>): Promise<T> {
    const url = `https://${host}${path}?${new URLSearchParams({ ...params, apiKey: this.apiKey })}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw sourceDown('HERE');
    }
    const body = (await res.json().catch(() => ({}))) as T & { title?: string; error_description?: string };
    const why = body.title ?? body.error_description;
    if (res.status === 401 || res.status === 403) {
      throw new ApiError(502, { error: 'source_rejected', message: `HERE refused the search${why ? `: ${why}` : ''}. Check HERE_API_KEY.` });
    }
    if (res.status === 429) throw new ApiError(429, { error: 'rate_limited', message: 'HERE is limiting searches right now (or the monthly free amount is used up). Please try again later.' });
    if (res.status === 400) throw new ApiError(400, { error: 'bad_search', message: `HERE could not run that search${why ? `: ${why}` : ''}.` });
    if (!res.ok) throw sourceDown('HERE');
    return body;
  }

  async search(industry: string, location: string, max: number): Promise<PlaceFacts[]> {
    // 1. Where: the city or country, with its bounding box.
    const geo = await this.get<{ items?: HereGeocodeItem[] }>('geocode.search.hereapi.com', '/v1/geocode', { q: location, limit: '1', lang: 'en' });
    const place = geo.items?.[0];
    const lat = place?.position?.lat;
    const lng = place?.position?.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      throw new ApiError(400, { error: 'location_not_found', message: `We couldn't find "${location}" on the map. Try a city or country name.`, fields: { location: 'Location not found.' } });
    }
    // A country: the whole country. Otherwise a circle covering the place's map view (2-50 km).
    const v = place!.mapView;
    const isCountry = place!.resultType === 'administrativeArea' && !place!.address?.city && !!place!.address?.countryCode;
    let area: string;
    if (isCountry) {
      area = `countryCode:${place!.address!.countryCode}`;
    } else {
      const half = v && [v.west, v.south, v.east, v.north].every((n) => typeof n === 'number') ? distanceM(v.south!, v.west!, v.north!, v.east!) / 2 : 15_000;
      area = `circle:${lat},${lng};r=${Math.round(Math.min(50_000, Math.max(2_000, half)))}`;
    }

    // 2. What: HERE's Discover matches the industry against categories and names.
    const data = await this.get<{ items?: HerePlace[] }>('discover.search.hereapi.com', '/v1/discover', {
      q: industry,
      ...(isCountry ? { at: `${lat},${lng}` } : {}),
      in: area,
      limit: String(Math.min(max, 100)),
      lang: 'en',
    });

    const out: PlaceFacts[] = [];
    for (const p of data.items ?? []) {
      const name = clip(p.title, 200);
      const plat = p.position?.lat;
      const plng = p.position?.lng;
      if (!p.id || !name || typeof plat !== 'number' || typeof plng !== 'number' || (p.resultType && p.resultType !== 'place')) continue;
      const contacts = p.contacts ?? [];
      const all = (k: 'phone' | 'mobile' | 'www' | 'email') => contacts.flatMap((c) => (c[k] ?? []).map((x) => x.value?.trim()).filter((x): x is string => !!x));
      const links = all('www');
      const website = clip(links.find((u) => !socialNetworkOf(u)), 500);
      const category = p.categories?.find((c) => c.primary) ?? p.categories?.[0];
      const address = clip(p.address?.label, 400);
      out.push({
        externalId: `here:${p.id}`.slice(0, 200),
        name,
        category: clip(category?.name, 120),
        address,
        city: clip(p.address?.city ?? p.address?.district ?? place!.address?.city, 120),
        country: clip(p.address?.countryName ?? place!.address?.countryName, 120),
        latitude: plat,
        longitude: plng,
        phone: clip(all('phone')[0] ?? all('mobile')[0], 60),
        email: all('email').map(cleanEmail).find((e) => e) ?? null,
        website,
        mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${address ?? ''}`.trim())}`,
        rating: null,
        reviewCount: null,
        businessStatus: null,
        socials: mergeSocials(links.filter((u) => socialNetworkOf(u))),
      });
    }
    return out.slice(0, max);
  }
}

// ---------------------------------------------------------------- fixture (tests)

export class FixturePlaceSource implements PlaceSource {
  readonly name = 'fixture' as const;
  readonly label = 'Test data';
  constructor(private readonly file: string) {}
  async search(_industry: string, _location: string, max: number): Promise<PlaceFacts[]> {
    return (JSON.parse(fs.readFileSync(this.file, 'utf8')) as PlaceFacts[]).slice(0, max).map((p) => ({ ...p, email: p.email ?? null, socials: p.socials ?? [] }));
  }
}

export function createPlaceSource(cfg: ProspectsConfig): PlaceSource {
  if (cfg.fixtureFile) return new FixturePlaceSource(cfg.fixtureFile);
  if (cfg.source === 'here') return new HereSource(cfg.hereApiKey);
  if (cfg.source === 'geoapify') return new GeoapifySource(cfg.geoapifyApiKey);
  if (cfg.source === 'google') return new GooglePlacesSource(cfg.googleApiKey);
  return new OpenStreetMapSource();
}
