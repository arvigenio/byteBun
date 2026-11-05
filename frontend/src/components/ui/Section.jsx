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

// h2 plus subtitle. `center` centers both.
export function SectionHeader({ title, subtitle, center = false, titleClassName = '' }) {
  return (
    <div className={center ? 'text-center' : ''}>
      <h2 className={titleClassName}>{title}</h2>
      {subtitle && <p className={`mb-10 max-w-[60ch] text-[17px] text-muted ${center ? 'mx-auto' : ''}`}>{subtitle}</p>}
    </div>
  );
}
