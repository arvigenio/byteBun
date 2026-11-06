import { site } from '../content/site.js';
import { Section, SectionHeader } from './ui/Section.jsx';
import { Card, CardGrid, CardText } from './ui/Card.jsx';
import { CtaStrip, CtaButton } from './ui/Button.jsx';

// Design targets, not results: the subtitle in site.js says so and must stay.
// Phones: compact, left-aligned cards instead of four tall centered ones.
export function Metrics() {
  const m = site.metrics;
  const [primary, secondary] = m.ctas;
  return (
    <Section tone="cream" containerClassName="text-center">
      <SectionHeader eyebrow={m.eyebrow} title={m.title} subtitle={m.subtitle} center />
      <CardGrid className="mobile:gap-3!">
        {m.items.map((item) => (
          <Card key={item.figure} className="mobile:px-5! mobile:py-4! mobile:text-left">
            <div className="mb-1.5 text-[38px] leading-[1.1] font-bold mobile:mb-1 mobile:text-[28px] tracking-[-0.02em] text-byte-purple">{item.figure}</div>
            <CardText>{item.text}</CardText>
          </Card>
        ))}
      </CardGrid>
      <CtaStrip>
        <CtaButton cta={primary} variant="primary" />
        <CtaButton cta={secondary} variant="outline" />
      </CtaStrip>
    </Section>
  );
}
