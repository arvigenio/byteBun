import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { site } from '../../content/site.js';
import { SmoothScroll } from '../../components/SmoothScroll.jsx';
import { useConfigQuery } from '../api.js';
import { inkOn } from '../lib/color.js';
import { signInUrl } from '../lib/surface.js';
import { Icon, ICONS } from '../ui.jsx';

// bookings.bytebuntech.com for visitors who aren't signed in: what Byte Bun Bookings does, an
// interactive demo, and pricing (Free and Bookings Pro, from site.packages). Signing up starts
// from the buttons here; signed-in people never see this page (BookingsHome sends them to /app).
//
// Motion: Lenis smooth scrolling (same as bytebuntech.com), scroll reveals (data-reveal), a
// scroll progress bar, a fill-as-you-scroll steps line and a light hero parallax. People who
// prefer reduced motion get the same page, still (client.css and Lenis both honor it).

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** data-reveal elements animate in the first time they scroll into view. */
function useReveal() {
  useLayoutEffect(() => {
    if (!('IntersectionObserver' in window)) return undefined;
    const root = document.documentElement;
    root.classList.add('reveal-ready');
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    document.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      root.classList.remove('reveal-ready');
    };
  }, []);
}

/** 0..1: how far the page (or an element's range) has scrolled. */
function useScrollValue(compute) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setV(compute());
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

const clamp01 = (n) => Math.min(1, Math.max(0, n));

const FEATURES = [
  { icon: ICONS.calendar, title: 'Your own booking page', text: 'A clean page at bookings.bytebuntech.com/your-business. Customers pick a service and a time in seconds, on any phone.' },
  { icon: ICONS.clock, title: 'Hours that fit your business', text: 'Opening hours per weekday, lunch breaks, slot length, buffers between visits, daily limits and holidays.' },
  { icon: ICONS.check, title: 'Never double-booked', text: 'Every booking is checked and saved in one step, so two people can never take the same last place.' },
  { icon: ICONS.list, title: 'Reminders that cut no-shows', text: 'Automatic email reminders 2 days and 1 day before, each with links to reschedule or cancel.' },
  { icon: ICONS.phone, title: 'Changes without phone calls', text: 'Customers reschedule or cancel from their own private link. Close to the appointment, they’re asked to call you.' },
  { icon: ICONS.users, title: 'Your whole team', text: 'Invite staff as owner, admin or staff. Everyone sees the schedule; only the right people change settings.' },
  { icon: ICONS.palette, title: 'Your brand', text: 'Your logo, colors and instructions on the page and in every email. Private details only go to people who booked.' },
  { icon: ICONS.grid, title: 'Works like an app', text: 'Add it to your phone’s home screen and check today’s bookings in one tap.' },
];

const SIDES = {
  customers: {
    label: 'For your customers',
    points: ['Book in under a minute, day or night', 'Confirmation with Google, Apple and Outlook calendar links', 'Reminders before the visit', 'Reschedule or cancel without calling', 'Directions or the meeting link, right in the email'],
  },
  team: {
    label: 'For your team',
    points: ['Today’s and upcoming bookings at a glance', 'Add bookings taken by phone', 'Block holidays and see who is affected', 'Alerts for new, moved and cancelled bookings', 'Mark no-shows and send a “we missed you” email'],
  },
};

const STEPS = [
  { title: 'Sign up free', text: 'Enter your email and we send a code. No password, no card.' },
  { title: 'Add your services and hours', text: 'Consultation, 30 minutes. Full session, 60 minutes. Monday to Friday, 9 to 5, lunch at 12.' },
  { title: 'Share your link', text: 'On your website, Google profile, Facebook and Instagram. Bookings start coming in.' },
];

