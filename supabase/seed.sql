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
  first_name, last_name, dni, birth_date, phone, email, member_type,
  category_id, family_group_id, is_payment_responsible, joined_on, notes
)
select
  m.first_name, m.last_name, m.dni, m.birth_date::date, m.phone, m.email, m.member_type,
  (select c.id from public.categories c join public.disciplines d on d.id = c.discipline_id
    where d.name = m.discipline and c.name = m.category),
  case when m.in_group then (select id from public.family_groups where name = 'Familia Ejemplo') end,
  m.responsible,
  m.joined_on::date,
  m.notes
from (values
  ('Lucía',    'Ejemplo',    '30111222', '1985-04-12', '2994000001', 'lucia.ejemplo@example.com', 'non_practicing', null,               null,       true,  true,  '2026-03-01', 'Madre de Tomás y Martina'),
  ('Tomás',    'Ejemplo',    '50111333', '2014-07-03', null,         null,                        'practicing',     'Fútbol masculino', '8va',      true,  false, '2026-03-01', null),
  ('Martina',  'Ejemplo',    '51222444', '2016-02-19', null,         null,                        'practicing',     'Fútbol femenino',  'Juveniles', true, false, '2026-03-01', null),
  ('Joaquín',  'Prueba',     '48555666', '2011-11-30', '2994000002', null,                        'practicing',     'Fútbol masculino', '5ta',      false, false, '2026-02-15', null),
  ('Valentina','Ficticia',   '43777888', '2008-05-21', '2994000003', null,                        'practicing',     'Vóley',            'Sub 18',   false, false, '2026-02-01', null),
  ('Sofía',    'Inventada',  '40999000', '1999-09-09', '2994000004', 'sofia@example.com',         'practicing',     'Fútbol femenino',  'Primera',  false, false, '2026-01-10', null),
  ('Mateo',    'Demo',       null,       '2013-01-25', null,         null,                        'practicing',     'Fútbol masculino', '7ma',      false, false, '2026-04-01', 'DNI pendiente'),
  ('Ramón',    'Histórico',  '12345678', '1958-06-14', '2994000005', null,                        'non_practicing', null,               null,       false, false, '2026-01-05', 'Socio fundador'),
  ('Nahuel',   'Muestra',    '52333111', '2017-08-08', null,         null,                        'practicing',     'Fútbol masculino', '10ma',     false, false, '2026-03-20', null),
  ('Camila',   'Núñez Test', '44222333', '2006-12-01', '2994000006', null,                        'practicing',     'Vóley',            'Mayores',  false, false, '2026-02-10', null),
  ('Bruno',    'Pérez Test', '47111999', '2010-03-15', null,         null,                        'practicing',     'Fútbol masculino', '6ta',      false, false, '2026-02-20', null)
) as m (first_name, last_name, dni, birth_date, phone, email, member_type, discipline, category, in_group, responsible, joined_on, notes);

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
