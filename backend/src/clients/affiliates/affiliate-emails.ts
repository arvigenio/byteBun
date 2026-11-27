// Emails to affiliates, for both programs:
//   plan   Byte Bun's own: businesses use the code on a Byte Bun Bookings plan (Byte Bun Tech branding)
//   event  a business's paid event: attendees use the code when registering (sent for the business)
// and to Byte Bun admins about plan payments. The business's emails about its own plan payment
// are in ../client-emails.ts.
import { renderEmail } from '../../auth/email-template';
import type { Mail } from '../../auth/mailer';
import type { AppConfig } from '../../config/config';

export interface AffiliateOffer {
  kind: 'plan' | 'event';
  firstName: string;
  lastName: string;
  email: string;
  promoCode: string;
  /** "10%" */
  discount: string;
  commission: string;
  /** Who runs the program: "Byte Bun" or the business's name. */
  owner: string;
  /** Events: the event's title, date and public page. */
  event?: { title: string; when: string; url: string };
}

const what = (o: AffiliateOffer) => (o.kind === 'plan' ? 'their Byte Bun Bookings plan' : `their spot at ${o.event!.title}`);
const who = (o: AffiliateOffer) => (o.kind === 'plan' ? 'Businesses' : 'Attendees');

const footer = (o: AffiliateOffer) =>
  o.kind === 'plan'
    ? 'You are receiving this because Byte Bun Tech added you to its affiliate program. Byte Bun Tech · bytebuntech.com'
    : `You are receiving this because ${o.owner} added you as an affiliate for one of its events. Sent by Byte Bun Bookings for ${o.owner}.`;

const howItWorks = (o: AffiliateOffer) => ({
  title: 'How it works',
  items: [
    { title: 'Share your promo code', text: `${who(o)} enter ${o.promoCode} when they ${o.kind === 'plan' ? 'upgrade to a paid plan' : 'register'}. They get ${o.discount} off ${what(o)}.` },
    { title: 'They pay', text: o.kind === 'plan' ? 'The business pays Byte Bun and uploads its proof of payment.' : `The attendee pays ${o.owner} and uploads a proof of payment.` },
    { title: 'You earn your commission', text: `Once the payment is verified, you earn ${o.commission} of what they paid. ${o.owner} sends it to the payout account you give us.` },
  ],
});

function send(cfg: AppConfig, o: AffiliateOffer, subject: string, r: { html: string; text: string }): Mail {
  const plan = o.kind === 'plan';
  const m = /<([^>]+)>/.exec(cfg.clients.mailFrom);
  const from = plan ? cfg.mail.leadsFrom : `"${o.owner.replace(/["\\]/g, '')} via Byte Bun" <${m ? m[1] : cfg.clients.mailFrom}>`;
  return { to: o.email, names: { [o.email]: `${o.firstName} ${o.lastName}` }, from, ...(plan && cfg.mail.leadsReplyTo ? { replyTo: cfg.mail.leadsReplyTo } : {}), subject, ...r };
}

const eventRows = (o: AffiliateOffer): [string, string][] => (o.event ? [['Event', o.event.title], ['When', o.event.when]] : []);

/** The proposal, with the unique sign-up link. */
export function affiliateProposalMail(cfg: AppConfig, o: AffiliateOffer, d: { url: string; expires: string }): Mail {
  const plan = o.kind === 'plan';
  const r = renderEmail({
    audience: 'customer',
    preheader: `Earn ${o.commission} of every verified payment from people you refer.`,
    hero: { badge: '★', title: plan ? `${o.firstName}, join the Byte Bun affiliate program` : `${o.firstName}, promote ${o.event!.title}`, subtitle: `${who(o)} save ${o.discount}. You earn ${o.commission}.` },
    label: 'Affiliate proposal',
    tone: 'info',
    title: `A proposal from ${o.owner}`,
    intro: [plan ? `Hi ${o.firstName}, we'd love you to recommend Byte Bun Bookings to the businesses you know. Here is what we offer:` : `Hi ${o.firstName}, ${o.owner} would like you to promote its event. Here is what they offer:`],
    details: [
      ...eventRows(o),
      [plan ? 'Discount for businesses' : 'Discount for attendees', `${o.discount} off ${what(o)}`],
      ['Your commission', `${o.commission} of what each ${plan ? 'business' : 'attendee'} pays`],
      ['When you are paid', 'Once their payment is verified'],
    ],
    steps: howItWorks(o),
    actions: [{ buttons: [{ label: 'Accept and sign up', href: d.url, primary: true }], note: `This link is just for you and works until ${d.expires}. Signing up takes a minute: confirm your details and where your commissions should go.` }],
    outro: [plan ? 'Questions about the program? Just reply to this email.' : `Questions? Contact ${o.owner}.`],
    footer: footer(o),
  });
  return send(cfg, o, plan ? `${o.firstName}, your Byte Bun affiliate proposal` : `${o.firstName}, an affiliate proposal for ${o.event!.title}`, r);
}

