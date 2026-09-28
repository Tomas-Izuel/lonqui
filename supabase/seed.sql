-- Seed del stack LOCAL. Corre con `npm run db:reset`.
--
-- Solo datos INVENTADOS: nombres, DNI y teléfonos falsos. Los Excel reales de
-- docs/relevamiento/ tienen datos personales de menores (Ley 25.326) y no se
-- usan como fixtures.
--
-- Corre como postgres, sin sesión: la auditoría registra estas filas con
-- actor_source = 'system'.

-- Disciplinas y categorías que el club tiene hoy. Las de fútbol femenino son
-- provisorias: el club tiene dos, a confirmar con la Comisión cómo se llaman.
insert into public.disciplines (name, sort_order) values
  ('Fútbol masculino', 1),
  ('Fútbol femenino', 2),
  ('Vóley', 3);

insert into public.categories (discipline_id, name, sort_order)
select d.id, c.name, c.sort_order
from public.disciplines d
join (values
  ('Fútbol masculino', '5ta', 1),
  ('Fútbol masculino', '6ta', 2),
  ('Fútbol masculino', '7ma', 3),
  ('Fútbol masculino', '8va', 4),
  ('Fútbol masculino', '9na', 5),
  ('Fútbol masculino', '10ma', 6),
  ('Fútbol femenino', 'Primera', 1),
  ('Fútbol femenino', 'Juveniles', 2),
  ('Vóley', 'Sub 18', 1),
  ('Vóley', 'Sub 19', 2),
  ('Vóley', 'Sub 20', 3),
  ('Vóley', 'Mayores', 4)
) as c (discipline, name, sort_order) on c.discipline = d.name;

-- Un grupo familiar: dos hermanos y la madre, que es la responsable de pago.
insert into public.family_groups (name, payer_contact_name, payer_contact_phone)
values ('Familia Ejemplo', null, null);

insert into public.members (
  first_name, last_name, dni, birth_date, phone, email,
  family_group_id, is_payment_responsible, joined_on, notes
)
select
  m.first_name, m.last_name, m.dni, m.birth_date::date, m.phone, m.email,
  case when m.in_group then (select id from public.family_groups where name = 'Familia Ejemplo') end,
  m.responsible,
  m.joined_on::date,
  m.notes
from (values
  ('Lucía',    'Ejemplo',    '30111222', '1985-04-12', '2994000001', 'lucia.ejemplo@example.com', true,  true,  '2026-03-01', 'Madre de Tomás y Martina'),
  ('Tomás',    'Ejemplo',    '50111333', '2014-07-03', null,         null,                        true,  false, '2026-03-01', null),
  ('Martina',  'Ejemplo',    '51222444', '2016-02-19', null,         null,                        true,  false, '2026-03-01', null),
  ('Joaquín',  'Prueba',     '48555666', '2011-11-30', '2994000002', null,                        false, false, '2026-02-15', null),
  ('Valentina','Ficticia',   '43777888', '2008-05-21', '2994000003', null,                        false, false, '2026-02-01', null),
  ('Sofía',    'Inventada',  '40999000', '1999-09-09', '2994000004', 'sofia@example.com',         false, false, '2026-01-10', null),
  ('Mateo',    'Demo',       null,       '2013-01-25', null,         null,                        false, false, '2026-04-01', 'DNI pendiente'),
  ('Ramón',    'Histórico',  '12345678', '1958-06-14', '2994000005', null,                        false, false, '2026-01-05', 'Socio fundador'),
  ('Nahuel',   'Muestra',    '52333111', '2017-08-08', null,         null,                        false, false, '2026-03-20', null),
  ('Camila',   'Núñez Test', '44222333', '2006-12-01', '2994000006', null,                        false, false, '2026-02-10', null),
  ('Bruno',    'Pérez Test', '47111999', '2010-03-15', null,         null,                        false, false, '2026-02-20', null)
) as m (first_name, last_name, dni, birth_date, phone, email, in_group, responsible, joined_on, notes);

-- Inscripciones en categorías. member_type lo deriva la base.
insert into public.member_categories (member_id, category_id, joined_on)
select mem.id, c.id, x.joined_on::date
from (values
  ('50111333', 'Fútbol masculino', '8va',       '2026-03-01'),
  ('51222444', 'Fútbol femenino',  'Juveniles', '2026-03-01'),
  -- Joaquín arrancó en 6ta y subió a 5ta (ver abajo).
  ('48555666', 'Fútbol masculino', '6ta',       '2026-02-15'),
  -- Valentina juega dos deportes: paga dos cuotas.
  ('43777888', 'Vóley',            'Sub 18',    '2026-02-01'),
  ('43777888', 'Fútbol femenino',  'Primera',   '2026-04-01'),
  -- Sofía dejó el fútbol (ver abajo): hoy paga la cuota social.
  ('40999000', 'Fútbol femenino',  'Primera',   '2026-01-10'),
  ('52333111', 'Fútbol masculino', '10ma',      '2026-03-20'),
  ('44222333', 'Vóley',            'Mayores',   '2026-02-10'),
  ('47111999', 'Fútbol masculino', '6ta',       '2026-02-20')
) as x (dni, discipline, category, joined_on)
join public.members mem on mem.dni = x.dni
join public.disciplines d on d.name = x.discipline
join public.categories c on c.discipline_id = d.id and c.name = x.category;

