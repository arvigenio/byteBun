// ALL editable site copy, prices, links, and FAQ live in this one file.
// Copy is taken verbatim from docs/reference/bytebun-landing-v9.html. Do not rewrite it,
// and do not add testimonials, logos, review scores, or statistics.
// Anything marked PLACEHOLDER must be confirmed or replaced before launch.
//
// This file is plain data (no React, no browser APIs): the Vite SEO plugin also imports it
// to generate meta tags, JSON-LD, robots.txt, and the sitemap at build time.
//
// Buttons have either `lead: '<source>'` (opens the lead form; the source is saved with the
// lead so you can see which button it came from) or `href` (a link or in-page anchor).

const tagline = 'Free websites, automation, and AI for clinics and local businesses.';

export const site = {
  brand: {
    name: 'Byte Bun Tech',
    tagline,
    domain: 'bytebuntech.com',
  },

  contact: {
    email: 'hello@bytebuntech.com', // PLACEHOLDER: confirm the real inbox
    // PLACEHOLDER: calendar booking link (e.g. GoHighLevel or Calendly). When empty, the
    // "Book my free audit call" button opens the lead form instead.
    bookingUrl: '',
  },

  topStrip: {
    text: 'Free website, free domain, and free hosting included with every plan.',
    linkLabel: 'Claim yours',
    href: '#contact',
  },

  nav: [
    { label: 'Services', href: '#services' },
    { label: 'Packages', href: '#packages' },
    { label: 'Demos', href: '#demos' },
    { label: 'FAQ', href: '#faq' },
  ],
  headerCta: { label: 'Get a free audit', lead: 'header' },

  hero: {
    tag: 'For dental clinics, vet clinics, and local service businesses',
    title: 'Answer every lead. Fill every appointment slot.',
    lead: 'We build your website, AI chatbot, and automatic follow-up so missed calls become booked visits. Your website, domain, and hosting are free and included.',
    primaryCta: { label: 'Get my free audit', lead: 'hero' },
    secondaryCta: { label: 'Try the live demos', href: '#demos' },
    trust: ['Free website', 'Free domain', 'Free hosting'],
    chat: {
      ariaLabel: 'Sample chat: a patient books a dental cleaning',
      header: 'BrightSmile Dental assistant',
      badge: 'demo',
      messages: [
        { from: 'user', text: 'Do you have any openings tomorrow?' },
        { from: 'assistant', text: 'Yes, we have 9:30 AM and 2:00 PM. Which works better?' },
        { from: 'user', text: '9:30 please.' },
      ],
      confirmation: 'Booked: Thursday 9:30 AM, cleaning',
    },
  },

  freeBand: {
    title: 'Your website, domain, and hosting are free. Always included.',
    text: 'No separate bills for a web designer, a domain registrar, or a hosting company. Pick a plan and we cover the website, the domain name, secure hosting, and SSL while your plan is active.',
    cta: { label: 'Get my free website', lead: 'free-band' },
    badges: [
      { title: 'Free website', caption: 'Designed and built for you' },
      { title: 'Free domain', caption: 'Your name, registered for you' },
      { title: 'Free hosting', caption: 'Fast, secure, with SSL' },
    ],
  },

  problem: {
    title: 'Busy clinics lose patients in the gaps',
    subtitle: "When the front desk is on another call, or the office is closed, people don't wait. They book with whoever answers first.",
    cards: [
      { title: 'Missed calls go cold', text: 'A caller who reaches voicemail often tries the next clinic on the list. Instant text-back keeps the conversation with you.' },
      { title: 'After-hours questions go unanswered', text: 'Prices, hours, insurance, and "do you see exotic pets?" get asked at night. A chatbot answers from your approved information, any time.' },
      { title: 'No-shows leave empty chairs', text: 'An empty slot is lost revenue. Two-way reminders and easy rescheduling help fill the day.' },
      { title: 'Overdue patients drift away', text: 'Recall messages for cleanings, vaccines, and check-ups bring existing patients back without extra staff time.' },
    ],
    cta: { text: 'See where your clinic is leaking leads.', label: 'Get a free audit', lead: 'problem' },
  },

  services: {
    title: 'One team for your website, automation, and AI',
    subtitle: 'Everything runs together, so a new inquiry is answered, tracked, and followed up without anyone copying data between tools.',
    cards: [
      { icon: 'web', title: 'Free website, domain, and hosting', text: 'A fast, mobile-friendly site with online booking, forms, and local SEO basics. Domain, hosting, and SSL all included.' },
      { icon: 'bolt', title: 'Missed-call text-back', text: 'Every missed call and form fill gets an instant reply with a booking link, around the clock.' },
      { icon: 'chat', title: 'AI chatbot for web, Facebook, and Instagram', text: 'Answers common questions, collects details, and books appointments. Hands off to your team when unsure.' },
      { icon: 'calendar', title: 'Appointment reminders and recalls', text: 'Automatic confirmations, reschedule links, no-show recovery, and overdue-visit campaigns.' },
      { icon: 'mail', title: 'Email and review marketing', text: 'Branded templates, welcome sequences, newsletters, and automatic Google review requests.' },
      { icon: 'database', title: 'Custom software and dashboards', text: 'Client portals, reporting dashboards, and integrations built around the tools you already use.' },
    ],
    cta: { text: 'Not sure what you need?', label: 'Book a 30-minute call', lead: 'services' },
  },

  // Design targets, not results. Keep the subtitle saying so.
  metrics: {
    title: 'What our systems are built to do',
    subtitle: 'These are the design targets every Byte Bun setup is tested against before launch.',
    items: [
      { figure: '< 60 sec', text: 'Target reply time to a new lead or missed call, day or night.' },
      { figure: '24/7', text: 'Chatbot coverage for questions and booking requests, including after hours.' },
      { figure: '2 to 4 weeks', text: 'Typical time from signed proposal to a live system.' },
      { figure: '$0', text: 'For your website, domain, and hosting while your plan is active.' },
    ],
    ctas: [
      { label: 'Start with a free audit', lead: 'metrics' },
      { label: 'See it in action', href: '#demos' },
    ],
  },

  packages: {
    title: 'Simple monthly plans. Free website, domain, and hosting.',
    subtitle: 'Start small and add features as you grow. Every plan includes your website, domain, and hosting at no extra cost.',
    // PLACEHOLDER: all prices are sample pricing.
    plans: [
      {
        name: 'Starter',
        price: '$99', // PLACEHOLDER
        period: '/month',
        blurb: 'For new businesses that need to capture leads.',
        features: ['Free website, domain, and hosting', 'Booking calendar and forms', 'Instant email and SMS reply', 'Basic follow-up sequence'],
        cta: { label: 'Choose Starter', lead: 'plan-starter' },
      },
      {
        name: 'Growth',
        price: '$297', // PLACEHOLDER
        period: '/month',
        blurb: 'For clinics with traffic but weak follow-up.',
        features: ['Free website, domain, and hosting', 'Missed-call text-back', 'AI website chatbot', 'Reminders and review requests', 'Monthly report'],
        featured: true,
        featuredLabel: 'Most popular',
        cta: { label: 'Choose Growth', lead: 'plan-growth' },
      },
      {
        name: 'Pro',
        price: '$697', // PLACEHOLDER
        period: '/month',
        blurb: 'For teams that want the full system.',
        features: ['Free website, domain, and hosting', 'Facebook and Instagram chatbot', 'Custom automations', 'Email campaigns and recalls', 'Client dashboard'],
        cta: { label: 'Choose Pro', lead: 'plan-pro' },
      },
    ],
    note: 'Sample pricing. Plans have a minimum term. One-time setup fees and add-ons apply and are confirmed in your written proposal before you pay anything.',
    cta: { text: 'Want a quote for your clinic?', label: 'Get my proposal in 24 hours', lead: 'packages' },
  },

  demos: {
    title: 'See it working before you commit',
    subtitle: 'Two demo clinics with live booking and chat, built on the same system you would get.',
    tag: 'Demo',
    items: [
      {
        name: 'BrightSmile Dental',
        text: 'Emergency triage, new-patient forms, and six-month recall reminders.',
        label: 'Open the dental demo',
        href: '#demos', // PLACEHOLDER: dental demo URL
      },
      {
        name: 'PawCare Veterinary',
        text: 'Pet profiles, vaccine reminders, and a species-aware booking flow.',
        label: 'Open the pet clinic demo',
        href: '#demos', // PLACEHOLDER: pet clinic demo URL
      },
    ],
    note: 'Demo clinics are fictional and use sample data only.',
  },

  whyUs: {
    title: 'Why clinics choose Byte Bun',
    subtitle: 'A small team means direct answers, fast changes, and no handoffs.',
    cards: [
      { title: 'Design and engineering under one roof', text: 'A designer for the look and sales side, and an engineer for the automation, so the site and the systems behind it work as one.' },
      { title: 'Built on proven tools', text: 'We use GoHighLevel, n8n, and Claude AI, plus custom code where your business needs something specific.' },
      { title: 'Careful with your data', text: 'We never store card numbers, we use secure payment pages, and we tell you exactly what data is kept and where.' },
      { title: 'Clear terms', text: 'Fixed scope and pricing in writing. A plain-language minimum term and 30 days notice after it.' },
    ],
  },

  steps: {
    title: 'How it works',
    subtitle: 'From first call to live system in a few weeks.',
    items: [
      { title: 'Book a free audit call', text: 'Tell us about your clinic. We review your website, response time, and follow-up and show you where leads slip through.' },
      { title: 'Get a clear proposal', text: 'Three options with fixed scope and pricing, within 24 hours of the call.' },
      { title: 'We build and test', text: 'Your free website, domain, hosting, automations, and assistant are built and tested before they go live.' },
      { title: 'Launch and keep improving', text: 'Monthly reports, small changes, and support are included in your plan.' },
    ],
    cta: { label: 'Start step one', lead: 'how-it-works' },
  },

  // Used for both the visible FAQ and the FAQPage JSON-LD.
  faq: {
    title: 'Frequently asked questions',
    subtitle: 'Straight answers before you book.',
    items: [
      { q: 'Are the website, domain, and hosting really free?', a: 'Yes. The website, domain registration, hosting, and SSL certificate are included at no extra charge while you have an active plan. Plans have a minimum term, which we explain in your proposal before you sign.' },
      { q: 'What happens to my domain if I cancel?', a: 'After the minimum term is complete and your account is settled, we transfer the domain to you. The details are written into your agreement.' },
      { q: 'How fast can we go live?', a: 'Most Starter and Growth setups go live in two to four weeks, depending on how quickly you send your logo, services, and FAQs.' },
      { q: 'Will the AI chatbot say something wrong?', a: 'It only answers from information you approve. When it is unsure, it hands the conversation to your team instead of guessing, and it never gives medical advice.' },
      { q: 'Do I need to change my booking software?', a: 'Usually not. We can connect to common calendars and tools, or provide a booking calendar as part of your plan.' },
      { q: 'Can I cancel?', a: 'After the minimum term, yes, with 30 days notice. Your data stays yours.' },
    ],
    cta: { text: 'Still have a question?', label: 'Ask us on a free call', lead: 'faq' },
  },

  finalCta: {
    title: 'Get your free website, domain, and hosting',
    text: 'Book a free 30-minute audit call. We will review your website and follow-up and send you a clear plan, with no obligation.',
    primary: { label: 'Book my free audit call', lead: 'final-cta' },
    secondary: { label: 'Email us' }, // uses contact.email
  },

  seo: {
    title: 'Free website, domain, and hosting with AI chatbot and booking automation',
    text: 'Byte Bun Tech is a small web and automation studio. We build free clinic websites with domain and hosting included, AI chatbots for websites, Facebook, and Instagram, missed-call text-back, appointment reminders, patient recall campaigns, and email marketing for dental clinics, veterinary clinics, and other local service businesses. Our systems are built with GoHighLevel CRM, n8n workflow automation, Claude AI, and custom Node.js software, and designed to help you respond faster, reduce no-shows, and bring existing customers back.',
  },

  // <head> tags, injected into index.html at build time by seo-plugin.js.
  meta: {
    title: 'Free Website, Domain and Hosting + AI Chatbot for Clinics | Byte Bun Tech',
    description: 'Byte Bun Tech gives dental clinics, vet clinics, and local businesses a free website, free domain, and free hosting with an AI chatbot, missed-call text-back, and appointment reminders. Book a free audit.',
    keywords: 'free website for clinics, free domain and hosting, AI chatbot for clinics, dental clinic website, vet clinic website, missed call text back, appointment reminders, GoHighLevel agency, n8n automation',
    // SITE_URL (env) overrides this at build time.
    canonical: 'https://bytebuntech.com/',
    ogTitle: 'Byte Bun Tech: free website, domain, and hosting with AI booking automation',
    ogDescription: 'Answer every lead and fill your calendar. Website, domain, and hosting are free and included with every plan.',
    ogImage: '/og-image.png', // PLACEHOLDER image, 1200x630: replace public/og-image.png
    locale: 'en_US',
    // ProfessionalService JSON-LD
    schemaDescription: 'Free website, domain, and hosting with AI chatbots and booking automation for dental clinics, veterinary clinics, and local service businesses.',
    serviceType: ['Website design', 'Web hosting', 'AI chatbot', 'CRM automation', 'Email marketing', 'Custom software'],
  },

  footer: {
    blurb: tagline,
    columns: [
      {
        title: 'Services',
        links: [
          { label: 'Free website, domain, hosting', href: '#free' },
          { label: 'AI chatbot', href: '#services' },
          { label: 'Missed-call text-back', href: '#services' },
          { label: 'Reminders and recalls', href: '#services' },
        ],
      },
      {
        title: 'Company',
        links: [
          { label: 'Packages', href: '#packages' },
          { label: 'Demos', href: '#demos' },
          { label: 'FAQ', href: '#faq' },
          { label: 'Book a call', href: '#contact' },
        ],
      },
    ],
    copyright: '© 2026 Byte Bun Tech · bytebuntech.com',
  },

  stickyBar: {
    primary: { label: 'Free audit', lead: 'sticky-bar' },
    secondary: { label: 'See plans', href: '#packages' },
  },

  // Not in the reference file (the reference has no form).
  leadForm: {
    title: 'Book a free audit call', // PLACEHOLDER: confirm wording
    intro: 'Tell us a little about your business and we will get back to you.', // PLACEHOLDER
    submitLabel: 'Send', // PLACEHOLDER
    retryLabel: 'Try again',
    successTitle: "Thanks, we'll be in touch within one business day",
    businessTypes: ['Dental clinic', 'Veterinary clinic', 'Other appointment-based business'],
  },
};
