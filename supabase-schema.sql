-- School Portal schema | نفّذ الملف كاملًا في Supabase SQL Editor
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 3 and 80),
  role text not null default 'student' check (role in ('student','teacher','admin')),
  grade text,
  student_code text unique,
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  constraint valid_grade check (grade is null or grade in ('الأول الثانوي','الثاني الثانوي'))
);

-- Trigger ينشئ ملف الطالب وكوده على الخادم، وليس في المتصفح.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  new_code text;
  chosen_grade text;
begin
  chosen_grade := new.raw_user_meta_data ->> 'grade';
  if chosen_grade not in ('الأول الثانوي','الثاني الثانوي') then
    chosen_grade := null;
  end if;
  loop
    new_code := 'ST-' || upper(encode(gen_random_bytes(6),'hex'));
    exit when not exists (select 1 from public.profiles where student_code = new_code);
  end loop;
  insert into public.profiles(id,full_name,role,grade,student_code,approved)
  values(new.id, coalesce(nullif(new.raw_user_meta_data ->> 'full_name',''),'طالب جديد'),
         'student',chosen_grade,new_code,true);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 140),
  body text not null default '',
  kind text not null check (kind in ('announcement','lesson','assignment','assessment')),
  grade text not null check (grade in ('الأول الثانوي','الثاني الثانوي','الكل')),
  subject text,
  due_at timestamptz,
  attachment_path text,
  pinned boolean not null default false,
  author_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  answer_text text,
  attachment_path text,
  submitted_at timestamptz not null default now(),
  unique(content_id,student_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content_id uuid references public.content_items(id) on delete cascade,
  seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  target_id uuid,
  created_at timestamptz not null default now()
);

create or replace function public.current_role()
returns text language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;
create or replace function public.is_approved_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id=auth.uid()
    and role in ('teacher','admin') and approved=true)
$$;

-- لا تُرجع الكود إلا عبر RPC يتحقق من هوية صاحب الحساب.
create or replace function public.get_my_student_code()
returns text language plpgsql security definer set search_path = '' as $$
declare result text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select student_code into result from public.profiles
    where id=auth.uid() and role='student';
  if result is null then raise exception 'Student code unavailable'; end if;
  return result;
end;
$$;
revoke all on function public.get_my_student_code() from public;
grant execute on function public.get_my_student_code() to authenticated;

alter table public.profiles enable row level security;
alter table public.content_items enable row level security;
alter table public.submissions enable row level security;
alter table public.notifications enable row level security;
alter table public.admin_audit_log enable row level security;

drop policy if exists "profile self or admin read" on public.profiles;
create policy "profile self or admin read" on public.profiles for select to authenticated
using (id=auth.uid() or public.current_role()='admin');
drop policy if exists "admin update profiles" on public.profiles;
create policy "admin update profiles" on public.profiles for update to authenticated
using (public.current_role()='admin') with check (public.current_role()='admin');
-- لا تسمح للعميل بإضافة أو تغيير role أو student_code؛ إنشاء الملف يتم بالـ trigger.

drop policy if exists "students read their grade content" on public.content_items;
create policy "students read their grade content" on public.content_items for select to authenticated
using (
  (public.current_role()='student' and exists(
    select 1 from public.profiles p where p.id=auth.uid()
    and (p.grade=content_items.grade or content_items.grade='الكل')
  ))
  or (public.is_approved_staff())
);
drop policy if exists "approved staff create content" on public.content_items;
create policy "approved staff create content" on public.content_items for insert to authenticated
with check (public.is_approved_staff() and author_id=auth.uid()
  and (pinned=false or public.current_role()='admin'));
drop policy if exists "authors or admins update content" on public.content_items;
create policy "authors or admins update content" on public.content_items for update to authenticated
using (author_id=auth.uid() or public.current_role()='admin')
with check (public.is_approved_staff() and (author_id=auth.uid() or public.current_role()='admin')
  and (pinned=false or public.current_role()='admin'));
drop policy if exists "authors or admins delete content" on public.content_items;
create policy "authors or admins delete content" on public.content_items for delete to authenticated
using (author_id=auth.uid() or public.current_role()='admin');

drop policy if exists "student own submissions" on public.submissions;
create policy "student own submissions" on public.submissions for select to authenticated
using (student_id=auth.uid() or public.current_role()='admin'
  or exists(select 1 from public.content_items c where c.id=content_id and c.author_id=auth.uid()));
drop policy if exists "student submit to own grade" on public.submissions;
create policy "student submit to own grade" on public.submissions for insert to authenticated
with check (student_id=auth.uid() and public.current_role()='student'
  and exists(select 1 from public.content_items c join public.profiles p on p.id=auth.uid()
    where c.id=content_id and c.kind='assignment'
    and (c.grade=p.grade or c.grade='الكل')
    and (c.due_at is null or c.due_at>now())));
drop policy if exists "student update own submission" on public.submissions;
create policy "student update own submission" on public.submissions for update to authenticated
using (student_id=auth.uid()) with check (student_id=auth.uid());

drop policy if exists "user reads own notifications" on public.notifications;
create policy "user reads own notifications" on public.notifications for select to authenticated using(user_id=auth.uid());
drop policy if exists "admin reads audit" on public.admin_audit_log;
create policy "admin reads audit" on public.admin_audit_log for select to authenticated using(public.current_role()='admin');

-- Storage bucket خاص. الملفات تُرفع داخل مجلد يحمل UUID صاحبها.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('school-files','school-files',false,10485760,
  array['image/jpeg','image/png','image/webp','application/pdf',
        'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict(id) do nothing;

drop policy if exists "owner uploads school files" on storage.objects;
create policy "owner uploads school files" on storage.objects for insert to authenticated
with check (bucket_id='school-files' and (storage.foldername(name))[1]=auth.uid()::text
  and public.is_approved_staff());
drop policy if exists "authorized users read school files" on storage.objects;
create policy "authorized users read school files" on storage.objects for select to authenticated
using (bucket_id='school-files' and (
  (storage.foldername(name))[1]=auth.uid()::text
  or public.is_approved_staff()
));
drop policy if exists "owner deletes school files" on storage.objects;
create policy "owner deletes school files" on storage.objects for delete to authenticated
using (bucket_id='school-files' and (storage.foldername(name))[1]=auth.uid()::text);

-- إعداد أول مدير: أنشئ حسابًا عاديًا من التطبيق ثم نفّذ هذا الأمر
-- باستبدال البريد ببريد حسابك. لا تضع بيانات اعتماد الإدارة في الواجهة.
-- update public.profiles set role='admin', approved=true
-- where id=(select id from auth.users where email='admin@example.com');

-- اعتماد مدرس بعد مراجعة هويته:
-- update public.profiles set role='teacher', approved=true
-- where id=(select id from auth.users where email='teacher@example.com');
