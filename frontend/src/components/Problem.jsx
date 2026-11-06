import { site } from '../content/site.js';
import { Section, SectionHeader } from './ui/Section.jsx';
import { Card, CardGrid, CardText } from './ui/Card.jsx';
import { CtaStrip, CtaButton } from './ui/Button.jsx';

export function Problem() {
  const p = site.problem;
  return (
    <Section tone="cream">
      <SectionHeader eyebrow={p.eyebrow} title={p.title} subtitle={p.subtitle} />
      <CardGrid>
        {p.cards.map((c) => (
          <Card key={c.title} border="border border-l-4 border-line border-l-circuit-teal">
            <h3>{c.title}</h3>
            <CardText>{c.text}</CardText>
          </Card>
        ))}
      </CardGrid>
      <CtaStrip text={p.cta.text}>
        <CtaButton cta={p.cta} variant="secondary" />
      </CtaStrip>
    </Section>
  );
}
