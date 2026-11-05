import { site } from '../content/site.js';
import { Section, SectionHeader } from './ui/Section.jsx';
import { CtaStrip, CtaButton } from './ui/Button.jsx';

// Native <details>: keyboard and screen-reader support built in. The same items feed the
// FAQPage JSON-LD (seo-plugin.js).
export function Faq() {
  const f = site.faq;
  return (
    <Section id="faq" tone="cream" containerClassName="max-w-[820px]">
      <SectionHeader title={f.title} subtitle={f.subtitle} center />
      {f.items.map((item) => (
        <details key={item.q} className="group mb-3 rounded-xl border border-line bg-lavender-mist">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-5 py-4 font-semibold [&::-webkit-details-marker]:hidden">
            {item.q}
            <span aria-hidden="true" className="text-xl leading-none text-soft-violet">
              <span className="group-open:hidden">+</span>
              <span className="hidden group-open:inline">{'−'}</span>
            </span>
          </summary>
          <p className="-mt-1 px-5 pb-4 text-[15px] text-muted">{item.a}</p>
        </details>
      ))}
      <CtaStrip text={f.cta.text}>
        <CtaButton cta={f.cta} variant="secondary" />
      </CtaStrip>
    </Section>
  );
}
