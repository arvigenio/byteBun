import { useTone } from './Section.jsx';

// Lavender with a border on cream sections; cream with no border on lavender sections.
// `border` replaces the default border classes (e.g. the featured plan's orange border).
export function Card({ className = '', border, children, as: Tag = 'div' }) {
  const onLavender = useTone() === 'lavender';
  const bg = onLavender ? 'bg-cream-dough' : 'bg-lavender-mist';
  const borderClass = border ?? (onLavender ? '' : 'border border-line');
  return <Tag className={`rounded-card p-[26px] mobile:p-5 ${bg} ${borderClass} ${className}`}>{children}</Tag>;
}

export const CardText = ({ children }) => <p className="text-[15px] text-muted">{children}</p>;

// Grid of cards: repeat(auto-fit, minmax(250px, 1fr)), 20px gap. Cards reveal one after another.
export function CardGrid({ className = '', children }) {
  return <div data-reveal="stagger" className={`grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-5 mobile:gap-4 ${className}`}>{children}</div>;
}

// Small rounded label: "Demo", "Most popular".
export function Chip({ children }) {
  return <span className="mb-2.5 inline-block rounded-full bg-honey-gold px-3 py-0.5 text-xs font-bold text-midnight-plum">{children}</span>;
}
