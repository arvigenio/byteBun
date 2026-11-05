import { site } from '../content/site.js';

export function TopStrip() {
  const { text, linkLabel, href } = site.topStrip;
  return (
    <div data-surface="dark" className="bg-midnight-plum px-4 py-[9px] text-center text-sm font-semibold text-honey-gold">
      {text}
      <a href={href} className="-my-3.5 ml-1.5 py-3.5 text-cream-dough underline underline-offset-3 hover:text-gold-tint">
        {linkLabel}
      </a>
    </div>
  );
}
