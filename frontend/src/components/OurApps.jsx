import { site } from '../content/site.js';
import { Container } from './ui/Container.jsx';
import { CtaButton } from './ui/Button.jsx';
import { CheckDot, Icon } from './ui/Icon.jsx';

// "Our apps" (the Our Apps menu item, #apps): Byte Bun's own apps, each with its products and
// links to start free or sign in. Copy: site.apps (add an app to `list` to show it here).
export function OurApps() {
  const a = site.apps;
  return (
    <section id="apps" data-surface="dark" className="scroll-mt-20 bg-byte-purple py-20 mobile:py-14">
      <Container>
        <div data-reveal className="mx-auto mb-10 max-w-[60ch] text-center">
          <p className="mb-2 text-sm font-bold tracking-[0.14em] text-circuit-teal uppercase">{a.eyebrow}</p>
          <h2 className="mb-3 text-cream-dough">{a.title}</h2>
          <p className="text-[17px] text-lavender-mist">{a.subtitle}</p>
        </div>
        <ul className="flex flex-col gap-8">
          {a.list.map((app) => (
            <li key={app.name} data-reveal className="rounded-[22px] border border-cream-dough/15 bg-cream-dough/[0.04] p-7 mobile:p-5">
              <div className="mb-6 flex flex-wrap items-center gap-4">
                <img src={app.icon} alt="" className="size-14 rounded-2xl" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-2xl text-cream-dough">{app.name}</h3>
                  <p className="text-lavender-mist">
                    {app.text} <span className="text-cream-dough/60">· {app.url}</span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 mobile:w-full mobile:*:flex-1">
                  <CtaButton cta={app.cta} variant="primary" />
                  <CtaButton cta={app.signIn} variant="light" />
                </div>
              </div>
              <div data-reveal="stagger" className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-5">
                {app.products.map((p) => (
                  <article key={p.name} className="flex flex-col rounded-[18px] border border-cream-dough/15 bg-cream-dough/[0.06] p-6 mobile:p-5">
                    <div className="mb-3 flex items-center gap-3">
                      <span className="grid size-11 place-items-center rounded-xl bg-honey-gold text-midnight-plum">
                        <Icon name={p.icon} />
                      </span>
                      <h4 className="text-xl font-bold text-cream-dough">{p.name}</h4>
                    </div>
                    <p className="mb-4 text-lavender-mist">{p.text}</p>
                    <ul className="mt-auto space-y-2">
                      {p.points.map((t) => (
                        <li key={t} className="flex items-start gap-2.5 text-[15px] text-cream-dough">
                          <CheckDot className="mt-0.5 shrink-0" />
                          {t}
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
              {app.note && <p className="mt-5 text-center text-sm text-lavender-mist">{app.note}</p>}
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
