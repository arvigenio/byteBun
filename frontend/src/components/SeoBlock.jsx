import { site } from '../content/site.js';
import { Section } from './ui/Section.jsx';

// Visible keyword-rich summary for search engines and people. Keep it visible.
export function SeoBlock() {
  return (
    <Section tone="cream">
      <h2 className="text-[22px]">{site.seo.title}</h2>
      <p className="max-w-[75ch] text-[15px] text-muted">{site.seo.text}</p>
    </Section>
  );
}
