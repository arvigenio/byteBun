import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchProspectMeta, selectVisibleProspects } from '../../store/adminProspectsSlice.js';

/** The Prospecting page's state; loads the data-source info once. */
export function useProspects() {
  const dispatch = useDispatch();
  const state = useSelector((s) => s.adminProspects);
  const visible = useSelector(selectVisibleProspects);
  useEffect(() => {
    dispatch(fetchProspectMeta());
  }, [dispatch]);
  return { ...state, visible };
}

// Spreadsheet apps run cells that start with = + - @ as formulas; prefix them so they stay text.
const csvCell = (v) => {
  let s = v == null ? '' : Array.isArray(v) ? v.join('; ') : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Downloads the results shown as a CSV (made in the browser; nothing is stored on the server). */
export function downloadProspectsCsv(search, items) {
  const header = ['rank', 'chance_score', 'chance', 'name', 'category', 'email', 'phone', 'website', 'facebook', 'instagram', 'other_social', 'address', 'rating', 'reviews', 'why', 'pitch', 'map_link'];
  const social = (p, n) => p.socials.find((x) => x.network === n)?.url ?? '';
  const rows = items.map((p) =>
    [
      p.rank,
      p.score,
      p.tier,
      p.name,
      p.category,
      p.email,
      p.phone,
      p.website,
      social(p, 'facebook'),
      social(p, 'instagram'),
      p.socials.filter((x) => x.network !== 'facebook' && x.network !== 'instagram').map((x) => x.url),
      p.address,
      p.rating,
      p.reviewCount,
      p.reasons.map((r) => r.label),
      p.pitch,
      p.mapsUrl,
    ]
      .map(csvCell)
      .join(','),
  );
  const csv = `﻿${[header.join(','), ...rows].join('\r\n')}\r\n`;
  const slug = `${search.industry}-${search.location}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `bytebun-prospects-${slug || 'results'}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
