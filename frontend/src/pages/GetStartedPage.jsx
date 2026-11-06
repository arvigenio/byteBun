import { useCallback, useEffect, useRef, useState } from 'react';
import { useLenis } from 'lenis/react';
import { useDispatch } from 'react-redux';
import { site } from '../content/site.js';
import { BonusStep } from '../components/BonusStep.jsx';
import { BookingCalendar } from '../components/BookingCalendar.jsx';
import { Confetti } from '../components/Confetti.jsx';
import { Logo } from '../components/Logo.jsx';
import { Container } from '../components/ui/Container.jsx';
import { Eyebrow } from '../components/ui/Section.jsx';
import { CheckDot, Icon } from '../components/ui/Icon.jsx';
import { useFocusWhen } from '../hooks/useFocusWhen.js';
import { useLeadFormController } from '../hooks/useLeadFormController.js';
import { formatWhen } from '../lib/calendar.js';
import { OTHER_BUSINESS_TYPE, OTHER_GOAL } from '../lib/leadSchema.js';
import { navigate, onRouteLinkClick, readLeadSource, routes } from '../lib/router.js';
import { fetchSlots, leadFormStarted } from '../store/leadFormSlice.js';

const g = site.getStarted;

// "{firstName}" -> the visitor's first name; without one, the placeholder and the comma
// before it are dropped ("How can we reach you?").
const fill = (text, firstName) => (firstName ? text.replaceAll('{firstName}', firstName) : text.replace(/,?\s*\{firstName\}/g, ''));
const delay = (ms) => ({ animationDelay: `${ms}ms` });
const stepTitle = (id) => g.steps.find((s) => s.id === id)?.title ?? '';

// The lead page: /get-started?from=<button>. A short multi-step form, then a congratulations
// screen that returns to the website on its own (or with a button).
export function GetStartedPage() {
  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(leadFormStarted(readLeadSource()));
    dispatch(fetchSlots()); // ready by the time they reach the calendar
  }, [dispatch]);

  useEffect(() => {
    const previous = document.title;
    document.title = g.pageTitle;
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="relative isolate min-h-dvh overflow-clip bg-cream-dough">
      <Backdrop />
      <header>
        <Container className="flex h-17 items-center justify-between gap-4 mobile:h-14">
          <a href={routes.home} onClick={onRouteLinkClick} aria-label="Byte Bun Tech, back to the website" className="flex min-h-11 flex-none items-center">
            <Logo className="h-7 w-auto mobile:h-6" />
          </a>
          <a
            href={routes.home}
            onClick={onRouteLinkClick}
            className="group inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted hover:text-byte-purple"
          >
            <Icon name="arrowLeft" className="size-4 transition-transform motion-safe:group-hover:-translate-x-1" strokeWidth={2.2} />
            {g.backLabel}
          </a>
        </Container>
      </header>
      <main id="top">
        <Container className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] items-start gap-10 pt-6 pb-20 mobile:gap-5 mobile:pt-2 mobile:pb-10">
          <Aside />
          <LeadPanel />
        </Container>
      </main>
    </div>
  );
}

// Soft drifting color shapes behind the page.
function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-clip">
      <div className="absolute -top-32 -left-24 size-[460px] rounded-full bg-lavender-mist blur-3xl motion-safe:animate-drift" />
      <div className="absolute top-1/3 -right-32 size-[420px] rounded-full bg-gold-tint blur-3xl motion-safe:animate-drift" style={{ animationDelay: '-5s' }} />
      <div className="absolute -bottom-40 left-1/4 size-[380px] rounded-full bg-circuit-teal/15 blur-3xl motion-safe:animate-drift" style={{ animationDelay: '-9s' }} />
    </div>
  );
}

