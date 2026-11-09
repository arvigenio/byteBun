import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';

// The Prospecting map (Leaflet + OpenStreetMap tiles). Loaded only when the Prospecting page
// opens, so the rest of the admin app stays small. Each pin shows the business's rank and is
// colored by its chance of signing up.

export const TIER_COLORS = {
  hot: { bg: '#FFA612', text: '#1A0A33', label: 'Hot' },
  warm: { bg: '#6B4FBF', text: '#FFF8EC', label: 'Warm' },
  cold: { bg: '#A79BC0', text: '#1A0A33', label: 'Cold' },
};

const iconCache = new Map();
function pinIcon(rank, tier, selected) {
  const key = `${rank}|${tier}|${selected}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const c = TIER_COLORS[tier] ?? TIER_COLORS.cold;
  const size = selected ? 38 : 30;
  const html = `<div style="width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${c.bg};border:${selected ? 3 : 2}px solid ${selected ? '#1A0A33' : '#FFF8EC'};box-shadow:0 2px 6px rgb(26 10 51/.35);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);font:700 ${selected ? 13 : 12}px/1 'Plus Jakarta Sans',system-ui,sans-serif;color:${c.text}">${Number(rank)}</span></div>`;
  const icon = L.divIcon({ html, className: '', iconSize: [size, size], iconAnchor: [size / 2, size], popupAnchor: [0, -size] });
  iconCache.set(key, icon);
  return icon;
}

// Fits the map to the pins whenever a new search loads.
function FitToResults({ searchId, points }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView(points[0], 15);
    else map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 15 });
    // Only on a new search, not on every live update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, searchId]);
  return null;
}

// Pans to the business picked in the list.
function FlyToSelected({ selected }) {
  const map = useMap();
  useEffect(() => {
    if (selected) map.flyTo([selected.lat, selected.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [map, selected]);
  return null;
}

// Credit for whoever draws the tiles (the API picks: HERE, Geoapify or OpenStreetMap).
const OSM_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ATTRIBUTION = {
  here: '&copy; <a href="https://legal.here.com/en-gb/terms">HERE</a>',
  geoapify: `${OSM_CREDIT} · <a href="https://www.geoapify.com/">Geoapify</a>`,
  osm: OSM_CREDIT,
};

export default function ProspectMap({ tiles = 'osm', searchId, items, selectedId, onSelect }) {
  const points = useMemo(() => items.map((p) => [p.lat, p.lng]), [items]);
  const selected = items.find((p) => p.id === selectedId) ?? null;
  // Selected and best-ranked pins are drawn on top.
  const ordered = useMemo(() => [...items].sort((a, b) => (a.id === selectedId) - (b.id === selectedId) || b.rank - a.rank), [items, selectedId]);

  return (
    <MapContainer center={[14.5995, 120.9842]} zoom={11} scrollWheelZoom className="size-full" attributionControl>
      {/* Tiles come through our API (backend/src/prospects/map-tiles.controller.ts): admin-only, key kept on the server. */}
      <TileLayer key={tiles} url="/api/admin/prospects/tiles/{z}/{x}/{y}.png" maxZoom={19} attribution={ATTRIBUTION[tiles] ?? OSM_CREDIT} />
      <FitToResults searchId={searchId} points={points} />
      <FlyToSelected selected={selected} />
      {ordered.map((p) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lng]}
          icon={pinIcon(p.rank, p.tier, p.id === selectedId)}
          zIndexOffset={p.id === selectedId ? 1000 : -p.rank}
          eventHandlers={{ click: () => onSelect(p.id) }}
          title={`#${p.rank} ${p.name}`}
        >
          <Popup>
            <div className="min-w-48 font-sans">
              <div className="text-[13px] font-bold text-midnight-plum">
                #{p.rank} {p.name}
              </div>
              <div className="mb-1 text-xs text-muted">{p.category}</div>
              <div className="text-xs font-semibold" style={{ color: p.tier === 'cold' ? '#4A3B63' : TIER_COLORS[p.tier].bg }}>
                {TIER_COLORS[p.tier].label} chance · {p.score}/100
              </div>
              {p.reasons[0] && <div className="mt-1 text-xs text-midnight-plum">{p.reasons[0].label}</div>}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
