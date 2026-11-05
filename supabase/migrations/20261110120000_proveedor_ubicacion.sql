-- Un proveedor puede "recibir mercadería": tiene su propia ubicación (aparece como destino en
-- transferencias / envío a proveedor). Lo que se manda sigue siendo stock de Melania.
alter table locations add column if not exists supplier_id uuid unique references suppliers(id);

-- vincular las ubicaciones de proveedor que ya existen
update locations l set supplier_id = s.id
from suppliers s
where l.supplier_id is null
  and (lower(l.name) = lower(s.name) or (l.name = 'Oxapharma' and s.name = 'Oxapharma SA'));
