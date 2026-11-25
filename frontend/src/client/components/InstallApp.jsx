import { useEffect, useState } from 'react';
import { Icon } from '../ui.jsx';

// "Install app" for the installable client apps (Bookings, Client Portal, Scanner).
// Chrome, Edge and Android: the browser's own install prompt, kept by /client/boot.js.
// iPhone and iPad (no install prompt): a tip to use Share > Add to Home Screen.
// Hidden once the app runs installed, and on pages boot.js didn't make installable.
const DOWNLOAD = 'M12 4v11m0 0l-4-4m4 4l4-4M5 20h14';

const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function InstallApp({ dark = false, className = '' }) {
  const [promptEvent, setPromptEvent] = useState(() => window.__bbInstallPrompt ?? null);
  const [tip, setTip] = useState(false);

  useEffect(() => {
    const update = () => setPromptEvent(window.__bbInstallPrompt ?? null);
    window.addEventListener('bb-installable', update);
    return () => window.removeEventListener('bb-installable', update);
  }, []);

  if (!window.__bbInstallable || standalone()) return null;
  const iosTip = !promptEvent && ios();
  if (!promptEvent && !iosTip) return null;

  const install = async () => {
    if (iosTip) return setTip((v) => !v);
    promptEvent.prompt();
    await promptEvent.userChoice.catch(() => null);
    window.__bbInstallPrompt = null;
    setPromptEvent(null);
  };

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={install}
        className={`flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm font-semibold transition ${dark ? 'bg-white/10 text-white hover:bg-white/20' : 'text-muted hover:bg-sunken hover:text-ink'}`}
      >
        <Icon d={DOWNLOAD} className="size-4" />
        Install app
      </button>
      {tip && (
        <span role="status" className={`absolute top-full right-0 z-30 mt-2 w-60 rounded-xl border p-3 text-left text-xs leading-snug shadow-lg ${dark ? 'border-white/15 bg-[#151821] text-white/85' : 'border-line bg-surface text-ink'}`}>
          Tap the Share button in Safari, then <b>Add to Home Screen</b>.
        </span>
      )}
    </span>
  );
}
