-- Optional: a limited PostgreSQL login for the admin site's client management
-- (backend/src/clients/admin/). Run once as the database owner, in the clients database:
--   docker compose -f docker-compose.prod.yml exec db psql -U "$DB_USER" -d clients_db -f - < docs/CLIENTS-DB-ADMIN-USER.sql
-- then set CLIENTS_ADMIN_DB_USER=bytebun_admin and CLIENTS_ADMIN_DB_PASSWORD in .env and restart.
-- Pick your own strong password below (no quotes inside it).
--
-- What it may do: read clients, their plans and activity; change plans, status and the audit log;
-- sign members out; pause notifications; and (purge job) remove a deleted client's data.
-- It can't change sign-in codes, rate limits or anything outside these tables.

CREATE ROLE bytebun_admin LOGIN PASSWORD 'CHANGE-ME-to-a-long-random-password';

GRANT USAGE ON SCHEMA auth, billing, booking TO bytebun_admin;

-- auth: who the clients are; sign members out; purge removes the business and its people.
GRANT SELECT, DELETE ON auth.organizations, auth.members, auth.invitations TO bytebun_admin;
GRANT SELECT, DELETE ON auth.users, auth.sessions TO bytebun_admin;

-- billing: plans, add-ons, subscriptions, entitlements, status, audit log.
GRANT SELECT ON billing.plans, billing.addons TO bytebun_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON billing.subscriptions, billing.subscription_addons, billing.entitlements, billing.account_status TO bytebun_admin;
GRANT SELECT, INSERT ON billing.events TO bytebun_admin;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA billing TO bytebun_admin;

-- booking: activity, CSV export, pausing notifications, purge.
GRANT SELECT, DELETE ON ALL TABLES IN SCHEMA booking TO bytebun_admin;
GRANT INSERT, UPDATE ON booking.notifications TO bytebun_admin;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA booking TO bytebun_admin;

-- Affiliates and plan payments (migrations 0042-0043; run these too on an existing setup):
-- Byte Bun's affiliates, their commissions, plan payments to verify, Byte Bun's payment channels.
GRANT SELECT, INSERT, UPDATE, DELETE ON billing.affiliates, billing.plan_affiliates, billing.affiliate_commissions, billing.plan_payments, billing.payment_channels TO bytebun_admin;
GRANT SELECT ON billing.affiliate_sessions TO bytebun_admin;
GRANT SELECT, DELETE ON booking.event_affiliates, booking.event_affiliate_payouts TO bytebun_admin;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA billing TO bytebun_admin;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA booking TO bytebun_admin;

-- Team roles, event assignments and the team chat (migration 0044): the purge removes them.
GRANT SELECT, DELETE ON booking.team_roles, booking.event_members, booking.chat_rooms, booking.chat_messages, booking.chat_reads TO bytebun_admin;