function Aside() {
  const a = g.aside;
  return (
    <aside data-surface="dark" className="rounded-card bg-byte-purple p-10 text-lavender-mist motion-safe:animate-rise mobile:bg-transparent mobile:p-0">
      <Eyebrow className="text-honey-gold! mobile:text-soft-violet!">{a.eyebrow}</Eyebrow>
      <h1 className="text-[clamp(28px,3.4vw,40px)] text-cream-dough mobile:mb-0 mobile:text-byte-purple">{a.title}</h1>
      <div className="mobile:hidden">
        <p className="text-[17px]">{a.text}</p>
        <h2 className="mt-9 mb-4 text-base text-cream-dough">{a.nextTitle}</h2>
        <ol>
          {a.next.map((item, i) => (
            <li key={item} className="mb-4 flex items-center gap-3.5 motion-safe:animate-rise" style={delay(250 + i * 120)}>
              <span aria-hidden="true" className="grid size-8 flex-none place-items-center rounded-full bg-cream-dough/12 text-sm font-bold text-honey-gold">
                {i + 1}
              </span>
              {item}
            </li>
          ))}
        </ol>
        <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 border-t border-cream-dough/15 pt-6 text-sm font-medium">
          {a.reassurance.map((t) => (
            <li key={t} className="flex items-center gap-1.5">
              <CheckDot />
              {t}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function LeadPanel() {
  const c = useLeadFormController();
  return (
    <div className="rounded-card border border-line bg-lavender-mist p-8 motion-safe:animate-rise mobile:p-5" style={delay(120)}>
      {c.status === 'success' ? <LeadSuccess firstName={c.firstName} meetingAt={c.values.meetingAt} timeZone={c.values.timeZone} /> : <LeadForm c={c} />}
    </div>
  );
}

// ---- The form ----

function LeadForm({ c }) {
  const copy = g.steps[c.step];
  const formRef = useStepScroll(c.step);
  const buttonLabel = c.sending ? g.sendingLabel : !c.isLastStep ? (copy.nextLabel ?? g.nextLabel) : c.status === 'error' ? g.retryLabel : g.submitLabel;

  return (
    <form ref={formRef} noValidate onSubmit={c.onSubmit} aria-busy={c.sending} className="scroll-mt-4">
      <Progress step={c.step} count={c.stepCount} />

      <Shake nudge={c.nudge}>
        {/* `key` remounts the step so its slide-in animation plays on every change. */}
        <div key={c.step} className={c.direction === 'next' ? 'motion-safe:animate-step-next' : 'motion-safe:animate-step-prev'}>
          {copy.id !== 'bonus' && (
            <>
              <h2 className="text-2xl mobile:text-xl">{fill(copy.title, c.firstName)}</h2>
              <p className="mb-6 text-[15px] text-muted">{copy.subtitle}</p>
            </>
          )}
          {copy.id === 'business' && <BusinessStep c={c} />}
          {copy.id === 'goals' && <GoalsStep c={c} />}
          {copy.id === 'features' && <FeaturesStep c={c} />}
          {copy.id === 'bonus' && <BonusStep c={c} title={copy.title} />}
          {copy.id === 'name' && <NameStep c={c} />}
          {copy.id === 'schedule' && <BookingCalendar c={c} />}
          {copy.id === 'contact' && <ContactStep c={c} />}
        </div>
      </Shake>

      {/* Honeypot: hidden from people and screen readers; bots tend to fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={c.id('website')}>Leave this field empty</label>
        <input id={c.id('website')} {...c.register('website')} tabIndex={-1} autoComplete="off" />
      </div>

      {c.formError && (
        <p role="alert" className="mt-5 rounded-btn border border-danger/40 bg-gold-tint px-3 py-2 text-sm text-danger motion-safe:animate-rise">
          {c.formError}
        </p>
      )}

      <div className="mt-8 flex items-center justify-between gap-3 mobile:flex-col-reverse mobile:*:w-full">
        {c.step > 0 ? (
          <button
            type="button"
            onClick={c.back}
            // Keep focus where it is on mouse down: blurring an empty field would show its error,
            // and that message would push this button away before the click lands.
            onMouseDown={(e) => e.preventDefault()}
            className="group inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-btn px-4 text-[15px] font-semibold text-muted hover:text-byte-purple"
          >
            <Icon name="arrowLeft" className="size-4 transition-transform motion-safe:group-hover:-translate-x-1" strokeWidth={2.2} />
            {g.backStepLabel}
          </button>
        ) : (
          <span aria-hidden="true" />
        )}
        <button
          type="submit"
          disabled={c.sending}
          className="group inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-btn bg-bun-orange px-7 py-3 text-[15px] font-semibold text-midnight-plum transition-[background-color,transform] hover:bg-bun-orange-hover motion-safe:hover:-translate-y-px disabled:cursor-wait disabled:opacity-80"
        >
          {c.sending && <Spinner />}
          {buttonLabel}
          {!c.sending && (
            <Icon name={c.isLastStep ? 'sparkle' : 'arrowRight'} className="size-4 transition-transform motion-safe:group-hover:translate-x-1" strokeWidth={2.2} />
          )}
        </button>
      </div>
    </form>
  );
}

// On each new step, bring the top of the form back into view if it has scrolled off the top
// of the screen (phones: the Continue button is far down a long step).
function useStepScroll(step) {
  const ref = useRef(null);
  const lenis = useLenis();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current;
    const top = el?.getBoundingClientRect().top ?? 0;
    if (top >= 0) return;
    // Absolute target from the real scroll position (Lenis's own copy can lag behind native scrolls).
    const target = Math.max(0, window.scrollY + top - 16);
    if (lenis) lenis.scrollTo(target, { force: true });
    else window.scrollTo(0, target);
  }, [step, lenis]);
  return ref;
}

function Progress({ step, count }) {
  const label = `Step ${step + 1} of ${count}: ${g.steps[step].label}`;
  return (
    <div className="mb-7">
      <ol aria-hidden="true" className="mb-3 flex items-center justify-between gap-2">
        {g.steps.map((s, i) => (
          <li key={s.label} className={`flex items-center gap-2 text-[13px] font-semibold ${i <= step ? 'text-byte-purple' : 'text-muted'}`}>
            <span
              className={`grid size-7 flex-none place-items-center rounded-full text-xs font-bold transition-colors duration-300 ${
                i < step ? 'bg-circuit-teal text-midnight-plum' : i === step ? 'bg-byte-purple text-cream-dough' : 'border border-line bg-cream-dough'
              }`}
            >
              {i < step ? <Icon name="check" className="size-3.5 motion-safe:animate-pop" strokeWidth={3} /> : s.id === 'bonus' ? <Icon name="gift" className="size-3.5" strokeWidth={2.2} /> : i + 1}
            </span>
            {i === step && <span className="motion-safe:animate-rise">{s.label}</span>}
          </li>
        ))}
      </ol>
      <div className="h-2 overflow-hidden rounded-full bg-cream-dough">
        <div className="h-full rounded-full bg-bun-orange transition-[width] duration-500 ease-out" style={{ width: `${((step + 1) / count) * 100}%` }} />
      </div>
      <p aria-live="polite" className="sr-only">
        {label}
      </p>
    </div>
  );
}

// Shakes its children each time `nudge` goes up (a step that didn't pass validation).
function Shake({ nudge, children }) {
  const [shaking, setShaking] = useState(false);
  useEffect(() => {
    if (nudge > 0) setShaking(true);
  }, [nudge]);
  return (
    <div
      className={shaking ? 'motion-safe:animate-shake' : ''}
      onAnimationEnd={(e) => e.target === e.currentTarget && setShaking(false)}
    >
      {children}
    </div>
  );
}

function NameStep({ c }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4 mobile:grid-cols-1">
        <TextField c={c} name="firstName" label="First name" autoComplete="given-name" maxLength={50} />
        <TextField c={c} name="lastName" label="Last name" autoComplete="family-name" maxLength={50} />
      </div>
      {c.firstName && (
        <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-cream-dough px-4 py-2 text-[15px] font-semibold text-byte-purple motion-safe:animate-pop">
          <Icon name="sparkle" className="size-5 text-bun-orange" />
          {fill(g.greeting, c.firstName)}
        </p>
      )}
    </>
  );
}

function ContactStep({ c }) {
  return (
    <div className="grid gap-4">
      <TextField c={c} name="email" label="Email" type="email" autoComplete="email" maxLength={254} />
      <TextField c={c} name="phone" label="Phone" optional type="tel" autoComplete="tel" maxLength={40} />
    </div>
  );
}

function BusinessStep({ c }) {
  const error = c.errorFor('businessType');
  const errorId = `${c.id('businessType')}-error`;
  return (
    <div className="grid gap-5">
      <fieldset aria-describedby={error ? errorId : undefined}>
        <legend className="mb-2 text-sm font-semibold">Type of business</legend>
        <div className="grid grid-cols-2 gap-3 mobile:grid-cols-1">
          {g.businessTypes.map((t, i) => (
            <label
              key={t.value}
              className="group relative flex cursor-pointer flex-col items-center gap-2.5 rounded-xl border-2 border-line bg-cream-dough p-4 text-center text-sm font-semibold transition-[border-color,transform] hover:border-soft-violet has-checked:border-byte-purple has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-midnight-plum motion-safe:hover:-translate-y-0.5 motion-safe:animate-rise mobile:flex-row mobile:text-left"
              style={delay(80 + i * 70)}
            >
              <input type="radio" value={t.value} {...c.register('businessType')} aria-invalid={error ? true : undefined} className="sr-only" />
              <span className="grid size-11 flex-none place-items-center rounded-full bg-lavender-mist text-byte-purple transition-[background-color,color,transform] duration-300 group-has-checked:bg-byte-purple group-has-checked:text-circuit-teal motion-safe:group-has-checked:scale-110">
                <Icon name={t.icon} />
              </span>
              {t.label ?? t.value}
              <CheckDot className="absolute top-2 right-2 opacity-0 transition-opacity group-has-checked:opacity-100" />
            </label>
          ))}
        </div>
        {error && (
          <p id={errorId} className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
      </fieldset>
      {c.values.businessType === OTHER_BUSINESS_TYPE && (
        <div className="motion-safe:animate-rise">
          <TextField c={c} name="businessTypeOther" label={g.otherBusiness.label} placeholder={g.otherBusiness.placeholder} maxLength={70} />
        </div>
      )}
      <TextField c={c} name="businessName" label="Business name" optional autoComplete="organization" maxLength={160} />
    </div>
  );
}

// Required: at least one goal. "Something else" asks for a description.
function GoalsStep({ c }) {
  const otherChosen = c.values.goals?.includes(OTHER_GOAL);
  return (
    <div className="grid gap-5">
      <CheckboxGroup c={c} name="goals" legend={stepTitle('goals')} options={g.goals} variant="tiles" />
      {otherChosen && (
        <div className="motion-safe:animate-rise">
          <TextField c={c} name="goalsOther" label={g.otherGoal.label} placeholder={g.otherGoal.placeholder} maxLength={200} />
        </div>
      )}
    </div>
  );
}

// Optional: features they already know they want, plus an optional message.
function FeaturesStep({ c }) {
  return (
    <div className="grid gap-6">
      <CheckboxGroup c={c} name="features" legend={stepTitle('features')} options={g.features} variant="chips" />
      <div>
        <FieldLabel htmlFor={c.id('message')} label="Anything else we should know?" optional />
        <textarea {...c.field('message')} rows={3} maxLength={2000} placeholder={g.messagePlaceholder} className={inputClass} />
        <FieldError id={`${c.id('message')}-error`} error={c.errorFor('message')} />
      </div>
    </div>
  );
}

// Native checkboxes (one react-hook-form field holding an array of keys), styled as
// two-column tiles or wrapping chips. The legend repeats the step heading for screen readers.
function CheckboxGroup({ c, name, legend, options, variant }) {
  const error = c.errorFor(name);
  const errorId = `${c.id(name)}-error`;
  const tiles = variant === 'tiles';
  return (
    <fieldset aria-describedby={error ? errorId : undefined}>
      <legend className="sr-only">{legend}</legend>
      <div className={tiles ? 'grid grid-cols-2 gap-2.5 mobile:grid-cols-1' : 'flex flex-wrap gap-2'}>
        {options.map((o, i) => (
          <label
            key={o.key}
            className={`group relative flex cursor-pointer items-center gap-2.5 border-2 border-line bg-cream-dough text-sm font-semibold text-byte-purple transition-[background-color,border-color,color,transform] hover:border-soft-violet has-checked:border-byte-purple has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-midnight-plum motion-safe:animate-rise motion-safe:active:scale-[0.98] ${
              tiles ? 'min-h-12 rounded-xl px-3.5 py-2.5 has-checked:bg-lavender-mist' : 'min-h-11 rounded-full px-4 has-checked:bg-byte-purple has-checked:text-cream-dough'
            }`}
            style={delay(40 + Math.min(i, 12) * 35)}
          >
            <input type="checkbox" value={o.key} {...c.register(name)} aria-invalid={error ? true : undefined} className="sr-only" />
            {tiles ? (
              <span
                aria-hidden="true"
                className="grid size-5 flex-none place-items-center rounded-md border-2 border-line bg-cream-dough text-transparent transition-colors group-has-checked:border-circuit-teal group-has-checked:bg-circuit-teal group-has-checked:text-midnight-plum"
              >
                <Icon name="check" className="size-3.5" strokeWidth={3} />
              </span>
            ) : (
              <Icon name="check" className="hidden size-4 text-circuit-teal group-has-checked:block motion-safe:group-has-checked:animate-pop" strokeWidth={3} />
            )}
            {o.label}
          </label>
        ))}
      </div>
      {error && (
        <p id={errorId} className="mt-2 text-sm text-danger motion-safe:animate-rise">
          {error}
        </p>
      )}
    </fieldset>
  );
}

// ---- Success ----

function LeadSuccess({ firstName, meetingAt, timeZone }) {
  const s = g.success;
  const [seconds, setSeconds] = useState(s.seconds);
  const [stayed, setStayed] = useState(false);
  const titleRef = useFocusWhen(true); // announce the confirmation to screen readers
  const goHome = useCallback(() => navigate(routes.home, { replace: true }), []);

  useEffect(() => {
    if (stayed) return undefined;
    if (seconds <= 0) {
      goHome();
      return undefined;
    }
    const timer = setTimeout(() => setSeconds((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds, stayed, goHome]);

  return (
    <div className="py-6 text-center mobile:py-2">
      <Confetti />
      <div className="mx-auto grid size-20 place-items-center rounded-full bg-byte-purple text-circuit-teal motion-safe:animate-pop">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-10" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 12.5 4.5 4.5L19 7.5" pathLength="1" strokeDasharray="1" className="motion-safe:animate-draw" />
        </svg>
      </div>
      <h2 ref={titleRef} tabIndex={-1} className="mt-6 text-[clamp(26px,3.4vw,34px)] motion-safe:animate-rise" style={delay(150)}>
        {fill(s.title, firstName)}
      </h2>
      <p className="mx-auto max-w-[40ch] text-[17px] text-muted motion-safe:animate-rise" style={delay(250)}>
        {s.text}
      </p>
      {meetingAt && (
        <p
          className="mx-auto mt-5 inline-flex items-center gap-2.5 rounded-xl bg-byte-purple px-5 py-3 text-[15px] font-semibold text-cream-dough motion-safe:animate-pop"
          style={delay(450)}
        >
          <Icon name="calendar" className="size-5 flex-none text-circuit-teal" strokeWidth={2} />
          {s.booked.replace('{when}', formatWhen(meetingAt, timeZone))}
        </p>
      )}

      <div className="mt-8 flex flex-col items-center gap-4 motion-safe:animate-rise" style={delay(350)}>
        {stayed ? (
          <p className="text-sm text-muted">{s.stayed}</p>
        ) : (
          <div className="flex items-center gap-3 text-sm font-semibold text-muted">
            <span className="relative grid size-10 place-items-center" aria-hidden="true">
              <svg viewBox="0 0 40 40" className="absolute inset-0 size-10 -rotate-90">
                <circle cx="20" cy="20" r="17" fill="none" strokeWidth="3" className="stroke-line" />
                <circle
                  cx="20"
                  cy="20"
                  r="17"
                  fill="none"
                  strokeWidth="3"
                  strokeLinecap="round"
                  pathLength="1"
                  strokeDasharray="1"
                  className="stroke-bun-orange motion-safe:animate-countdown"
                  style={{ animationDuration: `${s.seconds}s` }}
                />
              </svg>
              <span className="text-byte-purple">{seconds}</span>
            </span>
            <span aria-hidden="true">{s.returning.replace('{seconds}', seconds)}</span>
            <span className="sr-only">{s.returning.replace('{seconds}', s.seconds)}</span>
          </div>
        )}
        <div className="flex flex-wrap justify-center gap-3 mobile:w-full mobile:flex-col">
          <button
            type="button"
            onClick={goHome}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-btn bg-bun-orange px-6 py-3 text-[15px] font-semibold text-midnight-plum hover:bg-bun-orange-hover"
          >
            <Icon name="arrowLeft" className="size-4" strokeWidth={2.2} />
            {s.returnNow}
          </button>
          {!stayed && (
            <button
              type="button"
              onClick={() => setStayed(true)}
              className="min-h-11 cursor-pointer rounded-btn border-2 border-byte-purple px-6 py-3 text-[15px] font-semibold text-byte-purple hover:bg-cream-dough"
            >
              {s.stay}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Presentational pieces ----

const inputClass =
  'block min-h-11 w-full rounded-btn border border-line bg-cream-dough px-3 py-2 text-base text-midnight-plum transition-[border-color,box-shadow] placeholder:text-muted/70 focus:border-soft-violet focus:ring-4 focus:ring-soft-violet/20 focus-visible:outline-soft-violet aria-[invalid=true]:border-danger';

function TextField({ c, name, label, optional, type = 'text', autoComplete, maxLength, placeholder }) {
  return (
    <div>
      <FieldLabel htmlFor={c.id(name)} label={label} optional={optional} />
      <div className="relative">
        <input {...c.field(name)} type={type} autoComplete={autoComplete} maxLength={maxLength} placeholder={placeholder} className={`${inputClass} pr-10`} />
        {c.isValid(name) && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
            <CheckDot className="motion-safe:animate-pop" />
          </span>
        )}
      </div>
      <FieldError id={`${c.id(name)}-error`} error={c.errorFor(name)} />
    </div>
  );
}

function FieldLabel({ htmlFor, label, optional }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-semibold">
      {label} {optional && <span className="font-normal text-muted">(optional)</span>}
    </label>
  );
}

function FieldError({ id, error }) {
  if (!error) return null;
  return (
    <p id={id} className="mt-1 text-sm text-danger motion-safe:animate-rise">
      {error}
    </p>
  );
}

function Spinner() {
  return <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-midnight-plum/30 border-t-midnight-plum motion-reduce:animate-none" />;
}
