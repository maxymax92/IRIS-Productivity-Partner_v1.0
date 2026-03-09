-- User files bucket: per-user virtual disk (object store)
-- Path structure: {user_id}/path/to/file.ext
-- RLS ensures users only access their own prefix
-- Bucket is created via config.toml for local dev; for hosted, create in Dashboard or run:
--   insert into storage.buckets (id, name, public, file_size_limit)
--   values (gen_random_uuid(), 'user-files', false, 52428800);

-- RLS: users can only access objects under their own folder (first path segment = user id)
create policy "User files: select own"
on storage.objects for select
to authenticated
using (
  bucket_id = 'user-files'
  and (storage.foldername(name))[1] = (auth.jwt()->>'sub')
);

create policy "User files: insert own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'user-files'
  and (storage.foldername(name))[1] = (auth.jwt()->>'sub')
);

create policy "User files: update own"
on storage.objects for update
to authenticated
using (
  bucket_id = 'user-files'
  and (storage.foldername(name))[1] = (auth.jwt()->>'sub')
);

create policy "User files: delete own"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'user-files'
  and (storage.foldername(name))[1] = (auth.jwt()->>'sub')
);
