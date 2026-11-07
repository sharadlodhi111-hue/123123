-- Upgrade the library to the four student-facing sections and curated page ranges.
alter table public.resource_documents
  drop constraint if exists resource_documents_category_check;

update public.resource_documents
set category = case category
  when 'PYQ' then 'IMPORTANT QUESTIONS (PYQ)'
  when 'NOTES' then 'SHORT NOTES'
  else category
end;

alter table public.resource_documents
  add constraint resource_documents_category_check
  check (category in ('CHAPTERS', 'SHORT NOTES', 'IMPORTANT QUESTIONS (PYQ)', 'NCERT EXEMPLAR'));

alter table public.resource_documents
  add column if not exists chapter_ranges jsonb not null default '[]'::jsonb,
  add column if not exists sha256_hash text;

alter table public.resource_documents
  add constraint resource_documents_sha256_hash_check
  check (sha256_hash is null or sha256_hash ~ '^[a-f0-9]{64}$');

create unique index if not exists resource_documents_sha256_unique
  on public.resource_documents (sha256_hash)
  where sha256_hash is not null;

create index if not exists resource_documents_ranges_idx
  on public.resource_documents using gin (chapter_ranges);
