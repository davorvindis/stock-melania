-- Fecha de cumpleaños de cada usuario: el día del cumple aparece un saludo arriba de todas las pantallas.
alter table profiles add column if not exists birthday date;

update profiles p set birthday = v.f::date
from (values
  ('Joel', '1990-11-28'),
  ('Mel', '1987-03-06'),
  ('Yura', '1989-05-15'),
  ('Karla', '1995-08-20'),
  ('Juan', '1996-09-13'),
  ('Francisco', '1993-11-09'),
  ('Darko', '1960-09-28')
) as v(alias, f)
where p.alias = v.alias and p.birthday is null;
