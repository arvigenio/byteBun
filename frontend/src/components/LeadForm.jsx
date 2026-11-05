import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { site } from '../content/site.js';
import { useFocusWhen } from '../hooks/useFocusWhen.js';
import { useLeadFormController } from '../hooks/useLeadFormController.js';
import { useModalDialog } from '../hooks/useModalDialog.js';
import { closeLeadForm, selectLeadForm } from '../store/leadFormSlice.js';
import { Icon } from './ui/Icon.jsx';

// Rendered once in App. Buttons open it with useLeadForm().open('source') (hooks/useLeadForm.js).
export function LeadFormDialog() {
  const dispatch = useDispatch();
  const { isOpen, session, status } = useSelector(selectLeadForm);
  const close = useCallback(() => dispatch(closeLeadForm()), [dispatch]);
  const { dialogProps } = useModalDialog(isOpen, close);

  return (
    <dialog
      {...dialogProps}
      aria-labelledby="lead-form-title"
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(100%-2rem,34rem)] rounded-card border border-line bg-cream-dough p-0 text-midnight-plum backdrop:bg-midnight-plum/60 mobile:mb-0 mobile:max-h-[94dvh] mobile:w-full mobile:max-w-none mobile:rounded-b-none mobile:border-x-0 mobile:border-b-0"
    >
      {/* `key` remounts the form, so every opening starts with empty fields. */}
      {session > 0 && (status === 'success' ? <LeadFormSuccess onClose={close} /> : <LeadForm key={session} onClose={close} />)}
    </dialog>
  );
}

function LeadForm({ onClose }) {
  const { id, field, register, errorFor, onSubmit, status, sending, formError } = useLeadFormController();

  return (
    <form noValidate onSubmit={onSubmit} aria-busy={sending} className={sheetPadding}>
      <DialogHeader onClose={onClose}>
        <h2 id="lead-form-title" className="text-xl">
          {site.leadForm.title}
        </h2>
        <p className="text-muted">{site.leadForm.intro}</p>
      </DialogHeader>

      <div className="mt-6 grid gap-4">
        <Field id={id('name')} label="Your name" error={errorFor('name')}>
          <input {...field('name')} className={inputClass} autoComplete="name" maxLength={120} />
        </Field>
        <Field id={id('email')} label="Email" error={errorFor('email')}>
          <input {...field('email')} type="email" className={inputClass} autoComplete="email" maxLength={254} />
        </Field>
        <Field id={id('phone')} label="Phone" optional error={errorFor('phone')}>
          <input {...field('phone')} type="tel" className={inputClass} autoComplete="tel" maxLength={40} />
        </Field>
        <Field id={id('businessName')} label="Business name" error={errorFor('businessName')}>
          <input {...field('businessName')} className={inputClass} autoComplete="organization" maxLength={160} />
        </Field>
        <Field id={id('businessType')} label="Type of business" error={errorFor('businessType')}>
          <select {...field('businessType')} className={inputClass}>
            <option value="">Choose one…</option>
            {site.leadForm.businessTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field id={id('message')} label="Message" optional error={errorFor('message')}>
          <textarea {...field('message')} rows={4} className={inputClass} maxLength={2000} />
        </Field>

        {/* Honeypot: hidden from people and screen readers; bots tend to fill it. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label htmlFor={id('website')}>Leave this field empty</label>
          <input id={id('website')} {...register('website')} tabIndex={-1} autoComplete="off" />
        </div>
      </div>

      {formError && (
        <p role="alert" className="mt-4 rounded-btn border border-danger/40 bg-gold-tint px-3 py-2 text-sm text-danger">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={sending}
        className="mt-6 inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-btn bg-bun-orange px-6 py-3 text-[15px] font-semibold text-midnight-plum hover:bg-bun-orange-hover disabled:cursor-wait disabled:opacity-80"
      >
        {sending && <Spinner />}
        {sending ? 'Sending…' : status === 'error' ? site.leadForm.retryLabel : site.leadForm.submitLabel}
      </button>
    </form>
  );
}

function LeadFormSuccess({ onClose }) {
  const titleRef = useFocusWhen(true); // announce the confirmation to screen readers

  return (
    <div className={sheetPadding} role="status">
      <DialogHeader onClose={onClose}>
        <div aria-hidden="true" className="grid size-[46px] place-items-center rounded-xl bg-byte-purple text-circuit-teal">
          <Icon name="check" className="size-6" strokeWidth={2.5} />
        </div>
      </DialogHeader>
      <h2 id="lead-form-title" ref={titleRef} tabIndex={-1} className="mt-4 text-xl">
        {site.leadForm.successTitle}
      </h2>
      <button
        type="button"
        onClick={onClose}
        className="mt-6 min-h-11 cursor-pointer rounded-btn bg-byte-purple px-6 py-3 text-[15px] font-semibold text-cream-dough hover:bg-byte-purple-hover"
      >
        Close
      </button>
    </div>
  );
}

// ---- Presentational pieces ----

const sheetPadding = 'p-6 sm:p-8 mobile:px-5 mobile:pt-5 mobile:pb-[calc(1.25rem+env(safe-area-inset-bottom))]';

const inputClass =
  'block min-h-11 w-full rounded-btn border border-line bg-cream-dough px-3 py-2 text-base text-midnight-plum focus-visible:outline-soft-violet aria-[invalid=true]:border-danger';

function DialogHeader({ onClose, children }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>{children}</div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close form"
        className="-m-2 grid size-11 flex-none cursor-pointer place-items-center rounded-btn text-muted hover:text-byte-purple"
      >
        <Icon name="close" className="size-5" strokeWidth={2} />
      </button>
    </div>
  );
}

function Field({ id, label, optional, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">
        {label} {optional && <span className="font-normal text-muted">(optional)</span>}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function Spinner() {
  return <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-midnight-plum/30 border-t-midnight-plum motion-reduce:animate-none" />;
}
