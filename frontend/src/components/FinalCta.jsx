import { site } from '../content/site.js';
import { Container } from './ui/Container.jsx';
import { Button, CtaButton } from './ui/Button.jsx';

export function FinalCta() {
  const c = site.finalCta;
  // A booking link, when set in site.js, replaces the lead form for this button.
  const primary = site.contact.bookingUrl ? { label: c.primary.label, href: site.contact.bookingUrl } : c.primary;
  return (
    <section id="contact" data-surface="dark" className="bg-byte-purple py-21 text-center mobile:py-14">
      <Container>
        <h2 className="text-cream-dough">{c.title}</h2>
        <p className="mx-auto mb-7 max-w-[52ch] text-[19px] font-semibold text-lavender-mist mobile:text-[17px]">{c.text}</p>
        <div className="flex flex-wrap justify-center gap-3 mobile:flex-col mobile:*:w-full">
          <CtaButton cta={primary} variant="primary" />
          <Button variant="light" href={`mailto:${site.contact.email}`}>
            {c.secondary.label}
          </Button>
        </div>
      </Container>
    </section>
  );
}
