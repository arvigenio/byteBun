import { site } from '../content/site.js';
import { Section, SectionHeader } from './ui/Section.jsx';
import { Card, CardGrid, CardText } from './ui/Card.jsx';
import { CtaStrip, CtaButton } from './ui/Button.jsx';
import { Icon } from './ui/Icon.jsx';

export function Services() {
  const s = site.services;
  return (
    <Section id="services" tone="lavender">
      <SectionHeader title={s.title} subtitle={s.subtitle} />
      <CardGrid>
        {s.cards.map((c) => (
          <Card key={c.title}>
            <div className="mb-4 grid size-[46px] place-items-center rounded-xl bg-byte-purple text-circuit-teal">
              <Icon name={c.icon} />
            </div>
            <h3>{c.title}</h3>
            <CardText>{c.text}</CardText>
          </Card>
        ))}
      </CardGrid>
      <CtaStrip text={s.cta.text}>
        <CtaButton cta={s.cta} variant="primary" />
      </CtaStrip>
    </Section>
  );
}
