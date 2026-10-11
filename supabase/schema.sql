-- Nodo Note: schema Supabase (tabella impegni + storage audio)
-- Da eseguire nella dashboard Supabase: SQL Editor -> New query -> incolla ed esegui.

create table public.impegni (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  trascrizione text not null,
  attivo boolean not null default true,
  data timestamptz not null default now(),
  durata integer,
  sottotask jsonb not null default '[]'::jsonb,
  audio_path text,
  -- Data/ora del promemoria rilevata dall'AI (nullable), e id della notifica
  -- locale programmata sul dispositivo per poterla cancellare/riprogrammare.
  promemoria_at timestamptz,
  notification_id integer
);

alter table public.impegni enable row level security;

create policy "select_own" on public.impegni for select using (auth.uid() = user_id);
create policy "insert_own" on public.impegni for insert with check (auth.uid() = user_id);
create policy "update_own" on public.impegni for update using (auth.uid() = user_id);
create policy "delete_own" on public.impegni for delete using (auth.uid() = user_id);

-- Storage: bucket privato per le registrazioni audio, isolato per utente tramite path {user_id}/...
insert into storage.buckets (id, name, public) values ('audio', 'audio', false);

create policy "audio_insert_own" on storage.objects for insert
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "audio_select_own" on storage.objects for select
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "audio_delete_own" on storage.objects for delete
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);

-- Profili utente: username e numero di telefono univoci raccolti alla
-- registrazione, più un campo "licenza" (per ora solo un booleano, in vista
-- di una futura funzione a pagamento/licenza).
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  phone text not null unique,
  licenza boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "select_own_profile" on public.profiles for select using (auth.uid() = id);
create policy "update_own_profile" on public.profiles for update using (auth.uid() = id);
-- Nessuna policy di insert per il client: la riga viene creata dal trigger
-- qui sotto (che gira con privilegi elevati), subito dopo la registrazione,
-- anche prima che l'utente confermi l'email.

-- Alla creazione di un nuovo utente (auth.users), crea automaticamente il
-- profilo corrispondente usando username/telefono passati in fase di signUp
-- (tramite `options.data`). Se username o telefono sono già in uso, l'intera
-- registrazione fallisce (unique constraint), così non restano mai utenti
-- senza un profilo valido.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, phone)
  values (
    new.id,
    new.raw_user_meta_data->>'username',
    new.raw_user_meta_data->>'phone'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
