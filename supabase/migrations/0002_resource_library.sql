-- Private PDF storage and metadata for the chapter-wise resource library.
create table if not exists public.resource_documents (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('PYQ', 'NOTES', 'NCERT EXEMPLAR')),
  subject text not null check (subject in ('Physics', 'Chemistry', 'Biology')),
  chapter_id text not null,
  chapter_name text not null,
  display_name text not null,
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null default 'application/pdf',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  page_count integer not null default 0 check (page_count >= 0),
  chapter_pages jsonb not null default '[]'::jsonb,
  detected_chapters text[] not null default '{}',
  published boolean not null default true,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists resource_documents_folder_idx
  on public.resource_documents (category, subject, chapter_id, published);

alter table public.resource_documents enable row level security;
alter table public.resource_documents force row level security;
revoke all on public.resource_documents from anon;
grant select, insert, update, delete on public.resource_documents to authenticated;

drop policy if exists "Students read published resources" on public.resource_documents;
create policy "Students read published resources"
  on public.resource_documents for select to authenticated
  using (published or (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Admins create resources" on public.resource_documents;
create policy "Admins create resources"
  on public.resource_documents for insert to authenticated
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and created_by = (select auth.uid()));

drop policy if exists "Admins update resources" on public.resource_documents;
create policy "Admins update resources"
  on public.resource_documents for update to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Admins delete resources" on public.resource_documents;
create policy "Admins delete resources"
  on public.resource_documents for delete to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('study-resources', 'study-resources', false, 104857600, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Students read published study PDFs" on storage.objects;
create policy "Students read published study PDFs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'study-resources'
    and exists (
      select 1 from public.resource_documents document
      where document.storage_path = name
        and (document.published or (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
    )
  );

drop policy if exists "Admins upload study PDFs" on storage.objects;
create policy "Admins upload study PDFs"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'study-resources' and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Admins replace study PDFs" on storage.objects;
create policy "Admins replace study PDFs"
  on storage.objects for update to authenticated
  using (bucket_id = 'study-resources' and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check (bucket_id = 'study-resources' and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Admins delete study PDFs" on storage.objects;
create policy "Admins delete study PDFs"
  on storage.objects for delete to authenticated
  using (bucket_id = 'study-resources' and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