const FAQ = [
  { q: 'Is it really free?', a: 'Yes. The Free plan includes up to 100 bookings a month and 5 services, email confirmations and reminders, and your own booking page, with no card needed.' },
  { q: 'What happens after 100 bookings in a month?', a: 'Your page shows that online booking is full for the month until the 1st, and you get an email at 80 and 100. Bookings Pro removes the limit.' },
  { q: 'Do my customers need an account?', a: 'No. They book with their name and email, and manage their booking from the private link in their confirmation.' },
  { q: 'What kind of business can use it?', a: 'Any business that takes appointments or reservations: salons, studios, coaches, tutors, consultants, repair and cleaning services, clinics and more. Services can have their own duration and buffer, several people can book the same slot, and you set breaks and holidays.' },
  { q: 'What happens to old bookings on the Free plan?', a: 'They are deleted 60 days after the appointment date. You get an email a week before with a CSV download. On Bookings Pro, your history is kept.' },
  { q: 'Can I upgrade later?', a: 'Yes, anytime, and you keep everything you’ve set up.' },
];

/** The hero's interactive demo: pick a service, a time, confirm. It plays itself until touched. */
function BookingDemo() {
  const services = [
    ['Consultation', '30 min'],
    ['Full session', '60 min'],
    ['Quick visit', '15 min'],
  ];
  const times = ['9:00 AM', '9:45 AM', '10:30 AM', '1:15 PM', '2:00 PM', '3:30 PM'];
  const [step, setStep] = useState(0); // 0 service, 1 time, 2 confirmed
  const [service, setService] = useState(0);
  const [time, setTime] = useState(1);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (touched || reducedMotion()) return undefined;
    const t = setTimeout(() => {
      if (step === 0) {
        setService((s) => (s + 1) % services.length);
        setStep(1);
      } else if (step === 1) {
        setTime((t2) => (t2 + 2) % times.length);
        setStep(2);
      } else setStep(0);
    }, step === 2 ? 2600 : 2000);
    return () => clearTimeout(t);
  }, [step, touched]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = (fn) => () => {
    setTouched(true);
    fn();
  };

  return (
    <div className="relative w-full max-w-sm rounded-[22px] border border-line bg-surface p-5 shadow-[0_30px_60px_-20px_rgba(15,118,110,0.35)]" aria-label="Try a sample booking">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-brand text-sm font-bold text-brand-ink">NS</span>
        <div>
          <p className="font-semibold leading-tight">Northside Studio</p>
          <p className="text-xs text-faint">Sample booking page</p>
        </div>
        <span className="ml-auto rounded-full bg-sunken px-2 py-0.5 text-[11px] font-semibold text-muted">demo</span>
      </div>

      {step < 2 ? (
        <div key={`s${step}`} className="fade-swap">
          <p className="mb-2 text-xs font-semibold tracking-wide text-faint uppercase">{step === 0 ? '1. Choose a service' : '2. Choose a time · Thu, Dec 3'}</p>
          {step === 0 ? (
            <div className="flex flex-col gap-2">
              {services.map(([name, len], i) => (
                <button
                  key={name}
                  type="button"
                  onClick={act(() => {
                    setService(i);
                    setStep(1);
                  })}
                  className={`flex cursor-pointer items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-sm transition ${i === service ? 'border-brand bg-brand-soft' : 'border-line hover:border-brand'}`}
                >
                  <span className="font-medium">{name}</span>
                  <span className="text-faint">{len}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {times.map((t, i) => (
                <button
                  key={t}
                  type="button"
                  onClick={act(() => {
                    setTime(i);
                    setStep(2);
                  })}
                  className={`cursor-pointer rounded-xl border px-2 py-2 text-[13px] font-medium transition ${i === time ? 'border-brand bg-brand text-brand-ink' : 'border-line hover:border-brand'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div key="done" className="fade-swap py-3 text-center">
          <span className="pop-in mx-auto grid size-14 place-items-center rounded-full bg-brand text-brand-ink">
            <Icon d={ICONS.check} className="size-7" />
          </span>
          <p className="mt-3 text-lg font-bold">You’re booked!</p>
          <p className="text-sm text-muted">
            {services[service][0]} · Thu, Dec 3 · {times[time]}
          </p>
          <p className="mt-2 text-xs text-faint">Confirmation and reminders sent by email</p>
          <button type="button" onClick={act(() => setStep(0))} className="mt-3 cursor-pointer text-sm font-medium text-brand underline">
            Try again
          </button>
        </div>
      )}

      <div className="mt-5 flex gap-1.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${i <= step ? 'bg-brand' : 'bg-sunken'}`} />
        ))}
      </div>
    </div>
  );
}

function Header({ start, signIn }) {
  const scrolled = useScrollValue(() => (window.scrollY > 8 ? 1 : 0));
  const progress = useScrollValue(() => clamp01(window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight)));
  return (
    <header className={`fixed inset-x-0 top-0 z-30 transition-[background-color,box-shadow] duration-300 ${scrolled ? 'bg-surface/90 shadow-[0_1px_0_var(--color-line)] backdrop-blur' : 'bg-transparent'}`}>
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
        <a href="#top" className="flex items-center gap-2.5 font-semibold">
          <img src="/client/bookings-icon.svg" alt="" className="size-8 rounded-lg" />
          Byte Bun Bookings
        </a>
        <nav className="ml-6 flex gap-5 text-sm text-muted mobile:hidden" aria-label="Sections">
          <a className="hover:text-ink" href="#features">
            Features
          </a>
          <a className="hover:text-ink" href="#how">
            How it works
          </a>
          <a className="hover:text-ink" href="#pricing">
            Pricing
          </a>
          <a className="hover:text-ink" href="#faq">
            FAQ
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <a href={signIn} className="rounded-btn px-3 py-2 text-sm font-medium text-muted hover:text-ink mobile:hidden">
            Sign in
          </a>
          <a href={start} className="rounded-btn bg-brand px-4 py-2 text-sm font-semibold text-brand-ink transition hover:brightness-110">
            Start free
          </a>
        </div>
      </div>
      <div className="h-0.5 origin-left bg-brand transition-transform duration-75" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />
    </header>
  );
}

function Pricing({ start }) {
  const p = site.packages;
  const plans = p.plans.filter((x) => x.name === 'Free' || x.name === 'Bookings Pro');
  const [yearly, setYearly] = useState(false);
  return (
    <section id="pricing" className="scroll-mt-20 px-4 py-24 mobile:py-16">
      <div className="mx-auto max-w-4xl">
        <div data-reveal="up" className="text-center">
          <p className="text-sm font-semibold tracking-wider text-brand uppercase">Pricing</p>
          <h2 className="mt-2 text-4xl font-bold tracking-tight mobile:text-3xl">Free to start. Upgrade when you grow.</h2>
          <p className="mt-3 text-muted">Prices in USD. No card needed for Free.</p>
        </div>
        <div data-reveal="up" className="mt-8 flex justify-center">
          <div role="radiogroup" aria-label="Billing period" className="inline-flex gap-1 rounded-full border border-line bg-surface p-1">
            {[
              [false, p.billing.monthly],
              [true, p.billing.yearly],
            ].map(([y, label]) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={yearly === y}
                onClick={() => setYearly(y)}
                className={`cursor-pointer rounded-full px-4 py-2 text-sm font-semibold transition ${yearly === y ? 'bg-brand text-brand-ink' : 'text-muted hover:text-ink'}`}
              >
                {label}
                {y && <span className="ml-2 rounded-full bg-accent/20 px-2 py-0.5 text-xs text-ink">{p.billing.yearlyNote}</span>}
              </button>
            ))}
          </div>
        </div>
        <div data-reveal="stagger" className="mt-10 grid gap-6 desktop:grid-cols-2">
          {plans.map((plan, i) => {
            const pro = i === 1;
            const price = yearly ? plan.price.yearly : plan.price.monthly;
            return (
              <div key={plan.name} className={`relative flex flex-col rounded-[20px] border bg-surface p-7 transition-transform duration-300 hover:-translate-y-1 ${pro ? 'border-brand shadow-[0_24px_50px_-24px_rgba(15,118,110,0.5)]' : 'border-line'}`}>
                {pro && <span className="absolute -top-3 left-7 rounded-full bg-brand px-3 py-1 text-xs font-bold text-brand-ink">For growing businesses</span>}
                <h3 className="text-xl font-bold">{plan.name}</h3>
                <p className="mt-3 text-5xl font-bold tracking-tight">
                  <span key={price} className="fade-swap inline-block">
                    {price}
                  </span>
                  <span className="text-base font-medium text-faint"> {yearly && price !== '$0' ? '/year' : '/month'}</span>
                </p>
                <p className="mt-2 text-muted">{plan.blurb}</p>
                <ul className="mt-6 mb-8 flex flex-col gap-2.5 text-[15px]">
                  {plan.features.map((f) => (
                    <li key={f} className="flex gap-3">
                      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
                        <Icon d={ICONS.check} className="size-3.5" />
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
                <a href={start} className={`mt-auto rounded-btn px-5 py-3 text-center font-semibold transition ${pro ? 'bg-brand text-brand-ink hover:brightness-110' : 'border border-line-strong hover:bg-sunken'}`}>
                  {pro ? 'Start free, upgrade anytime' : 'Start free'}
                </a>
              </div>
            );
          })}
        </div>
        <p data-reveal="up" className="mt-8 text-center text-sm text-muted">
          Want a website, AI chatbots and marketing done for you?{' '}
          <a href="https://bytebuntech.com/#packages" className="font-semibold text-brand underline">
            See Premium and Growth
          </a>
        </p>
        <p className="mt-3 text-center text-xs text-faint">{p.footnotes[0]}</p>
      </div>
    </section>
  );
}

export function BookingsLanding() {
  const { data: cfg } = useConfigQuery();
  const start = cfg ? signInUrl(cfg, `${cfg.bookingsUrl}/app`) : '/sign-in';
  useReveal();
  useEffect(() => {
    document.title = 'Byte Bun Bookings · Free online booking for your business';
  }, []);

  const heroShift = useScrollValue(() => Math.min(window.scrollY, 600));
  const [side, setSide] = useState('customers');
  const stepsRef = useRef(null);
  const stepsFill = useScrollValue(() => {
    const el = stepsRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return clamp01((window.innerHeight * 0.7 - r.top) / r.height);
  });
  const motion = !reducedMotion();
  const brand = '#0F766E';

  return (
    <SmoothScroll>
      <div id="top" className="min-h-screen overflow-x-clip bg-canvas text-ink">
        <Header start={start} signIn={cfg ? signInUrl(cfg, `${cfg.bookingsUrl}/app`) : '/sign-in'} />

        {/* Hero */}
        <section className="relative px-4 pt-32 pb-24 mobile:pt-24 mobile:pb-16">
          <div className="blob pointer-events-none absolute -top-24 -left-24 size-[420px] rounded-full bg-brand/15 blur-3xl" aria-hidden="true" style={motion ? { translate: `0 ${heroShift * 0.25}px` } : undefined} />
          <div className="blob pointer-events-none absolute top-40 -right-24 size-[360px] rounded-full bg-accent/20 blur-3xl" aria-hidden="true" style={motion ? { translate: `0 ${heroShift * -0.15}px` } : undefined} />
          <div className="relative mx-auto grid max-w-6xl items-center gap-14 desktop:grid-cols-[1.1fr_1fr]">
            <div data-reveal="left">
              <span className="inline-flex items-center gap-2 rounded-full border border-brand/25 bg-brand-soft px-3 py-1 text-sm font-medium text-brand">
                <span className="size-2 rounded-full bg-brand" /> Free for up to 100 bookings a month
              </span>
              <h1 className="mt-5 text-5xl leading-[1.05] font-bold tracking-tight mobile:text-[38px]">
                Online booking your customers <span className="text-brand">actually use.</span>
              </h1>
              <p className="mt-5 max-w-xl text-lg text-muted">
                Your own booking page, automatic reminders and easy rescheduling, for any business that takes appointments. Set it up in minutes and share your link today.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href={start} className="rounded-btn bg-brand px-6 py-3.5 font-semibold text-brand-ink shadow-lg shadow-brand/25 transition hover:-translate-y-0.5 hover:brightness-110">
                  Start free
                </a>
                <a href="#features" className="rounded-btn border border-line-strong bg-surface px-6 py-3.5 font-semibold transition hover:bg-sunken">
                  See how it works
                </a>
              </div>
              <p className="mt-4 text-sm text-faint">No password and no card. Just your email.</p>
            </div>
            <div data-reveal="right" className="flex justify-center">
              <div className={motion ? 'float-slow w-full max-w-sm' : 'w-full max-w-sm'}>
                <BookingDemo />
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="scroll-mt-20 bg-surface px-4 py-24 mobile:py-16">
          <div className="mx-auto max-w-6xl">
            <div data-reveal="up" className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold tracking-wider text-brand uppercase">Features</p>
              <h2 className="mt-2 text-4xl font-bold tracking-tight mobile:text-3xl">Everything you need to take bookings</h2>
              <p className="mt-3 text-muted">Fewer phone calls, fewer no-shows, and a schedule that fills itself.</p>
            </div>
            <div data-reveal="stagger" className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((f) => (
                <div key={f.title} className="group rounded-[18px] border border-line bg-canvas p-6 transition duration-300 hover:-translate-y-1 hover:border-brand/40 hover:shadow-[0_20px_40px_-24px_rgba(15,118,110,0.45)]">
                  <span className="grid size-11 place-items-center rounded-xl bg-brand-soft text-brand transition group-hover:scale-110 group-hover:bg-brand group-hover:text-brand-ink">
                    <Icon d={f.icon} />
                  </span>
                  <h3 className="mt-4 font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-sm text-muted">{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Customers / team */}
        <section className="px-4 py-24 mobile:py-16">
          <div className="mx-auto grid max-w-5xl items-center gap-12 desktop:grid-cols-2">
            <div data-reveal="left">
              <h2 className="text-4xl font-bold tracking-tight mobile:text-3xl">Easier for everyone</h2>
              <p className="mt-3 text-muted">Customers book when it suits them. Your team spends less time on the phone.</p>
              <div role="tablist" className="mt-6 inline-flex gap-1 rounded-full bg-sunken p-1">
                {Object.entries(SIDES).map(([k, s]) => (
                  <button key={k} type="button" role="tab" aria-selected={side === k} onClick={() => setSide(k)} className={`cursor-pointer rounded-full px-4 py-2 text-sm font-semibold transition ${side === k ? 'bg-surface text-ink shadow-sm' : 'text-muted'}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div data-reveal="right">
            <ul key={side} className="flex flex-col gap-3" role="tabpanel">
              {SIDES[side].points.map((pt, i) => (
                <li key={pt} className="fade-swap flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5" style={{ animationDelay: `${i * 70}ms` }}>
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand text-brand-ink">
                    <Icon d={ICONS.check} className="size-4" />
                  </span>
                  {pt}
                </li>
              ))}
            </ul>
            </div>
          </div>
        </section>

        {/* Reminders timeline */}
        <section className="bg-surface px-4 py-24 mobile:py-16">
          <div className="mx-auto max-w-5xl text-center">
            <h2 data-reveal="up" className="text-4xl font-bold tracking-tight mobile:text-3xl">
              Reminders on autopilot
            </h2>
            <p data-reveal="up" className="mx-auto mt-3 max-w-xl text-muted">
              Every booking gets its confirmation and reminders, each with a one-click link to reschedule or cancel, so empty slots get refilled.
            </p>
            <ol data-reveal="stagger" className="mt-12 grid gap-4 text-left desktop:grid-cols-4">
              {[
                ['Booked', 'Confirmation with calendar links'],
                ['2 days before', 'Email reminder'],
                ['1 day before', 'Email reminder'],
                ['Appointment', 'Your customer shows up on time'],
              ].map(([when, what], i) => (
                <li key={when} className="relative rounded-[18px] border border-line bg-canvas p-5">
                  <span className="text-xs font-bold tracking-wider text-brand uppercase">Step {i + 1}</span>
                  <p className="mt-1 font-semibold">{when}</p>
                  <p className="text-sm text-muted">{what}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-20 px-4 py-24 mobile:py-16">
          <div className="mx-auto max-w-3xl">
            <h2 data-reveal="up" className="text-center text-4xl font-bold tracking-tight mobile:text-3xl">
              Live in three steps
            </h2>
            <div ref={stepsRef} className="relative mt-14 pl-12">
              <div className="absolute top-2 bottom-2 left-[19px] w-0.5 rounded bg-line" aria-hidden="true">
                <div className="w-full origin-top rounded bg-brand" style={{ height: '100%', transform: `scaleY(${stepsFill})` }} />
              </div>
              {STEPS.map((s, i) => (
                <div key={s.title} data-reveal="up" className="relative pb-12 last:pb-0">
                  <span
                    className={`absolute top-0 -left-12 grid size-10 place-items-center rounded-full border-2 font-bold transition-colors duration-500 ${stepsFill > (i + 0.3) / STEPS.length ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface text-muted'}`}
                  >
                    {i + 1}
                  </span>
                  <h3 className="text-xl font-semibold">{s.title}</h3>
                  <p className="mt-1 text-muted">{s.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <Pricing start={start} />

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 bg-surface px-4 py-24 mobile:py-16">
          <div className="mx-auto max-w-3xl">
            <h2 data-reveal="up" className="text-center text-4xl font-bold tracking-tight mobile:text-3xl">
              Questions
            </h2>
            <div data-reveal="stagger" className="mt-10 flex flex-col gap-3">
              {FAQ.map((f) => (
                <details key={f.q} className="group rounded-2xl border border-line bg-canvas px-5 py-4 open:bg-surface open:shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                    {f.q}
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft text-brand transition-transform duration-300 group-open:rotate-45" aria-hidden="true">
                      +
                    </span>
                  </summary>
                  <p className="fade-swap mt-3 text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="px-4 pt-24 pb-16 mobile:pt-16 mobile:pb-10">
          <div data-reveal="zoom" className="relative mx-auto max-w-5xl overflow-hidden rounded-[28px] px-8 py-16 text-center mobile:px-5 mobile:py-12" style={{ background: brand, color: inkOn(brand) }}>
            <div className="blob pointer-events-none absolute -right-20 -bottom-20 size-72 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
            <h2 className="relative text-4xl font-bold tracking-tight mobile:text-3xl">Your booking page could be live in 10 minutes</h2>
            <p className="relative mx-auto mt-3 max-w-xl opacity-90">Start free. Upgrade only when you need unlimited bookings.</p>
            <a href={start} className="relative mt-8 inline-block rounded-btn bg-white px-7 py-3.5 font-semibold text-[#0F766E] transition hover:-translate-y-0.5">
              Create my booking page
            </a>
          </div>
        </section>

        <footer className="border-t border-line px-4 py-4 text-xs text-faint">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <span className="flex items-center gap-1.5">
              <img src="/client/bookings-icon.svg" alt="" className="size-4 rounded" /> Byte Bun Bookings by{' '}
              <a href="https://bytebuntech.com" className="underline hover:text-ink">
                Byte Bun Tech
              </a>
            </span>
            <span>Prices in USD</span>
          </div>
        </footer>
      </div>
    </SmoothScroll>
  );
}
