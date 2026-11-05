import { site } from '../content/site.js';
import { Section, SectionHeader } from './ui/Section.jsx';
import { Card, CardGrid, CardText, Chip } from './ui/Card.jsx';
import { Button } from './ui/Button.jsx';

export function Demos() {
  const d = site.demos;
  return (
    <Section id="demos" tone="lavender">
      <SectionHeader title={d.title} subtitle={d.subtitle} />
      <CardGrid>
        {d.items.map((item) => (
          <Card key={item.name}>
            <Chip>{d.tag}</Chip>
            <h3>{item.name}</h3>
            <CardText>{item.text}</CardText>
            <Button variant="secondary" href={item.href} className="mt-[18px] mobile:w-full">
              {item.label}
            </Button>
          </Card>
        ))}
      </CardGrid>
      <p className="mt-[22px] text-[13px] text-muted mobile:text-sm">{d.note}</p>
    </Section>
  );
}
