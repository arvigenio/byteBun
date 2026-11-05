import { site } from '../content/site.js';
import { Container } from './ui/Container.jsx';

const colTitle = 'mb-1.5 text-[15px] font-bold tracking-normal text-cream-dough';

export function Footer() {
  const f = site.footer;
  return (
    // Extra bottom padding at 720px and below so the sticky bar never covers the footer.
    <footer data-surface="dark" className="bg-midnight-plum pt-11 pb-11 text-sm text-lavender-mist/80 mobile:pb-[calc(90px+env(safe-area-inset-bottom))]">
      <Container>
        <div className="mb-7 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-7 mobile:grid-cols-2 mobile:gap-x-4 mobile:gap-y-5">
          <div className="mobile:col-span-2">
            <h2 className={colTitle}>{site.brand.name}</h2>
            <p>{f.blurb}</p>
          </div>
          {f.columns.map((col) => (
            <nav key={col.title} aria-label={`Footer: ${col.title}`}>
              <h2 className={colTitle}>{col.title}</h2>
              <ul>
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a href={l.href} className="block py-1 hover:text-honey-gold mobile:flex mobile:min-h-11 mobile:items-center mobile:py-1.5 mobile:leading-snug">
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <p>{f.copyright}</p>
      </Container>
    </footer>
  );
}
