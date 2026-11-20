import { site } from '../../content/site.js';
import { useMeQuery, useOverviewQuery } from '../api.js';
import { Badge, Card, LinkButton, Notice, PageHeader } from '../ui.jsx';

// Plans and limits, from the same pricing as bytebuntech.com (site.packages). Plan changes are
// made by Byte Bun from the admin site (no self-serve checkout yet).
const PLAN_CODE = { Free: 'free', 'Bookings Pro': 'bookings', Premium: 'premium', Growth: 'growth' };

export function PlanPage() {
  const { data: me } = useMeQuery();
  const { data: o } = useOverviewQuery();
  const b = me.business;
  const p = site.packages;
  return (
    <>
      <PageHeader title="Plan" description={`${b.name} is on the ${b.plan.name} plan.`} />
      <div className="flex flex-col gap-5">
        {o?.usage.limit !== null && o && (
          <Notice tone={o.usage.used >= o.usage.limit ? 'danger' : 'info'}>
            {o.usage.used} of {o.usage.limit} bookings used this month.
          </Notice>
        )}
        <div className="grid gap-4 desktop:grid-cols-2">
          {p.plans.map((plan) => {
            const current = PLAN_CODE[plan.name] === b.plan.code;
            return (
              <Card
                key={plan.name}
                title={plan.name}
                description={`${plan.price.monthly}/month${plan.price.yearly !== '$0' ? ` · ${plan.price.yearly}/year` : ''}`}
                actions={current ? <Badge tone="brand">Current</Badge> : plan.featured ? <Badge tone="ok">{plan.featuredLabel}</Badge> : null}
                className={current ? 'border-brand' : ''}
              >
                <ul className="flex flex-col gap-1 text-sm text-muted">
                  {plan.features.map((f) => (
                    <li key={f}>✓ {f}</li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
        <Card title="Change plan">
          <p className="text-sm text-muted">
            To upgrade, email{' '}
            <a className="font-medium text-brand underline" href={`mailto:${site.contact.email}?subject=${encodeURIComponent(`Plan change: ${b.name}`)}`}>
              {site.contact.email}
            </a>{' '}
            or book a free consultation for Premium and Growth. Upgrading stops data deletion right away and keeps everything you have. Prices in USD.
          </p>
          <div className="mt-4">
            <LinkButton href="https://bytebuntech.com/#packages" target="_blank" rel="noreferrer">
              Compare plans
            </LinkButton>
          </div>
        </Card>
      </div>
    </>
  );
}
