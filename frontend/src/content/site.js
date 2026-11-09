// ALL editable site copy, prices, links, and FAQ live in this one file.
// Copy started from docs/reference/bytebun-landing-v9.html and has since been extended to put
// custom websites, web apps, and automations up front and to read as a funnel (each section
// has an `eyebrow` stage label). Do not add testimonials, logos, review scores, or statistics.
// Anything marked PLACEHOLDER must be confirmed or replaced before launch.
//
// This file is plain data (no React, no browser APIs): the Vite SEO plugin also imports it
// to generate meta tags, JSON-LD, robots.txt, and the sitemap at build time.
//
// Buttons have either `lead: '<source>'` (links to the lead page, /get-started; the source is saved with the
// lead so you can see which button it came from) or `href` (a link or in-page anchor).

const tagline = 'Custom websites, web apps, and automations for clinics and local businesses.';

export const site = {
  brand: {
    name: 'Byte Bun Tech',
    tagline,
    domain: 'bytebuntech.com',
  },

  contact: {
    email: 'hello@bytebuntech.com', // PLACEHOLDER: confirm the real inbox
    // PLACEHOLDER: calendar booking link (e.g. GoHighLevel or Calendly). When empty, the
    // "Book my free consultation" button links to the lead page instead.
    bookingUrl: '',
  },

  topStrip: {
    text: 'Free website, free domain, and free hosting included with every plan.',
    linkLabel: 'Claim yours',
    href: '#contact',
  },

  nav: [
    { label: 'What we build', href: '#build' },
    { label: 'Services', href: '#services' },
    { label: 'Packages', href: '#packages' },
    { label: 'Demos', href: '#demos' },
    { label: 'FAQ', href: '#faq' },
  ],
  headerCta: { label: 'Get a free consultation', lead: 'header' },

  hero: {
    tag: 'For dental clinics, vet clinics, and local service businesses',
    // Shown as pills above the headline: the two things we want every visitor to remember.
    pillars: ['Custom websites', 'Web applications', 'Custom automations'],
    title: 'Custom websites and automations that fill your appointment book.',
    lead: 'We design and build custom websites, web applications, and automations around how your business actually runs, so every lead is answered and missed calls become booked visits. Your website, domain, and hosting are free and included.',
    primaryCta: { label: 'Get my free consultation', lead: 'hero' },
    secondaryCta: { label: 'See what we build', href: '#build' },
    trust: ['Built for you, not a template', 'Free domain and hosting', 'Typically live in 2 to 4 weeks'],
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

  // The two core offers, shown right after the hero.
  build: {
    eyebrow: 'What we build',
    title: 'Custom websites, web apps, and automations, built around your business',
    subtitle: 'We don\'t resell templates or one-size-fits-all software. We design and build exactly what your business needs, then connect it so it all works as one system.',
    pillars: [
      {
        icon: 'code',
        kicker: 'Custom web development',
        title: 'Custom websites and web applications',
        text: 'Designed and coded for your business, from a fast marketing website to a full web app your team and clients log in to.',
        points: [
          'Websites with online booking, forms, and local SEO',
          'Client and patient portals',
          'Internal tools and admin dashboards',
          'Integrations with your calendar, CRM, and payments',
        ],
        cta: { label: 'Plan my website or app', lead: 'build-web' },
      },
      {
        icon: 'workflow',
        kicker: 'Custom automation',
        title: 'Custom automations for the busywork',
        text: 'We map how work moves through your business, then automate the repetitive parts so your team stops copying data between tools.',
        points: [
          'Lead capture, instant replies, and follow-up',
          'Booking, reminders, and no-show recovery',
          'CRM, spreadsheet, and email workflows',
          'AI assistants that answer from your approved information',
        ],
        cta: { label: 'Automate my workflow', lead: 'build-automation' },
      },
    ],
    cta: { text: 'Not sure which you need? Most clients start with both.', label: 'Get a free consultation', lead: 'build' },
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
    eyebrow: 'The problem',
    title: 'Busy clinics lose patients in the gaps',
    subtitle: "When the front desk is on another call, or the office is closed, people don't wait. They book with whoever answers first.",
    cards: [
      { title: 'Missed calls go cold', text: 'A caller who reaches voicemail often tries the next clinic on the list. Instant text-back keeps the conversation with you.' },
      { title: 'After-hours questions go unanswered', text: 'Prices, hours, insurance, and "do you see exotic pets?" get asked at night. A chatbot answers from your approved information, any time.' },
      { title: 'No-shows leave empty chairs', text: 'An empty slot is lost revenue. Two-way reminders and easy rescheduling help fill the day.' },
      { title: 'Overdue patients drift away', text: 'Recall messages for cleanings, vaccines, and check-ups bring existing patients back without extra staff time.' },
    ],
    cta: { text: 'See where your clinic is leaking leads.', label: 'Get a free consultation', lead: 'problem' },
  },

  services: {
    eyebrow: 'The system',
    title: 'One team for your website, web apps, automation, and AI',
    subtitle: 'Everything runs together, so a new inquiry is answered, tracked, and followed up without anyone copying data between tools.',
    cards: [
      { icon: 'web', title: 'Free website, domain, and hosting', text: 'A fast, mobile-friendly site with online booking, forms, and local SEO basics. Domain, hosting, and SSL all included.' },
      { icon: 'bolt', title: 'Missed-call text-back', text: 'Every missed call and form fill gets an instant reply with a booking link, around the clock.' },
      { icon: 'chat', title: 'AI chatbot for web, Facebook, and Instagram', text: 'Answers common questions, collects details, and books appointments. Hands off to your team when unsure.' },
      { icon: 'calendar', title: 'Appointment reminders and recalls', text: 'Automatic confirmations, reschedule links, no-show recovery, and overdue-visit campaigns.' },
      { icon: 'mail', title: 'Email and review marketing', text: 'Branded templates, welcome sequences, newsletters, and automatic Google review requests.' },
      { icon: 'database', title: 'Custom web apps and dashboards', text: 'Client portals, booking tools, reporting dashboards, and integrations built around the tools you already use.' },
    ],
    cta: { text: 'Not sure what you need?', label: 'Book a 30-minute call', lead: 'services' },
  },

  // Design targets, not results. Keep the subtitle saying so.
  metrics: {
    eyebrow: 'Built to perform',
    title: 'What our systems are built to do',
    subtitle: 'These are the design targets every Byte Bun setup is tested against before launch.',
    items: [
      { figure: '< 60 sec', text: 'Target reply time to a new lead or missed call, day or night.' },
      { figure: '24/7', text: 'Chatbot coverage for questions and booking requests, including after hours.' },
      { figure: '2 to 4 weeks', text: 'Typical time from signed proposal to a live system.' },
      { figure: '$0', text: 'For your website, domain, and hosting while your plan is active.' },
    ],
    ctas: [
      { label: 'Start with a free consultation', lead: 'metrics' },
      { label: 'See it in action', href: '#demos' },
    ],
  },

  packages: {
    eyebrow: 'Pricing',
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
    // A second path for visitors whose project doesn't fit a monthly plan.
    custom: {
      title: "Need something a plan doesn't cover?",
      text: 'Custom websites, web applications, and automation projects are scoped and quoted separately, with fixed scope and pricing in writing before any work starts.',
      cta: { label: 'Scope a custom project', lead: 'packages-custom' },
    },
    cta: { text: 'Want a quote for your clinic?', label: 'Get my proposal in 24 hours', lead: 'packages' },
  },

  demos: {
    eyebrow: 'See the proof',
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
    eyebrow: 'Why Byte Bun',
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
    eyebrow: 'Your next steps',
    title: 'How it works',
    subtitle: 'From first call to live system in a few weeks.',
    items: [
      { title: 'Book a free consultation', text: 'Tell us about your clinic. We review your website, response time, and follow-up and show you where leads slip through.' },
      { title: 'Get a clear proposal', text: 'Three options with fixed scope and pricing, within 24 hours of the call.' },
      { title: 'We build and test', text: 'Your free website, domain, hosting, automations, and assistant are built and tested before they go live.' },
      { title: 'Launch and keep improving', text: 'Monthly reports, small changes, and support are included in your plan.' },
    ],
    cta: { label: 'Start step one', lead: 'how-it-works' },
  },

  // Used for both the visible FAQ and the FAQPage JSON-LD.
  faq: {
    eyebrow: 'Questions',
    title: 'Frequently asked questions',
    subtitle: 'Straight answers before you book.',
    items: [
      { q: 'Are the website, domain, and hosting really free?', a: 'Yes. The website, domain registration, hosting, and SSL certificate are included at no extra charge while you have an active plan. Plans have a minimum term, which we explain in your proposal before you sign.' },
      { q: 'What happens to my domain if I cancel?', a: 'After the minimum term is complete and your account is settled, we transfer the domain to you. The details are written into your agreement.' },
      { q: 'How fast can we go live?', a: 'Most Starter and Growth setups go live in two to four weeks, depending on how quickly you send your logo, services, and FAQs.' },
      { q: 'Will the AI chatbot say something wrong?', a: 'It only answers from information you approve. When it is unsure, it hands the conversation to your team instead of guessing, and it never gives medical advice.' },
      { q: 'Do I need to change my booking software?', a: 'Usually not. We can connect to common calendars and tools, or provide a booking calendar as part of your plan.' },
      { q: 'Can I cancel?', a: 'After the minimum term, yes, with 30 days notice. Your data stays yours.' },
      { q: 'Can you build a custom web app or automation that is not in a plan?', a: 'Yes. We take on custom website, web application, and automation projects on their own. Each one gets a written proposal with fixed scope and pricing before any work starts.' },
      { q: 'Is my website built from a template?', a: 'No. Your website is designed and built for your business, and anything it needs beyond a standard site, like a portal or a custom booking flow, is built to fit how you work.' },
    ],
    cta: { text: 'Still have a question?', label: 'Ask us on a free call', lead: 'faq' },
  },

  finalCta: {
    title: 'Get a custom website and automations, with domain and hosting free',
    text: 'Book a free 30-minute consultation. We will review your website and follow-up and send you a clear plan, with no obligation.',
    primary: { label: 'Book my free consultation', lead: 'final-cta' },
    secondary: { label: 'Email us' }, // uses contact.email
    reassurance: ['Free 30-minute call', 'Proposal within 24 hours', 'No obligation'],
  },

  seo: {
    title: 'Custom websites, web applications, and automation, with free domain and hosting',
    text: 'Byte Bun Tech is a small web and automation studio. We design and build custom websites, web applications, and custom automations, including free clinic websites with domain and hosting included, AI chatbots for websites, Facebook, and Instagram, missed-call text-back, appointment reminders, patient recall campaigns, and email marketing for dental clinics, veterinary clinics, and other local service businesses. Our systems are built with GoHighLevel CRM, n8n workflow automation, Claude AI, and custom Node.js software, and designed to help you respond faster, reduce no-shows, and bring existing customers back.',
  },

  // <head> tags, injected into index.html at build time by seo-plugin.js.
  meta: {
    title: 'Custom Websites, Web Apps and Automation for Clinics | Byte Bun Tech',
    description: 'Byte Bun Tech builds custom websites, web apps, and automations for dental clinics, vet clinics, and local businesses, with free domain and hosting. Book a free consultation.',
    keywords: 'custom website development, custom web application, custom automation, business process automation, free website for clinics, free domain and hosting, AI chatbot for clinics, dental clinic website, vet clinic website, missed call text back, appointment reminders, GoHighLevel agency, n8n automation',
    // SITE_URL (env) overrides this at build time.
    canonical: 'https://bytebuntech.com/',
    ogTitle: 'Byte Bun Tech: custom websites, web apps, and automations',
    ogDescription: 'Custom websites, web applications, and automations that answer every lead and fill your calendar. Domain and hosting are free with every plan.',
    ogImage: '/og-image.png', // PLACEHOLDER image, 1200x630: replace public/og-image.png
    locale: 'en_US',
    // ProfessionalService JSON-LD
    schemaDescription: 'Custom websites, web applications, and automations, with free domain and hosting, for dental clinics, veterinary clinics, and local service businesses.',
    serviceType: ['Custom website development', 'Web application development', 'Workflow automation', 'Website design', 'Web hosting', 'AI chatbot', 'CRM automation', 'Email marketing', 'Custom software'],
  },

  footer: {
    blurb: tagline,
    columns: [
      {
        title: 'Services',
        links: [
          { label: 'Custom websites and web apps', href: '#build' },
          { label: 'Custom automations', href: '#build' },
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
    primary: { label: 'Free consultation', lead: 'sticky-bar' },
    secondary: { label: 'See plans', href: '#packages' },
  },

  // The lead page (/get-started). Every button with `lead:` links here.
  // `{firstName}` is replaced with what the visitor typed (or dropped, if empty).
  getStarted: {
    pageTitle: 'Get your free consultation | Byte Bun Tech',
    backLabel: 'Back to the website',
    aside: {
      eyebrow: 'Free consultation',
      title: "Let's build something that works as hard as you do",
      text: 'Tell us about your business in about a minute. We will review your website, response time, and follow-up, then send you a clear plan.',
      nextTitle: 'What happens next',
      next: ['We review your website and follow-up', 'You get a proposal within 24 hours', 'We build, test, and launch together'],
      reassurance: ['Free 30-minute call', 'No obligation', 'Fixed pricing in writing'],
    },
    // Same order as LEAD_STEPS in lib/leadSchema.js.
    // `id` picks the step's content in pages/GetStartedPage.jsx. Same order as LEAD_STEPS in
    // lib/leadSchema.js. "bonus" is a promo step with no fields.
    steps: [
      { id: 'business', label: 'Business', title: 'What type of business do you run?', subtitle: 'So we can tailor the call to you.' },
      { id: 'goals', label: 'Goals', title: 'What do you want to achieve?', subtitle: 'Pick everything that applies.' },
      { id: 'features', label: 'Features', title: 'Anything you already know you want?', subtitle: 'Optional. Pick any features you are interested in, or skip this step.' },
      { id: 'bonus', label: 'Bonus', title: 'Your website, domain, and hosting are on us', nextLabel: 'Claim it and continue' },
      { id: 'name', label: 'You', title: "What's your name?", subtitle: 'So we know who we are talking to.' },
      { id: 'schedule', label: 'Schedule', title: 'Pick a time for your free call, {firstName}', subtitle: 'A 30-minute video call. Times are shown in your time zone.' },
      { id: 'contact', label: 'Contact', title: 'Last step: how can we reach you?', subtitle: 'We only use this to contact you about your call.' },
    ],
    // The promo step. Keep the fine print: it matches the FAQ and the plans' minimum term.
    bonus: {
      eyebrow: 'Bonus unlocked',
      text: 'Every plan includes them at no extra cost. No separate bills for a web designer, a domain registrar, or a hosting company.',
      previewLabel: 'Your new website could live at',
      previewNote: 'Example address. We help you pick and register the real one.',
      // Used when no business name was given, by business type.
      fallbackNames: { 'Dental clinic': 'yourdentalclinic', 'Veterinary clinic': 'yourvetclinic', 'Aesthetic clinic': 'youraestheticclinic' },
      fallbackName: 'yourbusiness',
      perks: [
        { icon: 'web', title: 'Custom website', caption: 'Designed and built for you' },
        { icon: 'globe', title: 'Your own domain', caption: 'Registered in your name for you' },
        { icon: 'shield', title: 'Fast, secure hosting', caption: 'SSL certificate included' },
      ],
      was: 'Separate bill',
      free: 'Free',
      finePrint: 'Included while your plan is active. Plans have a minimum term, explained in your proposal before you sign.',
    },
    greeting: 'Nice to meet you, {firstName}!',
    // `value` is what gets saved. 'Other' must match OTHER_BUSINESS_TYPE in
    // backend/src/leads/lead.schema.ts: it asks for a description, saved as "Other: <text>".
    businessTypes: [
      { value: 'Dental clinic', icon: 'tooth' },
      { value: 'Veterinary clinic', icon: 'paw' },
      { value: 'Aesthetic clinic', icon: 'mirror' },
      { value: 'Other', label: 'Other business', icon: 'store' },
    ],
    otherBusiness: { label: 'What type of business is it?', placeholder: 'For example: physiotherapy, salon, law office' },
    schedule: {
      timeZoneLabel: 'Your time zone',
      // {phStart}/{phEnd}: our hours (from the API). {start}/{end}: the same hours in the visitor's time zone.
      hours: 'We take calls from {phStart} to {phEnd} Philippine time. That is {start} to {end} for you.',
      timesFor: 'Available times on {day}',
      noTimes: 'No times left on this day. Please pick another date.',
      loadError: 'We could not load the available times.',
      retry: 'Try again',
      selected: 'Your call: {when}',
      booked: 'Booked',
      prevMonth: 'Previous month',
      nextMonth: 'Next month',
      periods: { night: 'Early morning', morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' },
    },
    // Goals and features: `key` is what gets saved. Same keys and labels as
    // backend/src/leads/lead-options.ts (the API only accepts those keys): change both together.
    // The 'other' goal asks for a description.
    goals: [
      { key: 'more-bookings', label: 'Get more appointments and bookings' },
      { key: 'never-miss-leads', label: 'Stop missing calls and leads' },
      { key: 'reduce-no-shows', label: 'Reduce no-shows' },
      { key: 'bring-clients-back', label: 'Bring past clients back' },
      { key: 'save-staff-time', label: 'Save staff time on admin work' },
      { key: 'new-website', label: 'Get a modern, professional website' },
      { key: 'rank-on-google', label: 'Show up higher on Google' },
      { key: 'more-reviews', label: 'Get more Google reviews' },
      { key: 'answer-24-7', label: 'Answer customer questions 24/7' },
      { key: 'automatic-follow-up', label: 'Follow up with leads automatically' },
      { key: 'custom-app', label: 'Build a custom web app or portal' },
      { key: 'clear-reports', label: "See clearly what's working" },
      { key: 'other', label: 'Something else' },
    ],
    otherGoal: { label: 'What else do you want to achieve?', placeholder: 'For example: open a second branch' },
    features: [
      { key: 'custom-website', label: 'Custom website design' },
      { key: 'domain-hosting', label: 'Free domain and hosting' },
      { key: 'online-booking', label: 'Online booking calendar' },
      { key: 'ai-chatbot', label: 'AI chatbot (website, Facebook, Instagram)' },
      { key: 'missed-call-text-back', label: 'Missed-call text-back' },
      { key: 'appointment-reminders', label: 'Appointment reminders' },
      { key: 'recall-campaigns', label: 'Patient and client recall campaigns' },
      { key: 'email-marketing', label: 'Email marketing and newsletters' },
      { key: 'review-requests', label: 'Google review requests' },
      { key: 'local-seo', label: 'Local SEO' },
      { key: 'crm-pipeline', label: 'CRM and lead pipeline' },
      { key: 'client-portal', label: 'Custom web app or client portal' },
      { key: 'workflow-automation', label: 'Custom workflow automation' },
      { key: 'reporting-dashboard', label: 'Reporting dashboard' },
      { key: 'integrations', label: 'Integrations with your current tools' },
    ],
    messagePlaceholder: 'Your tools, your timeline, or anything else on your mind.',
    nextLabel: 'Continue',
    backStepLabel: 'Back',
    submitLabel: 'Book my call',
    sendingLabel: 'Sending…',
    retryLabel: 'Try again',
    success: {
      title: 'Congratulations, {firstName}!',
      text: 'Your free consultation is booked. We will send the details to your email.',
      booked: '{when}',
      seconds: 8, // auto-return countdown
      returning: 'Taking you back to the website in {seconds}s',
      returnNow: 'Back to the website now',
      stay: 'Stay on this page',
      stayed: 'Take your time. Use the button whenever you are ready.',
    },
  },

  // The lead's private /manage-booking page (the Reschedule / Cancel link in their emails).
  // {firstName} and {when} are filled in by the page.
  manageBooking: {
    pageTitle: 'Manage your call | Byte Bun Tech',
    backLabel: 'Back to the website',
    eyebrow: 'Your free consultation',
    loading: 'Loading your booking…',
    greeting: 'Hi {firstName}, here is your call',
    noCallTitle: 'Hi {firstName}, you have no call booked',
    noCallText: 'Pick a time that suits you and we will send a new invite to your email.',
    pastTitle: 'Hi {firstName}, this call has already started',
    pastText: 'It can no longer be changed here. Need another one? Reply to any of our emails and we will set it up.',
    current: '{when}',
    emailNote: 'We email you a confirmation and an updated calendar invite after every change.',
    rescheduleLabel: 'Pick a new time',
    bookLabel: 'Book a new time',
    cancelLabel: 'Cancel my call',
    reschedule: {
      title: 'Choose a new time',
      subtitle: 'A 30-minute video call. Times are shown in your time zone.',
      currentLabel: 'Your current time:',
      submitLabel: 'Move my call',
      bookLabel: 'Book this time',
      backLabel: 'Keep my current time',
      backNoCallLabel: 'Back',
    },
    confirmCancel: {
      title: 'Cancel this call?',
      text: 'The time will be released for someone else. You can book a new one from this page whenever you are ready.',
      confirmLabel: 'Yes, cancel the call',
      keepLabel: 'No, keep it',
    },
    sendingLabel: 'Saving…',
    done: {
      rescheduled: 'Done! Your call has been moved. Check your email for the updated invite.',
      booked: 'Done! Your call is booked. Check your email for the invite.',
      cancelled: 'Your call is cancelled. We have emailed you a confirmation.',
    },
    invalid: {
      title: 'This link is not valid any more',
      text: 'Please use the link in your latest email from us, or simply reply to that email and we will help you.',
      homeLabel: 'Go to the website',
    },
    loadError: 'We could not load your booking.',
    retry: 'Try again',
  },
};
