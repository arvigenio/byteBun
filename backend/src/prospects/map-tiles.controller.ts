// Map tiles for the Prospecting map, served by our API: GET /api/admin/prospects/tiles/:z/:x/:y.png
//
// Why through the API: the admin pages send no Referer (privacy), which the public OpenStreetMap
// tile servers answer with "Access blocked", and a HERE/Geoapify key in the browser could be copied.
// Here the key stays on the server, only signed-in admins can load tiles (AdminSessionGuard),
// and recently used tiles are kept in memory.
import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ApiError } from '../common/api-error';
import { APP_CONFIG, type AppConfig } from '../config/config';

const MAX_TILES = 2000; // ~40 MB at most
const TILE_TTL_MS = 24 * 3_600_000;

@Controller('admin/prospects/tiles')
@SkipThrottle() // one map view loads 20+ tiles; the route is admin-only anyway
export class MapTilesController {
  private readonly cache = new Map<string, { body: Buffer; type: string; expires: number }>();
  private readonly inFlight = new Map<string, Promise<{ body: Buffer; type: string }>>();

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  private upstream(z: number, x: number, y: number): { url: string; headers: Record<string, string> } {
    const here = this.cfg.prospects.hereApiKey;
    if (here) return { url: `https://maps.hereapi.com/v3/base/mc/${z}/${x}/${y}/png?style=explore.day&size=256&apiKey=${encodeURIComponent(here)}`, headers: {} };
    const key = this.cfg.prospects.geoapifyApiKey;
    if (key) return { url: `https://maps.geoapify.com/v1/tile/osm-bright/${z}/${x}/${y}.png?apiKey=${encodeURIComponent(key)}`, headers: {} };
    // OpenStreetMap's tile policy: identify the app. Fine for a few admins; set HERE_API_KEY for more.
    return { url: `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, headers: { 'User-Agent': 'ByteBunAdmin/1.0 (+https://bytebuntech.com)', Referer: this.cfg.booking.siteUrl } };
  }

  private async load(z: number, x: number, y: number) {
    const { url, headers } = this.upstream(z, x, y);
    let res: globalThis.Response;
    try {
      res = await fetch(url, { headers: { Accept: 'image/png,image/*', ...headers }, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new ApiError(502, { error: 'tiles_unavailable', message: 'The map tiles did not load.' });
    }
    if (!res.ok) throw new ApiError(502, { error: 'tiles_unavailable', message: `The map tiles did not load (HTTP ${res.status}).` });
    return { body: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') ?? 'image/png' };
  }

  // GET /api/admin/prospects/tiles/:z/:x/:y.png
  @Get(':z/:x/:y.png')
  async tile(@Param('z') zs: string, @Param('x') xs: string, @Param('y') ys: string, @Res() res: Response) {
    const [z, x, y] = [zs, xs, ys].map((v) => (/^\d{1,7}$/.test(v) ? Number(v) : -1)) as [number, number, number];
    const n = 2 ** z;
    if (z < 0 || z > 20 || x < 0 || y < 0 || x >= n || y >= n) throw new ApiError(404, { error: 'not_found', message: 'No such tile.' });

    const key = `${z}/${x}/${y}`;
    let tile = this.cache.get(key);
    if (!tile || tile.expires < Date.now()) {
      let p = this.inFlight.get(key);
      if (!p) {
        p = this.load(z, x, y).finally(() => this.inFlight.delete(key));
        this.inFlight.set(key, p);
      }
      const loaded = await p;
      tile = { ...loaded, expires: Date.now() + TILE_TTL_MS };
      this.cache.delete(key);
      this.cache.set(key, tile);
      while (this.cache.size > MAX_TILES) this.cache.delete(this.cache.keys().next().value!);
    }
    // Tiles are public map images: the browser may keep them for a day (only for this admin).
    res.status(200).set({ 'Content-Type': tile.type, 'Cache-Control': 'private, max-age=86400' }).send(tile.body);
  }
}
