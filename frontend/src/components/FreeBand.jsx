import { site } from '../content/site.js';
import { Container } from './ui/Container.jsx';
import { CtaButton } from './ui/Button.jsx';

export function FreeBand() {
  const f = site.freeBand;
  return (
    <section id="free" data-surface="dark" className="bg-byte-purple py-14 mobile:py-11">
      <Container className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] items-center gap-8">
        <div>
          <h2 className="mb-2.5 text-cream-dough">{f.title}</h2>
          <p className="max-w-[48ch] text-[17px] text-lavender-mist">{f.text}</p>
          <div className="mt-[22px] mobile:*:w-full">
            <CtaButton cta={f.cta} variant="primary" />
          </div>
        </div>
        <ul className="flex flex-wrap gap-3 mobile:flex-col mobile:gap-2">
          {f.badges.map((b) => (
            <li key={b.title} className="flex-[1_1_150px] rounded-[14px] bg-honey-gold p-[18px] text-center text-midnight-plum mobile:flex mobile:flex-none mobile:items-center mobile:justify-between mobile:gap-3 mobile:px-4 mobile:py-3 mobile:text-left">
              <strong className="block text-xl leading-tight mobile:text-lg mobile:whitespace-nowrap">{b.title}</strong>
              <span className="text-[13px] font-semibold mobile:text-right mobile:text-sm">{b.caption}</span>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
