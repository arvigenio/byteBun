import { site } from '../content/site.js';
import { Section, SectionHeader } from './ui/Section.jsx';
import { Card, CardGrid, CardText } from './ui/Card.jsx';

export function WhyUs() {
  const w = site.whyUs;
  return (
    <Section tone="lavender">
      <SectionHeader eyebrow={w.eyebrow} title={w.title} subtitle={w.subtitle} center />
      <CardGrid>
        {w.cards.map((c) => (
          <Card key={c.title}>
            <h3>{c.title}</h3>
            <CardText>{c.text}</CardText>
          </Card>
        ))}
      </CardGrid>
    </Section>
  );
}