/** After accepting: their promo code and the portal. */
export function affiliateWelcomeMail(cfg: AppConfig, o: AffiliateOffer, portalUrl: string): Mail {
  const plan = o.kind === 'plan';
  const r = renderEmail({
    audience: 'customer',
    preheader: `Your promo code is ${o.promoCode}. Share it and earn ${o.commission}.`,
    hero: { badge: '✓', title: `Welcome aboard, ${o.firstName}!`, subtitle: plan ? 'You are now a Byte Bun affiliate.' : `You are now an affiliate for ${o.event!.title}.` },
    label: 'Welcome',
    tone: 'success',
    title: 'Your promo code',
    intro: [`Share this code: ${who(o).toLowerCase()} get ${o.discount} off ${what(o)}, and you earn ${o.commission} of what they pay once their payment is verified.`],
    code: o.promoCode,
    codeNote: plan ? 'Businesses enter it on their Plan page when they upgrade.' : 'Attendees enter it on the event’s registration form.',
    details: eventRows(o).concat(o.event ? ([['Event page', o.event.url]] as [string, string][]) : []),
    steps: howItWorks(o),
    actions: [{ title: 'Your affiliate dashboard', buttons: [{ label: 'Open my dashboard', href: portalUrl, primary: true }], note: 'Sign in with this email address: we email you a code. You’ll see your earnings, your events and the bookings waiting for verification.' }],
    footer: footer(o),
  });
  return send(cfg, o, plan ? `Welcome to the Byte Bun affiliate program, ${o.firstName}` : `You're an affiliate for ${o.event!.title}`, r);
}

/** Byte Bun's program: a referred business's payment was verified. */
export function commissionEarnedMail(cfg: AppConfig, o: AffiliateOffer, d: { amount: string; plan: string; paid: string; portalUrl: string }): Mail {
  const r = renderEmail({
    audience: 'customer',
    preheader: `You earned ${d.amount}.`,
    hero: { badge: '$', title: `You earned ${d.amount}`, subtitle: 'A business used your promo code.' },
    label: 'Commission earned',
    tone: 'success',
    title: `Nice work, ${o.firstName}`,
    intro: [`A business used your code ${o.promoCode} and Byte Bun verified its payment. We'll email you when your commission is sent.`],
    details: [['Plan', d.plan], ['Business paid', d.paid], ['Your commission', `${d.amount} (${o.commission})`]],
    actions: [{ buttons: [{ label: 'View my earnings', href: d.portalUrl }] }],
    footer: footer(o),
  });
  return send(cfg, o, `You earned a ${d.amount} commission`, r);
}

/** A payout was sent (either program). */
export function commissionPaidMail(cfg: AppConfig, o: AffiliateOffer, d: { amount: string; reference: string | null; account: string | null; portalUrl: string }): Mail {
  const r = renderEmail({
    audience: 'customer',
    preheader: `${o.owner} sent you ${d.amount}.`,
    hero: { badge: '✓', title: `You were paid ${d.amount}`, subtitle: o.event ? `Commission for ${o.event.title}` : 'Byte Bun affiliate commission' },
    label: 'Commission paid',
    tone: 'success',
    title: `Thanks, ${o.firstName}`,
    intro: [`${o.owner} sent your affiliate commission. It may take a little while to show in your account, depending on your bank or e-wallet.`],
    details: [...eventRows(o), ['Amount', d.amount], ...(d.account ? ([['Sent to', d.account]] as [string, string][]) : []), ...(d.reference ? ([['Reference', d.reference]] as [string, string][]) : [])],
    actions: [{ buttons: [{ label: 'View my earnings', href: d.portalUrl }] }],
    footer: footer(o),
  });
  return send(cfg, o, `Commission paid: ${d.amount}`, r);
}

/** The portal sign-in code. */
export function affiliateCodeMail(cfg: AppConfig, to: string, code: string, minutes: number): Mail {
  const r = renderEmail({
    audience: 'customer',
    preheader: `Your code is ${code}`,
    label: 'Sign-in code',
    tone: 'info',
    title: 'Sign in to your affiliate dashboard',
    intro: ['Enter this code to sign in.'],
    code,
    codeNote: `It expires in ${minutes} minutes and works once. If you didn't ask for it, you can ignore this email.`,
    footer: 'Byte Bun affiliate portal · bytebuntech.com',
  });
  return { to, from: cfg.mail.leadsFrom, subject: `Your Byte Bun affiliate sign-in code: ${code}`, ...r };
}

/** To Byte Bun admins: a proof of payment to verify. */
export function planPaymentToVerifyMail(cfg: AppConfig, to: string[], d: { businessName: string; plan: string; amount: string; promoCode: string | null; affiliate: string | null; by: string; url: string }) {
  const { html, text } = renderEmail({
    preheader: `${d.businessName} paid ${d.amount} for ${d.plan}.`,
    label: 'Plan payment',
    tone: 'info',
    title: `Verify a payment from ${d.businessName}`,
    intro: [`${d.businessName} uploaded a proof of payment. Open Plan payments on the admin site to approve or reject it.`],
    details: [['Business', d.businessName], ['Plan', d.plan], ['Amount', d.amount], ...(d.promoCode ? ([['Promo code', `${d.promoCode}${d.affiliate ? ` (${d.affiliate})` : ''}`]] as [string, string][]) : []), ['Sent by', d.by], ['Where', d.url]],
    footer: 'Sent to Byte Bun administrators.',
  });
  return { to, subject: `Plan payment to verify: ${d.businessName} (${d.amount})`, text, html };
}
