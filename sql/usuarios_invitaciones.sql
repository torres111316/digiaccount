-- =============================================================
-- USUARIOS Y ROLES — invitaciones por código (equipo de trabajo)
-- Ejecutar COMPLETO en el SQL Editor de Supabase. Es idempotente.
-- =============================================================

-- 1) perfiles: correo visible y fecha de ingreso
alter table public.perfiles add column if not exists email text;
alter table public.perfiles add column if not exists creado_en timestamptz default now();
update public.perfiles p set email = u.email
from auth.users u where u.id = p.id and p.email is null;

-- 2) Tabla de invitaciones (una fila por código emitido)
create table if not exists public.invitaciones (
  id         uuid primary key default gen_random_uuid(),
  cuenta_id  uuid not null references public.cuentas(id) on delete cascade,
  email      text not null,
  nombre     text,
  whatsapp   text,
  rol        text not null default 'lectura',
  empresas   jsonb default '[]'::jsonb,      -- ids de empresas a las que tendrá acceso
  codigo     text not null unique,
  usado_por  uuid,                            -- auth.uid() de quien canjeó el código
  usado_en   timestamptz,
  expira_en  timestamptz not null default now() + interval '14 days',
  creado_en  timestamptz default now()
);

-- 3) Acceso por empresa (si ya existe con esta forma, no hace nada)
create table if not exists public.usuario_empresa (
  perfil_id  uuid not null references public.perfiles(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  creado_en  timestamptz default now(),
  primary key (perfil_id, empresa_id)
);

-- 4) RLS: los miembros ven; solo el ADMIN de la cuenta escribe
alter table public.invitaciones enable row level security;
drop policy if exists invitaciones_select on public.invitaciones;
create policy invitaciones_select on public.invitaciones for select
  using (cuenta_id = public.mi_cuenta_id() or public.soy_superadmin());
drop policy if exists invitaciones_admin_write on public.invitaciones;
create policy invitaciones_admin_write on public.invitaciones for all
  using ((cuenta_id = public.mi_cuenta_id()
          and exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin'))
         or public.soy_superadmin())
  with check ((cuenta_id = public.mi_cuenta_id()
          and exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin'))
         or public.soy_superadmin());

alter table public.usuario_empresa enable row level security;
drop policy if exists usuario_empresa_select on public.usuario_empresa;
create policy usuario_empresa_select on public.usuario_empresa for select
  using (perfil_id in (select id from public.perfiles where cuenta_id = public.mi_cuenta_id())
         or public.soy_superadmin());
drop policy if exists usuario_empresa_admin_write on public.usuario_empresa;
create policy usuario_empresa_admin_write on public.usuario_empresa for all
  using ((perfil_id in (select id from public.perfiles where cuenta_id = public.mi_cuenta_id())
          and exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin'))
         or public.soy_superadmin())
  with check ((perfil_id in (select id from public.perfiles where cuenta_id = public.mi_cuenta_id())
          and exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin'))
         or public.soy_superadmin());

-- 5) BLINDAJE: nadie se cambia el rol ni de cuenta a sí mismo por la API.
--    Solo un ADMIN de la misma cuenta (u otro admin, no uno mismo), el fundador,
--    o el canje de invitación (marcado con app.canje_invitacion) pueden hacerlo.
create or replace function public.proteger_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.canje_invitacion', true) = '1' then return new; end if;
  if new.rol is distinct from old.rol or new.cuenta_id is distinct from old.cuenta_id then
    if not public.soy_superadmin()
       and not exists (select 1 from public.perfiles yo
                       where yo.id = auth.uid() and yo.rol = 'admin'
                         and yo.cuenta_id = old.cuenta_id and yo.id <> old.id) then
      new.rol := old.rol;
      new.cuenta_id := old.cuenta_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_proteger_perfil on public.perfiles;
create trigger trg_proteger_perfil before update on public.perfiles
for each row execute function public.proteger_perfil();

-- 6) CANJE: muda al recién registrado a la cuenta que lo invitó.
--    Se llama desde la app al iniciar sesión si el registro trae código.
create or replace function public.canjear_invitacion(p_codigo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_inv record;
  v_cuenta_vieja uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'sin sesión');
  end if;
  select lower(email) into v_email from auth.users where id = v_uid;

  select * into v_inv from public.invitaciones
   where upper(codigo) = upper(trim(p_codigo)) and expira_en > now()
   limit 1;
  if v_inv is null then
    return jsonb_build_object('ok', false, 'error', 'código inválido o vencido');
  end if;
  -- ya canjeado por esta misma persona → éxito silencioso (logins siguientes)
  if v_inv.usado_por is not null then
    if v_inv.usado_por = v_uid then
      return jsonb_build_object('ok', true, 'repetido', true);
    end if;
    return jsonb_build_object('ok', false, 'error', 'código ya usado');
  end if;
  if lower(v_inv.email) <> v_email then
    return jsonb_build_object('ok', false, 'error_visible', true,
      'error', 'este código fue emitido para ' || v_inv.email || ' — regístrate con ese correo');
  end if;

  select cuenta_id into v_cuenta_vieja from public.perfiles where id = v_uid;

  perform set_config('app.canje_invitacion', '1', true);
  update public.perfiles
     set cuenta_id = v_inv.cuenta_id, rol = v_inv.rol,
         email = v_email, nombre = coalesce(nombre, v_inv.nombre)
   where id = v_uid;

  insert into public.usuario_empresa (perfil_id, empresa_id)
  select v_uid, e::uuid
    from jsonb_array_elements_text(coalesce(v_inv.empresas, '[]'::jsonb)) as e
  on conflict do nothing;

  update public.invitaciones set usado_por = v_uid, usado_en = now() where id = v_inv.id;

  -- elimina la cuenta de prueba creada por el registro, si quedó sin usuarios
  if v_cuenta_vieja is not null and v_cuenta_vieja <> v_inv.cuenta_id then
    begin
      delete from public.cuentas c
       where c.id = v_cuenta_vieja
         and not exists (select 1 from public.perfiles p where p.cuenta_id = v_cuenta_vieja);
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.canjear_invitacion(text) to authenticated;
