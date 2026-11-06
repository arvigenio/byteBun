import { createContext, useContext } from 'react';
import { Container } from './Container.jsx';

// Cards read the section tone so they pick the right background and border by themselves.
const ToneContext = createContext('cream');
export const useTone = () => useContext(ToneContext);

const TONES = {
  cream: 'bg-cream-dough',
  lavender: 'bg-lavender-mist',
};

// A standard page section: 80px vertical padding (56px at 720px and below).
export function Section({ id, tone = 'cream', className = '', containerClassName = '', children }) {
  return (
    <ToneContext.Provider value={tone}>
      <section id={id} className={`py-20 mobile:py-14 ${TONES[tone]} ${className}`}>
        <Container className={containerClassName}>{children}</Container>
      </section>
    </ToneContext.Provider>
  );
}

// Small uppercase label above a heading: the funnel stage ("The problem", "Pricing", ...).
export function Eyebrow({ children, className = '' }) {
  return <p className={`mb-2 text-[13px] font-bold tracking-[0.12em] text-soft-violet uppercase ${className}`}>{children}</p>;
}

// Optional eyebrow, h2, and subtitle. `center` centers them.
export function SectionHeader({ eyebrow, title, subtitle, center = false, titleClassName = '' }) {
  return (
    <div data-reveal className={center ? 'text-center' : ''}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className={titleClassName}>{title}</h2>
      {subtitle && <p className={`mb-10 max-w-[60ch] text-[17px] text-muted ${center ? 'mx-auto' : ''}`}>{subtitle}</p>}
    </div>
  );
}
