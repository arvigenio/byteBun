import { site } from '../content/site.js';
import { ChatMock } from './ChatMock.jsx';
import { Container } from './ui/Container.jsx';
import { CtaButton } from './ui/Button.jsx';
import { CheckDot } from './ui/Icon.jsx';

export function Hero() {
  const h = site.hero;
  return (
    <Container className="grid grid-cols-[repeat(auto-fit,minmax(min(310px,100%),1fr))] items-center gap-12 pt-[68px] pb-[76px] mobile:gap-8 mobile:pt-10 mobile:pb-[52px]">
      <div>
        <span className="mb-[18px] inline-block rounded-full bg-lavender-mist px-3.5 py-[5px] text-[13px] font-semibold text-byte-purple">{h.tag}</span>
        <h1>{h.title}</h1>
        <p className="mb-[26px] max-w-[46ch] text-lg text-muted">{h.lead}</p>
        <div className="flex flex-wrap gap-3 mobile:flex-col mobile:*:w-full">
          <CtaButton cta={h.primaryCta} variant="primary" />
          <CtaButton cta={h.secondaryCta} variant="outline" />
        </div>
        <ul className="mt-6 flex flex-wrap gap-[18px] text-sm font-medium text-muted">
          {h.trust.map((t) => (
            <li key={t} className="flex items-center gap-1.5">
              <CheckDot />
              {t}
            </li>
          ))}
        </ul>
      </div>
      <ChatMock chat={h.chat} />
    </Container>
  );
}
