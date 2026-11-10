import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchBookings, fetchLeads, fetchSecurity } from '../../store/adminDataSlices.js';

/** Loads the leads page whenever the search, filter or page changes. */
export function useLeads() {
  const dispatch = useDispatch();
  const state = useSelector((s) => s.adminLeads);
  const { q, status, from, page } = state.query;
  useEffect(() => {
    const p = dispatch(fetchLeads({ q, status, from, page }));
    return () => p.abort();
  }, [dispatch, q, status, from, page]);
  return state;
}

export function useBookings(when) {
  const dispatch = useDispatch();
  const state = useSelector((s) => s.adminBookings);
  useEffect(() => {
    const p = dispatch(fetchBookings(when));
    return () => p.abort();
  }, [dispatch, when]);
  return state;
}

export function useSecurity() {
  const dispatch = useDispatch();
  const state = useSelector((s) => s.adminSecurity);
  useEffect(() => {
    const p = dispatch(fetchSecurity());
    return () => p.abort();
  }, [dispatch]);
  return state;
}
