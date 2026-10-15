-- Fotos/PDF del remito y la factura de cada ingreso (archivos en el bucket privado "comprobantes").
alter table stock_entries add column remito_path text;
alter table stock_entries add column invoice_path text;
