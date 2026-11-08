import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import * as authApi from '../api/adminAuth.js';

// The sign-in page (served at the secret LOGIN_PATH). Steps:
//   checking -> email -> code -> authenticator ─────────────────────────────> done
//                             └> setup (QR) -> backupCodes (shown once) ──> done
// Backup codes live only in memory here and are dropped as soon as the admin continues.
export const RESEND_SECONDS = 60;

const initialState = {
  step: 'checking',
  email: '',
  pending: false,
  error: '',
  resendAt: 0, // ms timestamp when "Resend code" unlocks
  useBackupCode: false,
  setup: null, // { totpURI, secret }
  backupCodes: [],
};

const fail = (err) => ({ message: err.message, status: err.status });
const thunk = (name, fn) =>
  createAsyncThunk(`adminAuth/${name}`, async (arg, api) => {
    try {
      return await fn(arg, api);
    } catch (err) {
      return api.rejectWithValue(fail(err));
    }
  });

/** Where to start: already signed in? half way through first-time setup? */
export const checkSession = thunk('checkSession', async () => {
  const data = await authApi.getSession();
  if (!data?.session) return { step: 'email' };
  if (data.session.secondFactorVerified && data.user.twoFactorEnabled) return { step: 'done' };
  if (!data.user.twoFactorEnabled) return { step: 'setup', email: data.user.email };
  return { step: 'email' };
});

export const sendCode = thunk('sendCode', async (email) => {
  await authApi.sendSignInCode(email);
  return { email };
});

export const resendCode = thunk('resendCode', async (_, { getState }) => {
  await authApi.sendSignInCode(getState().adminAuth.email);
});

export const submitEmailCode = thunk('submitEmailCode', async (otp, { getState }) => {
  const { next } = await authApi.verifyEmailCode(getState().adminAuth.email, otp);
  return { next };
});

export const startSetup = thunk('startSetup', async () => {
  const { totpURI, backupCodes } = await authApi.startAuthenticatorSetup();
  const secret = new URL(totpURI).searchParams.get('secret') ?? '';
  return { totpURI, secret, backupCodes };
});

export const confirmSetup = thunk('confirmSetup', async (code) => {
  await authApi.verifyAuthenticatorCode(code);
});

export const submitSecondFactor = thunk('submitSecondFactor', async (code, { getState }) => {
  if (getState().adminAuth.useBackupCode) await authApi.verifyBackupCode(code);
  else await authApi.verifyAuthenticatorCode(code);
});

const slice = createSlice({
  name: 'adminAuth',
  initialState,
  reducers: {
    toggleBackupCode(state) {
      state.useBackupCode = !state.useBackupCode;
      state.error = '';
    },
    backupCodesSaved(state) {
      state.backupCodes = [];
      state.setup = null;
      state.step = 'done';
    },
    startOver() {
      return { ...initialState, step: 'email' };
    },
  },
  extraReducers: (b) => {
    const pending = (state) => {
      state.pending = true;
      state.error = '';
    };
    const rejected = (state, action) => {
      state.pending = false;
      state.error = action.payload?.message || 'Something went wrong. Please try again.';
    };
    for (const t of [checkSession, sendCode, resendCode, submitEmailCode, startSetup, confirmSetup, submitSecondFactor]) {
      b.addCase(t.pending, pending);
      // checkSession has its own rejected handler below (no error shown, just start at the email step).
      if (t !== checkSession) b.addCase(t.rejected, rejected);
    }
    b.addCase(checkSession.fulfilled, (state, { payload }) => {
      state.pending = false;
      state.step = payload.step;
      if (payload.email) state.email = payload.email;
    })
      .addCase(checkSession.rejected, (state) => {
        state.pending = false;
        state.step = 'email';
        state.error = '';
      })
      .addCase(sendCode.fulfilled, (state, { payload }) => {
        state.pending = false;
        state.email = payload.email;
        state.step = 'code';
        state.resendAt = Date.now() + RESEND_SECONDS * 1000;
      })
      .addCase(resendCode.fulfilled, (state) => {
        state.pending = false;
        state.resendAt = Date.now() + RESEND_SECONDS * 1000;
      })
      .addCase(submitEmailCode.fulfilled, (state, { payload }) => {
        state.pending = false;
        state.step = payload.next === 'setup' ? 'setup' : 'authenticator';
      })
      .addCase(startSetup.fulfilled, (state, { payload }) => {
        state.pending = false;
        state.setup = { totpURI: payload.totpURI, secret: payload.secret };
        state.backupCodes = payload.backupCodes;
      })
      .addCase(confirmSetup.fulfilled, (state) => {
        state.pending = false;
        state.step = 'backupCodes';
      })
      .addCase(submitSecondFactor.fulfilled, (state) => {
        state.pending = false;
        state.step = 'done';
      });
  },
});

export const { toggleBackupCode, backupCodesSaved, startOver } = slice.actions;
export default slice.reducer;
