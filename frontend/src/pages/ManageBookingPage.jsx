import { site } from '../content/site.js';
import { BookingCalendar } from '../components/BookingCalendar.jsx';
import { Logo } from '../components/Logo.jsx';
import { Container } from '../components/ui/Container.jsx';
import { Eyebrow } from '../components/ui/Section.jsx';
import { Icon } from '../components/ui/Icon.jsx';
import { useManageBooking } from '../hooks/useManageBooking.js';
import { formatWhen } from '../lib/calendar.js';
import { onRouteLinkClick, routes } from '../lib/router.js';
import { Backdrop, Spinner } from './GetStartedPage.jsx';

const t = site.manageBooking;
const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');

// /manage-booking#t=<token>: the lead's private page to reschedule or cancel their call,
// linked from every email about it (backend/src/booking/manage-link.ts). Not indexed.
export function ManageBookingPage() {
  const m = useManageBooking();
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
            {t.backLabel}
          </a>
        </Container>
      </header>
      <main id="top">
        <Container className="pt-6 pb-20 mobile:pt-2 mobile:pb-10">
          <div ref={m.cardRef} aria-busy={m.status === 'loading' || m.sending} className="mx-auto max-w-160 scroll-mt-4 rounded-card border border-line bg-lavender-mist p-8 motion-safe:animate-rise mobile:p-5">
            <Card m={m} />
          </div>
        </Container>
      </main>
    </div>
  );
}

function Card({ m }) {
  if (m.status === 'idle' || m.status === 'loading') return <Loading />;
  if (m.status === 'invalid') return <InvalidLink m={m} />;
  if (m.status === 'error') return <LoadError m={m} />;
  if (m.mode === 'reschedule') return <Reschedule m={m} />;
  if (m.mode === 'confirmCancel') return <ConfirmCancel m={m} />;
  return <Overview m={m} />;
}

function Heading({ m, children }) {
  return (
    <h1 ref={m.headingRef} tabIndex={-1} className="text-[clamp(24px,3vw,32px)] outline-none">
      {children}
    </h1>
  );
}

// ---- The call, and what can be done with it ----

function Overview({ m }) {
  const { booking, canChange, firstName } = m;
  const title = !booking ? t.noCallTitle : canChange ? t.greeting : t.pastTitle;
  return (
    <div className="motion-safe:animate-rise">
      {m.done && <DoneBanner done={m.done} />}
      <Eyebrow>{t.eyebrow}</Eyebrow>
      <Heading m={m}>{fill(title, { firstName })}</Heading>

      {booking ? (
        <p className={`mt-5 flex items-center gap-2.5 rounded-xl px-4 py-3 text-[15px] font-semibold ${canChange ? 'bg-byte-purple text-cream-dough' : 'bg-cream-dough text-muted'}`}>
          <Icon name="calendar" className={`size-5 flex-none ${canChange ? 'text-circuit-teal' : ''}`} strokeWidth={2} />
          {fill(t.current, { when: formatWhen(booking.startsAt, m.timeZone) })}
        </p>
      ) : (
        <p className="mt-2 text-[15px] text-muted">{t.noCallText}</p>
      )}
      {booking && !canChange && <p className="mt-4 text-[15px] text-muted">{t.pastText}</p>}

      <ActionError m={m} />

      {canChange && (
        <>
          <div className="mt-7 flex flex-wrap gap-3 mobile:flex-col">
            <PrimaryButton onClick={() => m.setMode('reschedule')}>
              <Icon name="clock" className="size-4" strokeWidth={2.2} />
              {booking ? t.rescheduleLabel : t.bookLabel}
            </PrimaryButton>
            {booking && <SecondaryButton onClick={() => m.setMode('confirmCancel')}>{t.cancelLabel}</SecondaryButton>}
          </div>
          <p className="mt-5 flex items-start gap-2 text-sm text-muted">
            <Icon name="mail" className="mt-0.5 size-4 flex-none text-soft-violet" strokeWidth={2} />
            {t.emailNote}
          </p>
        </>
      )}
    </div>
  );
}

function DoneBanner({ done }) {
  return (
    <p role="status" className="mb-6 flex items-start gap-2.5 rounded-xl border border-circuit-teal/50 bg-cream-dough px-4 py-3 text-[15px] font-semibold text-byte-purple motion-safe:animate-pop">
      <Icon name="check" className="mt-0.5 size-5 flex-none text-circuit-teal" strokeWidth={2.6} />
      {t.done[done]}
    </p>
  );
}

// ---- Pick a new time ----

function Reschedule({ m }) {
  const r = t.reschedule;
  const hasCall = Boolean(m.booking);
  return (
    <form noValidate onSubmit={m.onSubmit} aria-busy={m.sending} className="motion-safe:animate-step-next">
      <Heading m={m}>{r.title}</Heading>
      <p className="mb-6 text-[15px] text-muted">
        {r.subtitle}
      </p>
      {hasCall && (
        <p className="-mt-3 mb-6 text-[15px] text-muted">
          {r.currentLabel} <strong className="font-semibold text-byte-purple">{formatWhen(m.booking.startsAt, m.timeZone)}</strong>
        </p>
      )}

      <BookingCalendar c={m.c} />
      <ActionError m={m} />

      <div className="mt-8 flex items-center justify-between gap-3 mobile:flex-col-reverse mobile:*:w-full">
        <BackButton onClick={() => m.setMode('view')} disabled={m.sending}>
          {hasCall ? r.backLabel : r.backNoCallLabel}
        </BackButton>
        <PrimaryButton type="submit" disabled={m.sending}>
          {m.sending ? <Spinner /> : <Icon name="calendar" className="size-4" strokeWidth={2.2} />}
          {m.sending ? t.sendingLabel : hasCall ? r.submitLabel : r.bookLabel}
        </PrimaryButton>
      </div>
    </form>
  );
}

