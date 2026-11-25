import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { useLazyPlacesReverseQuery, useLazyPlacesSuggestQuery } from '../api.js';
import { Field, Icon, ICONS, Input, Spinner } from '../ui.jsx';

// An event's location: type the address and pick a suggestion (HERE, through our API), then
// fine-tune the pin on the map (drag it, or click the map). The exact pin (lat/lng) is saved with
// the address, for "Open in Google Maps" on the event page and in emails. Loaded on demand (Leaflet).
//
//   <LocationPicker address lat lng timeZone onChange={({ address, latitude, longitude }) => …} error />
//
// Places (shops, venues) are searched around a point: the pin, else this device's location (if
// allowed), else the city of the event's time zone.

const pin = L.divIcon({
  className: '',
  html: '<div style="width:34px;height:34px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:var(--color-brand,#2563EB);border:3px solid #fff;box-shadow:0 3px 8px rgba(0,0,0,.35)"><div style="width:10px;height:10px;margin:9px;border-radius:50%;background:#fff"></div></div>',
  iconSize: [34, 34],
  iconAnchor: [17, 34],
});

/** Moves the map when the pin moves (from a suggestion), not while dragging. */
function Follow({ to, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (to) map.setView(to, Math.max(map.getZoom(), zoom), { animate: true });
  }, [to?.[0], to?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function ClickToPlace({ onPlace }) {
  useMapEvents({ click: (e) => onPlace(e.latlng.lat, e.latlng.lng) });
  return null;
}

const round = (n) => Math.round(n * 1e6) / 1e6;

/** This device's position, asked once (when the address field is first used). */
let here = null;
let asked = false;
function askWhereWeAre() {
  if (asked || !navigator.geolocation) return;
  asked = true;
  navigator.geolocation.getCurrentPosition(
    (p) => {
      here = `${p.coords.latitude.toFixed(4)},${p.coords.longitude.toFixed(4)}`;
    },
    () => {},
    { enableHighAccuracy: false, maximumAge: 3_600_000, timeout: 8000 },
  );
}

export default function LocationPicker({ address, lat, lng, timeZone, onChange, error }) {
  const [suggest, suggestState] = useLazyPlacesSuggestQuery();
  const [reverse, reverseState] = useLazyPlacesReverseQuery();
  const [text, setText] = useState(address ?? '');
  const [open, setOpen] = useState(false);
  const [places, setPlaces] = useState([]);
  const [active, setActive] = useState(-1);
  const [problem, setProblem] = useState('');
  const [pinAddress, setPinAddress] = useState(null); // the address at a dragged pin, to offer
  const timer = useRef(null);
  const box = useRef(null);
  const has = lat !== null && lat !== undefined && lng !== null && lng !== undefined;
  const position = has ? [lat, lng] : null;

  useEffect(() => setText(address ?? ''), [address]);
  useEffect(() => {
    const close = (e) => !box.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const type = (v) => {
    setText(v);
    onChange({ address: v, latitude: lat ?? null, longitude: lng ?? null });
    setActive(-1);
    clearTimeout(timer.current);
    if (v.trim().length < 3) {
      setPlaces([]);
      return;
    }
    timer.current = setTimeout(async () => {
      const r = await suggest({ q: v.trim(), at: has ? `${round(lat)},${round(lng)}` : (here ?? undefined), tz: timeZone });
      if (r.error) {
        setProblem(r.error.message);
        setPlaces([]);
        return;
      }
      setProblem('');
      setPlaces(r.data.places);
      setOpen(true);
    }, 350);
  };

  const choose = (p) => {
    setText(p.address);
    setOpen(false);
    setPlaces([]);
    setPinAddress(null);
    onChange({ address: p.address, latitude: round(p.lat), longitude: round(p.lng) });
  };

  const movePin = async (la, ln) => {
    onChange({ address: text, latitude: round(la), longitude: round(ln) });
    const r = await reverse({ lat: round(la), lng: round(ln) });
    setPinAddress(r.data?.address && r.data.address !== text ? r.data.address : null);
  };

  return (
    <div className="flex flex-col gap-3">
      <div ref={box} className="relative">
        <Field label="Address" hint="Type a place or street (e.g. a shop’s name and the area) and pick it from the list. Then drag the pin to the exact spot if needed." error={error || problem || undefined}>
          {(a) => (
            <div className="relative">
              <Icon d={ICONS.pin} className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
              <Input
                {...a}
                value={text}
                maxLength={300}
                autoComplete="off"
                className="pr-9 pl-9"
                placeholder="Street, building or venue"
                role="combobox"
                aria-expanded={open && places.length > 0}
                aria-autocomplete="list"
                onFocus={() => {
                  askWhereWeAre();
                  if (places.length) setOpen(true);
                }}
                onChange={(e) => type(e.target.value)}
                onKeyDown={(e) => {
                  if (!open || !places.length) return;
                  if (e.key === 'ArrowDown') (e.preventDefault(), setActive((i) => Math.min(places.length - 1, i + 1)));
                  else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((i) => Math.max(0, i - 1)));
                  else if (e.key === 'Enter' && active >= 0) (e.preventDefault(), choose(places[active]));
                  else if (e.key === 'Escape') setOpen(false);
                }}
              />
              {suggestState.isFetching && <Spinner className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-faint" />}
            </div>
          )}
        </Field>
        {open && places.length > 0 && (
          <ul className="absolute inset-x-0 z-[1000] mt-1 max-h-72 overflow-auto rounded-xl border border-line bg-surface p-1 shadow-lg" role="listbox">
            {places.map((p, i) => (
              <li key={`${p.lat},${p.lng},${i}`} role="option" aria-selected={i === active}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(p)} onMouseEnter={() => setActive(i)} className={`flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2 text-left ${i === active ? 'bg-brand-soft' : 'hover:bg-sunken'}`}>
                  <Icon d={ICONS.pin} className="mt-0.5 size-4 shrink-0 text-brand" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">{p.label}</span>
                    {p.address !== p.label && <span className="block truncate text-xs text-muted">{p.address}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-line">
        <MapContainer center={position ?? [20, 0]} zoom={position ? 16 : 2} scrollWheelZoom={false} className="h-64 w-full" attributionControl>
          <TileLayer url="/api/client/maps/tiles/{z}/{x}/{y}.png" maxZoom={19} attribution="Map data © HERE, OpenStreetMap contributors" />
          <Follow to={position} zoom={15} />
          <ClickToPlace onPlace={movePin} />
          {position && <Marker position={position} icon={pin} draggable eventHandlers={{ dragend: (e) => movePin(e.target.getLatLng().lat, e.target.getLatLng().lng) }} />}
        </MapContainer>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-sunken/50 px-3 py-2 text-xs">
          {position ? (
            <span className="text-muted">
              Pin: <span className="font-mono">{lat.toFixed(5)}, {lng.toFixed(5)}</span> · drag it, or click the map, to move it
            </span>
          ) : (
            <span className="text-muted">Pick an address above, or click the map to drop the pin.</span>
          )}
          {position && (
            <button type="button" onClick={() => (onChange({ address: text, latitude: null, longitude: null }), setPinAddress(null))} className="cursor-pointer font-medium text-muted underline hover:text-danger">
              Remove pin
            </button>
          )}
        </div>
      </div>

      {pinAddress && (
        <div className="flex flex-wrap items-center gap-2 rounded-btn bg-brand-soft px-3 py-2 text-sm">
          {reverseState.isFetching ? <Spinner className="size-4" /> : <Icon d={ICONS.pin} className="size-4 text-brand" />}
          <span className="min-w-0 flex-1 truncate">
            At the pin: <strong>{pinAddress}</strong>
          </span>
          <button
            type="button"
            onClick={() => {
              setText(pinAddress);
              onChange({ address: pinAddress, latitude: lat, longitude: lng });
              setPinAddress(null);
            }}
            className="cursor-pointer font-semibold text-brand underline"
          >
            Use this address
          </button>
        </div>
      )}
    </div>
  );
}
