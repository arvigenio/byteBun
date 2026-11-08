import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { navigate } from '../../lib/router.js';
import { checkSession, startSetup } from '../../store/adminAuthSlice.js';

/** The sign-in page: find the starting step, start QR setup when needed, go in when done. */
export function useSignIn() {
  const dispatch = useDispatch();
  const state = useSelector((s) => s.adminAuth);

  useEffect(() => {
    dispatch(checkSession());
  }, [dispatch]);

  useEffect(() => {
    if (state.step === 'setup' && !state.setup && !state.pending && !state.error) dispatch(startSetup());
  }, [dispatch, state.step, state.setup, state.pending, state.error]);

  useEffect(() => {
    if (state.step === 'done') navigate('/admin/leads', { replace: true });
  }, [state.step]);

  return state;
}