// ---- Cancel ----

function ConfirmCancel({ m }) {
  const k = t.confirmCancel;
  return (
    <div className="motion-safe:animate-step-next">
      <Heading m={m}>{k.title}</Heading>
      {m.booking && (
        <p className="mt-5 flex items-center gap-2.5 rounded-xl bg-cream-dough px-4 py-3 text-[15px] font-semibold text-byte-purple">
          <Icon name="calendar" className="size-5 flex-none text-soft-violet" strokeWidth={2} />
          {formatWhen(m.booking.startsAt, m.timeZone)}
        </p>
      )}
      <p className="mt-4 text-[15px] text-muted">{k.text}</p>
      <ActionError m={m} />
      <div className="mt-8 flex items-center justify-between gap-3 mobile:flex-col-reverse mobile:*:w-full">
        <BackButton onClick={() => m.setMode('view')} disabled={m.sending}>
          {k.keepLabel}
        </BackButton>
        <button
          type="button"
          onClick={m.cancel}
          disabled={m.sending}
          className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-btn bg-danger px-7 py-3 text-[15px] font-semibold text-cream-dough transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-80"
        >
          {m.sending && <Spinner />}
          {m.sending ? t.sendingLabel : k.confirmLabel}
        </button>
      </div>
    </div>
  );
}

// ---- Other states ----

function Loading() {
  return (
    <div className="grid gap-4" role="status">
      <span className="sr-only">{t.loading}</span>
      <div aria-hidden="true" className="grid gap-4 motion-safe:animate-pulse">
        <div className="h-4 w-40 rounded-full bg-cream-dough" />
        <div className="h-9 w-3/4 rounded-xl bg-cream-dough" />
        <div className="h-12 rounded-xl bg-cream-dough" />
        <div className="h-12 w-48 rounded-btn bg-cream-dough" />
      </div>
    </div>
  );
}

function InvalidLink({ m }) {
  const v = t.invalid;
  return (
    <div className="py-4 text-center motion-safe:animate-rise">
      <div className="mx-auto mb-5 grid size-16 place-items-center rounded-full bg-cream-dough text-soft-violet">
        <Icon name="lock" className="size-8" strokeWidth={2} />
      </div>
      <Heading m={m}>{v.title}</Heading>
      <p className="mx-auto mt-2 max-w-[44ch] text-[15px] text-muted">{v.text}</p>
      <a
        href={routes.home}
        onClick={onRouteLinkClick}
        className="mt-7 inline-flex min-h-11 items-center justify-center gap-2 rounded-btn bg-bun-orange px-6 py-3 text-[15px] font-semibold text-midnight-plum hover:bg-bun-orange-hover"
      >
        <Icon name="arrowLeft" className="size-4" strokeWidth={2.2} />
        {v.homeLabel}
      </a>
    </div>
  );
}

function LoadError({ m }) {
  return (
    <div role="alert" className="rounded-xl border border-danger/40 bg-gold-tint p-4 text-[15px] text-danger">
      <h1 ref={m.headingRef} tabIndex={-1} className="mb-1 text-base text-danger outline-none">
        {t.loadError}
      </h1>
      {m.error}{' '}
      <button type="button" onClick={m.retry} className="cursor-pointer font-semibold underline underline-offset-2">
        {t.retry}
      </button>
    </div>
  );
}

function ActionError({ m }) {
  if (!m.actionError) return null;
  return (
    <p role="alert" className="mt-5 rounded-btn border border-danger/40 bg-gold-tint px-3 py-2 text-sm text-danger motion-safe:animate-rise">
      {m.actionError}
    </p>
  );
}

// ---- Buttons ----

function PrimaryButton({ type = 'button', onClick, disabled, children }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-btn bg-bun-orange px-7 py-3 text-[15px] font-semibold text-midnight-plum transition-[background-color,transform] hover:bg-bun-orange-hover motion-safe:hover:-translate-y-px disabled:cursor-wait disabled:opacity-80"
    >
      {children}
    </button>
  );
}

function SecondaryButton({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-btn border-2 border-byte-purple px-6 py-3 text-[15px] font-semibold text-byte-purple hover:bg-cream-dough"
    >
      {children}
    </button>
  );
}

function BackButton({ onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-btn px-4 text-[15px] font-semibold text-muted hover:text-byte-purple disabled:cursor-wait disabled:opacity-60"
    >
      <Icon name="arrowLeft" className="size-4 transition-transform motion-safe:group-hover:-translate-x-1" strokeWidth={2.2} />
      {children}
    </button>
  );
}
