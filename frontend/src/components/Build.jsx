import { site } from '../content/site.js';
import { Section, SectionHeader, Eyebrow } from './ui/Section.jsx';
import { CtaStrip, CtaButton } from './ui/Button.jsx';
import { CheckDot, Icon } from './ui/Icon.jsx';

// The two core offers (custom websites/web apps and custom automations), right after the hero.
// Each pillar has its own CTA so the lead's `source` shows which offer brought them in.
function Pillar({ pillar }) {
  return (
    <article className="flex flex-col rounded-card border-t-4 border-bun-orange bg-cream-dough p-8 mobile:p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="grid size-[46px] flex-none place-items-center rounded-xl bg-byte-purple text-circuit-teal">
          <Icon name={pillar.icon} />
        </div>
        <Eyebrow className="mb-0!">{pillar.kicker}</Eyebrow>
      </div>
      <h3 className="text-2xl leading-tight mobile:text-xl">{pillar.title}</h3>
      <p className="mt-1 text-[15px] text-muted">{pillar.text}</p>
      <ul className="mt-5 mb-7 text-[15px]">
        {pillar.points.map((p) => (
          <li key={p} className="flex items-start gap-3 py-1.5">
            <CheckDot className="mt-[3px]" />
            {p}
          </li>
        ))}
      </ul>
      <CtaButton cta={pillar.cta} variant="primary" className="mt-auto self-start mobile:w-full" />
    </article>
  );
}

export function Build() {
  const b = site.build;
  return (
    <Section id="build" tone="lavender">
      <SectionHeader eyebrow={b.eyebrow} title={b.title} subtitle={b.subtitle} center />
      <div data-reveal="stagger" className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-6 mobile:gap-4">
        {b.pillars.map((p) => (
          <Pillar key={p.title} pillar={p} />
        ))}
      </div>
      <CtaStrip text={b.cta.text}>
        <CtaButton cta={b.cta} variant="secondary" />
      </CtaStrip>
    </Section>
  );
}
