import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { ConfigProvider, Modal } from 'antd';
import { AdminButton } from './ui.jsx';

// The admin app's dialogs: Ant Design's Modal, dressed in the site's brand tokens (index.css) so
// nothing shows Ant Design's default blue. Buttons inside are the admin's own (ui.jsx: AdminButton).
//
//   <Dialog eyebrow title onClose footer>…</Dialog>   a dialog (shown while it is rendered)
//   const confirm = useConfirm();                      "are you sure?" before deleting something
//   if (await confirm({ title, body, action })) …
//
// AdminDialogs (around the whole admin app, AdminApp.jsx) supplies the theme and shows the confirm.

/** A brand color as the page has it now, so a later override of the tokens (dark mode) carries over. */
const brand = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();

/** Ant Design's theme from the brand tokens. It works out its shades in JS, so it needs real values. */
function brandTheme() {
  const token = {
    colorPrimary: brand('byte-purple'),
    colorInfo: brand('soft-violet'),
    colorLink: brand('soft-violet'),
    colorSuccess: brand('circuit-teal'),
    colorWarning: brand('honey-gold'),
    colorError: brand('danger'),
    colorTextBase: brand('midnight-plum'),
    colorBgElevated: brand('cream-dough'),
    colorBorder: brand('line'),
    fontFamily: 'inherit',
  };
  return { token: Object.fromEntries(Object.entries(token).filter(([, value]) => value)) };
}

const DIALOG_STYLES = {
  mask: { background: 'color-mix(in srgb, var(--color-midnight-plum) 45%, transparent)' },
  container: { padding: 0, overflow: 'hidden', border: '1px solid var(--color-line)', borderRadius: 'var(--radius-card)', background: 'var(--color-cream-dough)' },
  header: { margin: 0, padding: 0, background: 'transparent' },
  body: { fontSize: '1rem', lineHeight: 1.7, color: 'var(--color-midnight-plum)' },
  footer: { margin: 0, padding: 0, background: 'transparent' },
};

/**
 * A dialog. It is open for as long as it is rendered; Esc, the ✕ and a click outside call `onClose`.
 * `children` bring their own padding (px-6 …); `footer` is a row of buttons.
 */
export function Dialog({ eyebrow, title, stripe = 'bg-honey-gold', onClose, children, footer, wide = false }) {
  return (
    <Modal
      open
      centered
      width={wide ? 640 : 560}
      onCancel={onClose}
      styles={DIALOG_STYLES}
      title={
        <div className="flex items-start gap-3 border-b border-line py-4 pr-14 pl-6 text-left mobile:pl-5">
          <span className={`mt-1 h-6 w-1 flex-none rounded-full ${stripe}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold tracking-wider text-soft-violet uppercase">{eyebrow}</div>
            <h2 className="mt-0.5 mb-0 text-xl font-bold wrap-break-word">{title}</h2>
          </div>
        </div>
      }
      footer={footer ? <div className="flex flex-wrap items-center gap-3 border-t border-line px-6 py-4 text-left mobile:px-5">{footer}</div> : null}
    >
      {children}
    </Modal>
  );
}

const ConfirmContext = createContext(null);

/**
 * Asks before something is deleted. `confirm({ title, body, action })` resolves to true when the
 * admin presses the `action` button, false on Cancel, Esc, the ✕ or a click outside.
 */
export const useConfirm = () => useContext(ConfirmContext);

export function AdminDialogs({ children }) {
  const theme = useMemo(brandTheme, []);
  const [ask, setAsk] = useState(null); // { title, body, action, resolve }
  const confirm = useCallback((question) => new Promise((resolve) => setAsk({ ...question, resolve })), []);
  const answer = (yes) => {
    ask.resolve(yes);
    setAsk(null);
  };

  return (
    <ConfigProvider theme={theme}>
      <ConfirmContext.Provider value={confirm}>{children}</ConfirmContext.Provider>
      {ask && (
        <Dialog
          eyebrow="Please confirm"
          title={ask.title}
          stripe="bg-danger"
          onClose={() => answer(false)}
          footer={
            <div className="ml-auto flex flex-wrap gap-3">
              {/* Cancel has the focus, so Enter never deletes by accident. */}
              <AdminButton variant="outline" autoFocus onClick={() => answer(false)}>
                Cancel
              </AdminButton>
              <AdminButton variant="dangerSolid" onClick={() => answer(true)}>
                {ask.action ?? 'Delete'}
              </AdminButton>
            </div>
          }
        >
          <p className="px-6 py-5 text-[15px] text-muted mobile:px-5">{ask.body}</p>
        </Dialog>
      )}
    </ConfigProvider>
  );
}
