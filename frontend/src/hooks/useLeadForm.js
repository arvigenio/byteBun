import { useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { openLeadForm } from '../store/leadFormSlice.js';

// Any "free audit" / "book a call" / "proposal" button calls useLeadForm().open('source-name').
// The source is saved with the lead, so we can see which button people used.
export function useLeadForm() {
  const dispatch = useDispatch();
  const open = useCallback((from = 'website') => dispatch(openLeadForm(from)), [dispatch]);
  return { open };
}
