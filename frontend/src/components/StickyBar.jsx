import { site } from '../content/site.js';
import { CtaButton } from './ui/Button.jsx';

// Mobile only (720px and below). Bottom padding clears the iPhone home indicator.
export function StickyBar() {
  const { primary, secondary } = site.stickyBar;
  return (
    <div data-surface="dark" className="fixed inset-x-0 bottom-0 z-20 hidden gap-2.5 bg-midnight-plum px-4 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] mobile:flex">
      <CtaButton cta={primary} variant="primary" size="sm" className="flex-1" />
      <CtaButton cta={secondary} variant="light" size="sm" className="flex-1" />
    </div>
  );
}
