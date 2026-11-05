import { site } from '../content/site.js';
import { Logo } from './Logo.jsx';
import { Container } from './ui/Container.jsx';
import { CtaButton } from './ui/Button.jsx';

export function Header() {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-lavender-mist">
      <Container className="flex h-17 items-center justify-between gap-4 mobile:h-14">
        <a href="#top" aria-label="Byte Bun Tech, back to top" className="flex min-h-11 flex-none items-center">
          <Logo className="h-7 w-auto mobile:h-6" />
        </a>
        <nav aria-label="Main" className="flex items-center gap-[26px] text-sm font-medium text-muted">
          {site.nav.map((item) => (
            <a key={item.href} href={item.href} className="hover:text-soft-violet mobile:hidden">
              {item.label}
            </a>
          ))}
          <CtaButton cta={site.headerCta} variant="secondary" className="mobile:px-4 mobile:py-2 mobile:text-sm" />
        </nav>
      </Container>
    </header>
  );
}
