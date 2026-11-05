import { site } from '../content/site.js';
import { Section, SectionHeader } from './ui/Section.jsx';
import { CtaButton } from './ui/Button.jsx';

export function HowItWorks() {
  const s = site.steps;
  return (
    <Section id="how" tone="lavender" containerClassName="text-center">
      <SectionHeader title={s.title} subtitle={s.subtitle} center />
      <ol className="mx-auto max-w-[660px] text-left">
        {s.items.map((step, i) => (
          <li key={step.title} className="mb-[26px] flex gap-[18px]">
            <span aria-hidden="true" className="grid size-[38px] flex-none place-items-center rounded-full bg-byte-purple text-[15px] font-bold text-cream-dough">
              {i + 1}
            </span>
            <div>
              <h3>{step.title}</h3>
              <p className="text-[15px] text-muted">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <CtaButton cta={s.cta} variant="primary" className="mobile:w-full" />
    </Section>
  );
}
