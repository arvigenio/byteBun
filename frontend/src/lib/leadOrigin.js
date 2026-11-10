// Labels for where a booking came from (admin). Mirrors CHANNEL_LABELS and ORIGIN_LABELS in
// backend/src/leads/attribution.ts.
export const CHANNEL_LABELS = { web_form: 'Web form', chatbot: 'Chatbot', admin: 'Admin site' };
export const ORIGIN_LABELS = {
  social: 'Social media',
  search: 'Search',
  ads: 'Ads',
  email: 'Email',
  referral: 'Other website',
  direct: 'Direct',
  unknown: 'Not recorded',
};

/** The "Came from" filter: channels first, then origins. */
export const FROM_OPTIONS = [
  { value: 'web_form', label: 'Web form', group: 'Booked via' },
  { value: 'chatbot', label: 'Chatbot', group: 'Booked via' },
  { value: 'admin', label: 'Admin site', group: 'Booked via' },
  ...['social', 'search', 'ads', 'email', 'referral', 'direct', 'unknown'].map((value) => ({ value, label: ORIGIN_LABELS[value], group: 'Found us through' })),
];

export const channelLabel = (channel) => CHANNEL_LABELS[channel] ?? channel;

/** "Social media · Facebook", "Direct", or "Not recorded" for leads from before this existed. */
export const originLabel = (lead) => {
  if (!lead.origin) return ORIGIN_LABELS.unknown;
  const origin = ORIGIN_LABELS[lead.origin] ?? lead.origin;
  return lead.originDetail ? `${origin} · ${lead.originDetail}` : origin;
};
