-- "¿este movimiento fue revertido?" se pregunta en Ventas, Dashboard y Movimientos:
-- sin índice cada consulta recorría todo el historial
create index if not exists idx_movements_reversal_of on inventory_movements (reversal_of) where reversal_of is not null;
