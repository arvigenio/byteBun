import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import * as adminApi from '../api/admin.js';

// The Prospecting page: one search at a time (industry + location), ranked by the chance of
// signing up. Nothing is saved; website checkups finish in the background and arrive live
// (hooks/admin/useAdminRealtime.js -> prospectUpdated).
const fail = (err) => ({ message: err.message, status: err.status, fields: err.fields ?? {} });
const thunk = (type, fn, options) =>
  createAsyncThunk(
    type,
    async (arg, api) => {
      try {
        return await fn(arg, api);
      } catch (err) {
        return api.rejectWithValue(fail(err));
      }
    },
    options,
  );

export const fetchProspectMeta = thunk('adminProspects/meta', (_, { signal }) => adminApi.getProspectMeta({ signal }), {
  condition: (_, { getState }) => !getState().adminProspects.meta,
});
/** { industry, location, refresh? } */
export const searchProspects = thunk('adminProspects/search', (query, { signal }) => adminApi.searchProspects(query, { signal }));
export const recheckWebsite = thunk('adminProspects/recheck', ({ searchId, itemId }) => adminApi.recheckProspectWebsite(searchId, itemId));

// Same order as the server: best chance first, then the busier business, then by name.
const byChance = (a, b) => b.score - a.score || (b.reviewCount ?? -1) - (a.reviewCount ?? -1) || a.name.localeCompare(b.name);

function rerank(s) {
  s.items.sort(byChance);
  s.items.forEach((p, i) => {
    p.rank = i + 1;
  });
  const tiers = { hot: 0, warm: 0, cold: 0 };
  for (const p of s.items) tiers[p.tier]++;
  if (s.search) s.search.tiers = tiers;
}

const prospects = createSlice({
  name: 'adminProspects',
  initialState: {
    meta: null,
    query: { industry: '', location: '' },
    search: null,
    items: [],
    reused: false,
    status: 'idle', // idle | loading | ready | error
    error: '',
    fieldErrors: {},
    // How the list is shown (the rank number is always the chance of signing up).
    sort: 'chance', // chance | rating | reviews | name
    tiers: { hot: true, warm: true, cold: true },
    noWebsiteOnly: false,
    selectedId: null,
    rechecking: null,
  },
  reducers: {
    sortChanged(s, { payload }) {
      s.sort = payload;
    },
    tierToggled(s, { payload }) {
      s.tiers[payload] = !s.tiers[payload];
    },
    noWebsiteOnlyToggled(s) {
      s.noWebsiteOnly = !s.noWebsiteOnly;
    },
    prospectSelected(s, { payload }) {
      s.selectedId = payload;
    },
    /** Live: a website checkup finished on the server (payload: { searchId, item }). */
    prospectUpdated(s, { payload }) {
      if (s.search?.id !== payload.searchId) return;
      const i = s.items.findIndex((p) => p.id === payload.item.id);
      if (i < 0) return;
      s.items[i] = { ...payload.item, rank: s.items[i].rank };
      rerank(s);
    },
  },
  extraReducers: (b) =>
    b
      .addCase(fetchProspectMeta.fulfilled, (s, { payload }) => {
        s.meta = payload;
      })
      .addCase(searchProspects.pending, (s, { meta }) => {
        s.status = 'loading';
        s.error = '';
        s.fieldErrors = {};
        s.query = { industry: meta.arg.industry, location: meta.arg.location };
      })
      .addCase(searchProspects.fulfilled, (s, { payload }) => {
        s.status = 'ready';
        s.search = payload.search;
        s.items = payload.items;
        s.reused = payload.reused;
        s.selectedId = null;
      })
      .addCase(searchProspects.rejected, (s, { payload, meta }) => {
        if (meta.aborted) return;
        s.status = 'error';
        s.error = payload?.message ?? 'The search failed. Please try again.';
        s.fieldErrors = payload?.fields ?? {};
      })
      .addCase(recheckWebsite.pending, (s, { meta }) => {
        s.rechecking = meta.arg.itemId;
      })
      .addCase(recheckWebsite.fulfilled, (s, { payload }) => {
        s.rechecking = null;
        if (s.search?.id !== payload.search.id) return;
        s.search = payload.search;
        s.items = payload.items;
      })
      .addCase(recheckWebsite.rejected, (s) => {
        s.rechecking = null;
      }),
});

export const { sortChanged, tierToggled, noWebsiteOnlyToggled, prospectSelected, prospectUpdated } = prospects.actions;
export default prospects.reducer;

const SORTS = {
  chance: byChance,
  rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (b.reviewCount ?? -1) - (a.reviewCount ?? -1),
  reviews: (a, b) => (b.reviewCount ?? -1) - (a.reviewCount ?? -1) || byChance(a, b),
  name: (a, b) => a.name.localeCompare(b.name),
};

/** The list as shown: filtered by tier / "no website", in the chosen order. */
export function selectVisibleProspects(state) {
  const { items, tiers, noWebsiteOnly, sort } = state.adminProspects;
  return items.filter((p) => tiers[p.tier] && (!noWebsiteOnly || p.websiteKind !== 'site')).sort(SORTS[sort] ?? byChance);
}
