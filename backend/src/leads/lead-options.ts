// The choices on the lead page's "Goals" and "Features" steps. The API accepts only these keys
// and stores them (JSON arrays of keys in Leads.Goals / Leads.Features); labels are what the
// n8n webhook sends. Mirrored, with the same keys and labels, in frontend/src/content/site.js
// (getStarted.goals / getStarted.features): change both together.

/** Picking this goal requires a description (`goalsOther`). */
export const OTHER_GOAL = 'other';

export const GOALS = [
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
  { key: OTHER_GOAL, label: 'Other' },
] as const;

export const FEATURES = [
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
] as const;

export const GOAL_KEYS = GOALS.map((g) => g.key) as string[];
export const FEATURE_KEYS = FEATURES.map((f) => f.key) as string[];

const labelOf = (list: readonly { key: string; label: string }[]) => (key: string) => list.find((o) => o.key === key)?.label ?? key;
export const goalLabel = labelOf(GOALS);
export const featureLabel = labelOf(FEATURES);
