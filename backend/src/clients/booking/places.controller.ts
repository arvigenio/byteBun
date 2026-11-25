// Address suggestions and map tiles for the business's pages (an event's location picker).
// HERE does the geocoding (HERE_API_KEY, the same key as Prospecting); the key stays on the server.
// Signed-in businesses only.
//
//   GET /api/client/places/suggest?q&at=lat,lng&tz   up to 6 places (venues, shops, addresses)
//     Searching places needs a point to search around: the pin, the device's location (at), or
//     else the city of the event's time zone (tz, e.g. Asia/Manila -> around Manila).
//   GET /api/client/places/reverse?lat&lng        the address at a dropped pin
//   GET /api/client/maps/tiles/:z/:x/:y.png       map tiles (the same tiles as the admin's map)
import { Controller, Get, Inject, Param, Query, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ApiError } from '../../common/api-error';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { MapTilesController } from '../../prospects/map-tiles.controller';
import { ClientRoute } from '../client-context';

const ROUTE = { app: 'bookings', permission: 'bookings.settings' } as const;

interface HereItem {
  title?: string;
  address?: { label?: string };
  position?: { lat: number; lng: number };
  resultType?: string;
}

const toPlace = (i: HereItem) => (i.position ? { label: i.title ?? i.address?.label ?? '', address: i.address?.label ?? i.title ?? '', lat: i.position.lat, lng: i.position.lng, kind: i.resultType ?? 'place' } : null);

@Controller('client')
export class PlacesController {
  private readonly tiles: MapTilesController;
  /** "Asia/Manila" -> "14.6,120.98" (geocoded once). */
  private readonly zoneCenters = new Map<string, string | null>();

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    this.tiles = new MapTilesController(cfg);
  }

  private async here<T>(host: string, path: string, params: Record<string, string>): Promise<T> {
    const key = this.cfg.prospects.hereApiKey;
    if (!key) throw new ApiError(503, { error: 'maps_off', message: 'Address search isn’t set up yet. Type the address yourself.' });
    let res: globalThis.Response;
    try {
      res = await fetch(`https://${host}${path}?${new URLSearchParams({ ...params, apiKey: key })}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    } catch {
      throw new ApiError(502, { error: 'maps_down', message: 'Address search is unavailable right now. Type the address yourself.' });
    }
    if (res.status === 429) throw new ApiError(429, { error: 'rate_limited', message: 'Too many address searches. Wait a moment.' });
    if (!res.ok) throw new ApiError(502, { error: 'maps_down', message: 'Address search is unavailable right now. Type the address yourself.' });
    return (await res.json()) as T;
  }

  /** The center of a time zone's city (America/Toronto -> Toronto), to search places around. */
  private async zoneCenter(tz: string) {
    if (this.zoneCenters.has(tz)) return this.zoneCenters.get(tz)!;
    const city = tz.split('/').pop()?.replace(/_/g, ' ');
    let center: string | null = null;
    if (city && /^[A-Za-z .'-]{2,40}$/.test(city)) {
      const g = await this.here<{ items?: HereItem[] }>('geocode.search.hereapi.com', '/v1/geocode', { q: city, limit: '1', lang: 'en' }).catch(() => ({ items: [] }));
      const p = g.items?.[0]?.position;
      center = p ? `${p.lat.toFixed(4)},${p.lng.toFixed(4)}` : null;
    }
    this.zoneCenters.set(tz, center);
    return center;
  }

  @Get('places/suggest')
  @ClientRoute(ROUTE)
  async suggest(@Query('q') q = '', @Query('at') at?: string, @Query('tz') tz?: string) {
    const text = q.trim().slice(0, 200);
    if (text.length < 3) return { places: [] };
    // Autosuggest finds places (shops, venues, landmarks) and addresses, around a point.
    const near = (at && /^-?\d{1,2}(\.\d+)?,-?\d{1,3}(\.\d+)?$/.test(at) ? at : null) ?? (tz && /^[A-Za-z_]+\/[A-Za-z_/-]+$/.test(tz) ? await this.zoneCenter(tz) : null);
    const data = near
      ? await this.here<{ items?: HereItem[] }>('autosuggest.search.hereapi.com', '/v1/autosuggest', { q: text, at: near, limit: '8', lang: 'en' })
      : await this.here<{ items?: HereItem[] }>('geocode.search.hereapi.com', '/v1/geocode', { q: text, limit: '6', lang: 'en' });
    // Suggestions without a position (e.g. "McDonald's near ...") can't be pinned: skipped.
    return { places: (data.items ?? []).map(toPlace).filter(Boolean).slice(0, 6) };
  }

  @Get('places/reverse')
  @ClientRoute(ROUTE)
  async reverse(@Query('lat') latRaw?: string, @Query('lng') lngRaw?: string) {
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new ApiError(400, { error: 'validation_failed', message: 'That is not a map position.' });
    const data = await this.here<{ items?: HereItem[] }>('revgeocode.search.hereapi.com', '/v1/revgeocode', { at: `${lat},${lng}`, limit: '1', lang: 'en' });
    const item = data.items?.[0];
    return { address: item?.address?.label ?? null };
  }

  @Get('maps/tiles/:z/:x/:y.png')
  @SkipThrottle() // one map view loads 20+ tiles
  @ClientRoute(ROUTE)
  tile(@Param('z') z: string, @Param('x') x: string, @Param('y') y: string, @Req() _req: Request, @Res() res: Response) {
    return this.tiles.tile(z, x, y, res);
  }
}
