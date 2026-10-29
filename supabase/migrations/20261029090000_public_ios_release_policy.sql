-- Release metadata is deliberately public; no company, user or device data.
-- Does NOT activate forced updates or change any existing app_updates entries.
begin;
create table if not exists public.app_platform_releases (
    platform text primary key check (platform in ('ios')),
    minimum_version text not null check (minimum_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
    store_url text not null default '',
    enabled boolean not null default false,
    updated_at timestamptz not null default now(),
    constraint enabled_release_needs_store_url check (
        not enabled or store_url ~ '^https://apps\.apple\.com/([^?#]*/)?id[0-9]+([/?#]|$)'
    )
);
alter table public.app_platform_releases enable row level security;
revoke all on public.app_platform_releases from anon, authenticated;
grant select on public.app_platform_releases to anon, authenticated;
grant insert, update, delete on public.app_platform_releases to authenticated;
create policy public_release_metadata on public.app_platform_releases
    for select to anon, authenticated using (true);
create policy super_admin_release_management on public.app_platform_releases
    for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
insert into public.app_platform_releases(platform, minimum_version)
    values ('ios', '1.0.22') on conflict (platform) do nothing;
commit;

-- ONLY after the new version is approved AND available in the Turkish App Store:
-- Set the verified apps.apple.com/.../idNUMBER URL, then enable the row.
-- This gate ships in 1.0.22. Existing 1.0.20/21 anonymous installs cannot read it.
-- Never publish a global forced app_updates entry to solve an iOS-only issue:
-- legacy clients do not filter that table by platform.
