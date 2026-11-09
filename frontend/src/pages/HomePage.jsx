import { TopStrip } from '../components/TopStrip.jsx';
import { Header } from '../components/Header.jsx';
import { Hero } from '../components/Hero.jsx';
import { Build } from '../components/Build.jsx';
import { FreeBand } from '../components/FreeBand.jsx';
import { Problem } from '../components/Problem.jsx';
import { Services } from '../components/Services.jsx';
import { Metrics } from '../components/Metrics.jsx';
import { Packages } from '../components/Packages.jsx';
import { Demos } from '../components/Demos.jsx';
import { WhyUs } from '../components/WhyUs.jsx';
import { HowItWorks } from '../components/HowItWorks.jsx';
import { Faq } from '../components/Faq.jsx';
import { FinalCta } from '../components/FinalCta.jsx';
import { SeoBlock } from '../components/SeoBlock.jsx';
import { Footer } from '../components/Footer.jsx';
import { StickyBar } from '../components/StickyBar.jsx';
import { ChatWidget } from '../components/ChatWidget.jsx';
import { useScrollReveal } from '../hooks/useScrollReveal.js';

// The landing page. Order is a funnel: what we build -> the free offer -> the problem ->
// the system -> proof -> pricing -> trust -> next steps -> objections (FAQ) -> final CTA.
// Section tones alternate cream / lavender; keep that when reordering.
// Every lead button links to the lead page (pages/GetStartedPage.jsx).
export function HomePage() {
  useScrollReveal(); // sections fade and slide up as they scroll into view
  return (
    <>
      <TopStrip />
      <Header />
      <main id="top">
        <Hero />
        <Build />
        <FreeBand />
        <Problem />
        <Services />
        <Metrics />
        <Demos />
        <Packages />
        <WhyUs />
        <HowItWorks />
        <Faq />
        <FinalCta />
        <SeoBlock />
      </main>
      <Footer />
      <StickyBar />
      <ChatWidget />
    </>
  );
}
