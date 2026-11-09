import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import * as adminApi from '../api/admin.js';

// Saved prospects and their groups (Prospecting -> Saved). Search results are saved from the
// Search tab (adminProspectsSlice marks them); other admins' changes arrive live
// (hooks/admin/useAdminRealtime.js -> refreshSavedProspects).
//
// Action types start with "adminProspects/" so a 401 signs out like the rest (store/adminStore.js).
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

export const fetchProspectGroups = thunk('adminProspects/saved/groups', (_, { signal }) => adminApi.listProspectGroups({ signal }));
/** group: 'all' | 'none' | group id (defaults to the one being shown). */
export const fetchSavedProspects = thunk('adminProspects/saved/list', async (group, { getState, signal }) => {
  const shown = group ?? getState().adminSavedProspects.group;
  return { ...(await adminApi.listSavedProspects(shown, { signal })), group: shown };
});
export const createProspectGroup = thunk('adminProspects/saved/createGroup', (name) => adminApi.createProspectGroup(name));
export const renameProspectGroup = thunk('adminProspects/saved/renameGroup', ({ id, name }) => adminApi.renameProspectGroup(id, name));
export const deleteProspectGroup = thunk('adminProspects/saved/deleteGroup', (id) => adminApi.deleteProspectGroup(id));
/** { searchId, itemIds, groupId? } (from the Search tab). */
export const saveProspects = thunk('adminProspects/saved/save', (arg) => adminApi.saveProspects(arg));
/** { id, groupId?, note? } */
export const updateSavedProspect = thunk('adminProspects/saved/update', ({ id, ...fields }) => adminApi.updateSavedProspect(id, fields));
/** { id } (the saved prospect's id). */
export const removeSavedProspect = thunk('adminProspects/saved/remove', async ({ id }) => {
  await adminApi.removeSavedProspect(id);
  return { id };
});

/** After any change (here or by another admin): reload what has been loaded. */
export const refreshSavedProspects = () => (dispatch, getState) => {
  const s = getState().adminSavedProspects;
  if (s.groupsLoaded) dispatch(fetchProspectGroups());
  if (s.status !== 'idle') dispatch(fetchSavedProspects());
};

const saved = createSlice({
  name: 'adminSavedProspects',
  initialState: {
    groups: [],
    total: 0,
    ungrouped: 0,
    groupsLoaded: false,
    group: 'all', // all | none | group id
    items: [],
    status: 'idle', // idle | loading | ready | error
    error: '',
    selectedId: null,
    busyId: null, // a saved prospect being moved / removed / noted
  },
  reducers: {
    savedGroupShown(s, { payload }) {
      s.group = payload;
      s.selectedId = null;
    },
    savedProspectSelected(s, { payload }) {
      s.selectedId = payload;
    },
  },
  extraReducers: (b) => {
    const groupsIn = (s, { payload }) => {
      s.groups = payload.groups;
      s.total = payload.total;
      s.ungrouped = payload.ungrouped;
      s.groupsLoaded = true;
      // The group shown was deleted (here or by another admin).
      if (typeof s.group === 'number' && !payload.groups.some((g) => g.id === s.group)) s.group = 'all';
    };
    const busy = (s, { meta }) => {
      s.busyId = meta.arg.id;
    };
    const idle = (s) => {
      s.busyId = null;
    };
    b.addCase(fetchProspectGroups.fulfilled, groupsIn)
      .addCase(renameProspectGroup.fulfilled, groupsIn)
      .addCase(deleteProspectGroup.fulfilled, groupsIn)
      .addCase(createProspectGroup.fulfilled, (s, { payload }) => {
        s.groups = [...s.groups, payload].sort((a, z) => a.name.localeCompare(z.name));
      })
      .addCase(fetchSavedProspects.pending, (s) => {
        if (!s.items.length) s.status = 'loading';
        s.error = '';
      })
      .addCase(fetchSavedProspects.fulfilled, (s, { payload }) => {
        if (payload.group !== s.group) return; // an answer for a group no longer shown
        s.status = 'ready';
        s.items = payload.items;
      })
      .addCase(fetchSavedProspects.rejected, (s, { payload, meta }) => {
        if (meta.aborted) return;
        s.status = 'error';
        s.error = payload?.message ?? 'Saved prospects did not load. Please try again.';
      })
      .addCase(updateSavedProspect.pending, busy)
      .addCase(updateSavedProspect.rejected, idle)
      .addCase(updateSavedProspect.fulfilled, (s, { payload }) => {
        s.busyId = null;
        const i = s.items.findIndex((p) => p.id === payload.id);
        if (i < 0) return;
        // Moved out of the group being shown: it leaves this list.
        const stays = s.group === 'all' || (s.group === 'none' ? payload.groupId === null : payload.groupId === s.group);
        if (stays) s.items[i] = payload;
        else s.items.splice(i, 1);
      })
      .addCase(removeSavedProspect.pending, busy)
      .addCase(removeSavedProspect.rejected, idle)
      .addCase(removeSavedProspect.fulfilled, (s, { payload }) => {
        s.busyId = null;
        s.items = s.items.filter((p) => p.id !== payload.id);
        if (s.selectedId === payload.id) s.selectedId = null;
      });
  },
});

export const { savedGroupShown, savedProspectSelected } = saved.actions;
export default saved.reducer;