-- Mateo no tiene DNI: se lo busca por nombre.
insert into public.member_categories (member_id, category_id, joined_on)
select mem.id, c.id, date '2026-04-01'
from public.members mem
join public.disciplines d on d.name = 'Fútbol masculino'
join public.categories c on c.discipline_id = d.id and c.name = '7ma'
where mem.first_name = 'Mateo' and mem.last_name = 'Demo';

-- El ascenso de Joaquín: cierra 6ta y abre 5ta.
update public.member_categories mc
set left_on = date '2026-06-30', left_reason = 'Pasó a 5ta'
from public.members mem, public.categories c
where mc.member_id = mem.id and mem.dni = '48555666'
  and c.id = mc.category_id and c.name = '6ta' and mc.left_on is null;

insert into public.member_categories (member_id, category_id, joined_on)
select mem.id, c.id, date '2026-07-01'
from public.members mem
join public.disciplines d on d.name = 'Fútbol masculino'
join public.categories c on c.discipline_id = d.id and c.name = '5ta'
where mem.dni = '48555666';

-- Sofía deja el fútbol pero sigue de socia.
update public.member_categories mc
set left_on = date '2026-08-31', left_reason = 'Dejó de jugar'
from public.members mem
where mc.member_id = mem.id and mem.dni = '40999000' and mc.left_on is null;

-- Un socio dado de baja, con su ficha de egreso.
insert into public.member_status_events (member_id, event_type, effective_on, reason)
select id, 'withdrawal', date '2026-08-31', 'Se mudó de localidad'
from public.members
where dni = '47111999';

-- Aptos físicos: uno vigente, uno vencido (el menor sin apto queda sin fila).
insert into public.medical_clearances (member_id, expires_on, notes)
select id, date '2027-03-01', 'Visto en papel'
from public.members where dni = '50111333';

insert into public.medical_clearances (member_id, expires_on, notes)
select id, date '2026-06-30', 'Visto en papel'
from public.members where dni = '52333111';

-- -----------------------------------------------------------------------------
-- Slice 2: cuotas y pagos (todo inventado)
-- -----------------------------------------------------------------------------

-- Valor por defecto $10.000 desde este mes, y uno distinto para Vóley Mayores
-- desde el mes que viene, para que la precedencia categoría > default se vea.
insert into public.fee_prices (scope, amount_cents, valid_from, notes)
values ('default', 1000000, date_trunc('month', private.club_today())::date, 'Valor de arranque');

insert into public.fee_prices (scope, category_id, amount_cents, valid_from, notes)
select 'category', c.id, 1200000, (date_trunc('month', private.club_today()) + interval '1 month')::date, 'Mayores paga distinto'
from public.categories c join public.disciplines d on d.id = c.discipline_id
where d.name = 'Vóley' and c.name = 'Mayores';

-- Facturación activa desde este mes y cuotas del mes generadas (corre como
-- postgres, sin sesión: la auditoría queda 'system', como el cron).
update public.settings set billing_start_period = date_trunc('month', private.club_today())::date where id = 1;
select * from private.generate_pending_fees('cron');

-- Saldos de arranque: deuda previa al sistema.
insert into public.fees (member_id, kind, amount_cents)
select id, 'opening_balance', 2000000 from public.members where dni = '50111333';
insert into public.fees (member_id, kind, amount_cents)
select id, 'opening_balance', 3000000 from public.members where dni = '43777888';

-- Pagos. Un batch_id por cobro; el de grupo familiar es uno solo para varios socios.
-- Pago de tres meses por adelantado (queda saldo a favor).
insert into public.payments (member_id, amount_cents, method, batch_id, paid_on)
select id, 3000000, 'cash', 'a0000000-0000-0000-0000-000000000001', private.club_today()
from public.members where dni = '12345678';
-- Pago parcial por transferencia (sin comprobante todavía).
insert into public.payments (member_id, amount_cents, method, batch_id, paid_on)
select id, 500000, 'transfer', 'a0000000-0000-0000-0000-000000000002', private.club_today()
from public.members where dni = '48555666';
-- Cobro al grupo familiar: los dos chicos en un solo cobro.
insert into public.payments (member_id, amount_cents, method, batch_id, paid_on)
select id, 1000000, 'cash', 'a0000000-0000-0000-0000-000000000003', private.club_today()
from public.members where dni in ('50111333', '51222444');
-- Un pago anulado, con su motivo. Sin sesión no hay actor real: voided_by es
-- un uuid de relleno (no es ningún usuario; la columna no tiene FK). La
-- anulación real la hace el trigger con auth.uid().
insert into public.payments (member_id, amount_cents, method, batch_id, paid_on, voided_at, voided_by, void_reason)
select id, 1000000, 'cash', 'a0000000-0000-0000-0000-000000000004', private.club_today(),
       now(), '00000000-0000-0000-0000-000000000000', 'Cargado dos veces'
from public.members where dni = '40999000';
