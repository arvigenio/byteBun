import { LeadFormDialog } from './components/LeadForm.jsx';
import { SmoothScroll } from './components/SmoothScroll.jsx';
import { TopStrip } from './components/TopStrip.jsx';
import { Header } from './components/Header.jsx';
import { Hero } from './components/Hero.jsx';
import { FreeBand } from './components/FreeBand.jsx';
import { Problem } from './components/Problem.jsx';
import { Services } from './components/Services.jsx';
import { Metrics } from './components/Metrics.jsx';
import { Packages } from './components/Packages.jsx';
import { Demos } from './components/Demos.jsx';
import { WhyUs } from './components/WhyUs.jsx';
import { HowItWorks } from './components/HowItWorks.jsx';
import { Faq } from './components/Faq.jsx';
import { FinalCta } from './components/FinalCta.jsx';
import { SeoBlock } from './components/SeoBlock.jsx';
import { Footer } from './components/Footer.jsx';
import { StickyBar } from './components/StickyBar.jsx';

// Page order matches docs/reference/bytebun-landing-v9.html.
// <head> tags (title, meta, JSON-LD) are injected at build time by seo-plugin.js, so they are in
// the static HTML for crawlers and link previews that don't run JavaScript.
export default function App() {
  return (
    <SmoothScroll>
      <TopStrip />
      <Header />
      <main id="top">
        <Hero />
        <FreeBand />
        <Problem />
        <Services />
        <Metrics />
        <Packages />
        <Demos />
        <WhyUs />
        <HowItWorks />
        <Faq />
        <FinalCta />
        <SeoBlock />
      </main>
      <Footer />
      <StickyBar />
      <LeadFormDialog />
    </SmoothScroll>
  );
}
