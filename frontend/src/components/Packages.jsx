import { useState } from 'react';
import { site } from '../content/site.js';
import { Section, SectionHeader } from './ui/Section.jsx';
import { Card, Chip } from './ui/Card.jsx';
import { Button, CtaButton, CtaStrip } from './ui/Button.jsx';
import { CheckDot } from './ui/Icon.jsx';

// Pricing (USD): four plans with a monthly / yearly toggle, then add-ons and footnotes. All copy
// and prices come from site.packages; plans marked `onSite: false` (Free, Bookings Pro) are not
// shown here. Premium and Growth book a free consultation.
function PlanCta({ cta, featured }) {
  const variant = featured ? 'primary' : 'outline';
  if (cta.href) {
    return (
      <Button variant={variant} href={cta.href} target={cta.newTab ? '_blank' : '_self'} rel={cta.newTab ? 'noopener noreferrer' : undefined} className="mt-auto w-full">
        {cta.label}
      </Button>
    );
  }
  return <CtaButton cta={cta} variant={variant} className="mt-auto w-full" />;
}

function Plan({ plan, yearly, includedTitle, yearlyNote }) {
  const free = plan.price.monthly === '$0';
  return (
    <Card className="flex flex-col" border={plan.featured ? 'border-2 border-bun-orange' : undefined}>
      <div className="min-h-7">{plan.featured && <Chip>{plan.featuredLabel}</Chip>}</div>
      <h3>{plan.name}</h3>
      <p className="mt-2 mb-0.5 text-4xl font-bold tracking-[-0.02em]">
        {yearly ? plan.price.yearly : plan.price.monthly}
        <small className="text-sm font-medium tracking-normal text-muted"> {yearly && !free ? '/year' : '/month'}</small>
      </p>
      <p className="min-h-5 text-[13px] font-semibold text-soft-violet">{yearly && !free ? yearlyNote : ''}</p>
      <p className="mt-1 text-[15px] text-muted">{plan.blurb}</p>
      <ul className="mt-[18px] mb-5 text-[15px]">
        {plan.features.map((f) => (
          <li key={f} className={`flex items-start gap-3 py-1.5 ${f.endsWith(':') ? 'font-bold' : ''}`}>
            <CheckDot className="mt-[3px] shrink-0" />
            {f}
          </li>
        ))}
      </ul>
      {plan.included && (
        <div className="mb-6 rounded-btn bg-cream-dough/70 p-4 text-[14px]">
          <p className="mb-1.5 text-xs font-bold tracking-[0.08em] text-byte-purple uppercase">{includedTitle}</p>
          <ul>
            {plan.included.map((x) => (
              <li key={x} className="py-0.5">
                • {x}
              </li>
            ))}
          </ul>
        </div>
      )}
      <PlanCta cta={plan.cta} featured={plan.featured} />
    </Card>
  );
}

function BillingToggle({ yearly, setYearly, billing }) {
  const btn = (on, label, extra) => (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={() => setYearly(label === billing.yearly)}
      className={`cursor-pointer rounded-full px-4 py-2 text-sm font-semibold transition ${on ? 'bg-byte-purple text-cream-dough' : 'text-byte-purple hover:bg-lavender-mist'}`}
    >
      {label}
      {extra && <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${on ? 'bg-bun-orange text-midnight-plum' : 'bg-gold-tint text-midnight-plum'}`}>{extra}</span>}
    </button>
  );
  return (
    <div className="mb-8 flex justify-center">
      <div role="radiogroup" aria-label="Billing period" className="inline-flex gap-1 rounded-full border border-line bg-cream-dough p-1">
        {btn(!yearly, billing.monthly)}
        {btn(yearly, billing.yearly, billing.yearlyNote)}
      </div>
    </div>
  );
}

function AddOns({ addOns }) {
  const row = (i) => (
    <li key={i.name} className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-0">
      <span>{i.name}</span>
      <span className="shrink-0 font-semibold text-byte-purple">{i.price}</span>
    </li>
  );
  return (
    <div data-reveal className="mt-12 grid gap-5 desktop:grid-cols-[3fr_2fr]">
      <Card>
        <h3>{addOns.title}</h3>
        <p className="text-[15px] text-muted">{addOns.subtitle}</p>
        <ul className="mt-3 text-[15px]">
          {addOns.items.map(row)}
          <li className="flex flex-wrap items-center justify-between gap-3 pt-3">
            <span>
              {addOns.custom.name} <span className="font-semibold text-byte-purple">· {addOns.custom.price}</span>
            </span>
            <CtaButton cta={addOns.custom.cta} variant="outline" size="sm" />
          </li>
        </ul>
      </Card>
      <Card>
        <h3>{addOns.extras.title}</h3>
        <ul className="mt-3 text-[15px]">{addOns.extras.items.map(row)}</ul>
      </Card>
    </div>
  );
}

export function Packages() {
  const p = site.packages;
  const [yearly, setYearly] = useState(false);
  return (
    <Section id="packages" tone="cream">
      <SectionHeader eyebrow={p.eyebrow} title={p.title} subtitle={p.subtitle} />
      <BillingToggle yearly={yearly} setYearly={setYearly} billing={p.billing} />
      <div data-reveal="stagger" className="mx-auto grid max-w-[860px] grid-cols-2 gap-5 mobile:grid-cols-1 mobile:gap-4">
        {p.plans
          .filter((plan) => plan.onSite !== false)
          .map((plan) => (
            <Plan key={plan.name} plan={plan} yearly={yearly} includedTitle={p.includedTitle} yearlyNote={p.billing.yearlyNote} />
          ))}
      </div>
      <p data-reveal className="mx-auto mt-8 max-w-[62ch] text-center text-lg font-semibold text-byte-purple">
        {p.comparison}
      </p>
      <AddOns addOns={p.addOns} />
      <div className="mt-[22px] text-[13px] text-muted mobile:text-sm">
        {p.footnotes.map((f) => (
          <p key={f}>{f}</p>
        ))}
      </div>
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
