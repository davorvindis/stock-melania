-- Reconciliación con Wix cada 5 minutos desde la base (pg_cron + pg_net):
-- llama a /api/wix/sync de la app. Vercel Hobby solo permite crons diarios.
-- El secreto se guarda en app_settings (clave 'wix_sync') y NO en el repo:
--   insert into app_settings (key, value) values ('wix_sync',
--     jsonb_build_object('url','https://stock-melania.vercel.app/api/wix/sync','secret','<WIX_SYNC_SECRET>'))
--   on conflict (key) do update set value = excluded.value;
-- Si falta esa fila, la corrida no hace nada.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function wix_cron_sync() returns void language plpgsql as $$
declare v jsonb;
begin
  select value into v from app_settings where key = 'wix_sync';
  if v is null or coalesce(v->>'secret', '') = '' then return; end if;
  if not coalesce((select (value->>'enabled')::boolean from app_settings where key = 'wix'), false) then return; end if;
  perform net.http_get(
    url := v->>'url',
    headers := jsonb_build_object('authorization', 'Bearer ' || (v->>'secret')),
    timeout_milliseconds := 55000
  );
end $$;
revoke execute on function wix_cron_sync() from public, anon, authenticated;

select cron.schedule('wix-sync', '*/5 * * * *', $$select wix_cron_sync()$$);
