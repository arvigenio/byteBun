import { site } from '../content/site.js';
import { Section, SectionHeader } from './ui/Section.jsx';
import { Card, CardGrid, Chip } from './ui/Card.jsx';
import { CtaStrip, CtaButton } from './ui/Button.jsx';
import { CheckDot } from './ui/Icon.jsx';

function Plan({ plan }) {
  return (
    <Card className="flex flex-col" border={plan.featured ? 'border-2 border-bun-orange' : undefined}>
      {plan.featured && (
        <div>
          <Chip>{plan.featuredLabel}</Chip>
        </div>
      )}
      <h3>{plan.name}</h3>
      <p className="mt-2 mb-0.5 text-4xl font-bold tracking-[-0.02em]">
        {plan.price}
        <small className="text-sm font-medium tracking-normal text-muted"> {plan.period}</small>
      </p>
      <p className="text-[15px] text-muted">{plan.blurb}</p>
      <ul className="mt-[18px] mb-6 text-[15px]">
        {plan.features.map((f, i) => (
          <li key={f} className={`flex items-start gap-3 py-1.5 ${i === 0 ? 'font-bold' : ''}`}>
            <CheckDot className="mt-[3px]" />
            {f}
          </li>
        ))}
      </ul>
      <CtaButton cta={plan.cta} variant={plan.featured ? 'primary' : 'outline'} className="mt-auto w-full" />
    </Card>
  );
}

export function Packages() {
  const p = site.packages;
  return (
    <Section id="packages" tone="cream">
      <SectionHeader eyebrow={p.eyebrow} title={p.title} subtitle={p.subtitle} />
      <CardGrid>
        {p.plans.map((plan) => (
          <Plan key={plan.name} plan={plan} />
        ))}
      </CardGrid>
      <p className="mt-[22px] text-[13px] text-muted mobile:text-sm">{p.note}</p>
      <div data-reveal className="mt-8 flex flex-wrap items-center justify-between gap-5 rounded-card border border-dashed border-soft-violet bg-lavender-mist p-[26px] mobile:p-5">
        <div className="max-w-[60ch]">
          <h3>{p.custom.title}</h3>
          <p className="text-[15px] text-muted">{p.custom.text}</p>
        </div>
        <CtaButton cta={p.custom.cta} variant="outline" className="mobile:w-full" />
      </div>
      <CtaStrip text={p.cta.text}>
        <CtaButton cta={p.cta} variant="secondary" />
      </CtaStrip>
    </Section>
  );
}
