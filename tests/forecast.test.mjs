// Forecast: demanda diaria del ledger (sin revertidas) + historial de Wix anterior a la app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { enTransaccion, sinBase } from "./db.mjs";

const demanda = (t, id) =>
  t.filas(`select origen, dia::text, qty::float as qty from forecast_demanda('2024-01-01') where product_id = $1 order by dia, origen`, [id]);

test("cuenta ventas del ledger y descarta las revertidas", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const { deposito } = await t.ubicaciones();
    const p = await t.producto({ stock: { [deposito]: 50 } });
    await t.filas(`select apply_movement('SALE', $1, null, 3, $2, null, 'test')`, [p.id, deposito]);
    const v = await t.valor(`select apply_movement('WHOLESALE_SALE', $1, null, 10, $2, null, 'test')`, [p.id, deposito]);
    await t.filas(`select apply_movement('REVERSAL', $1, null, 10, null, $2, 'test', null, null, null, $3)`, [p.id, deposito, v]);
    const d = await demanda(t, p.id);
    assert.equal(d.length, 1);
    assert.equal(d[0].origen, "APP");
    assert.equal(d[0].qty, 3);
  }));

test("el historial de Wix se pasa a productos con la equivalencia y solo cuenta antes de la app", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const a = await t.producto();
    const pack = await t.equivalencia([{ producto: a, cantidad: 10 }]);
    const corte = await t.valor(`select corte::text from forecast_historial_resumen()`);
    const ins = (fecha, sku, cant, pago = "PAID", estado = "APPROVED") =>
      t.filas(
        `insert into wix_sales_history (order_id, line_id, ordered_at, external_sku, quantity, payment_status, wix_status) values ($1, 'l1', $2, $3, $4, $5, $6)`,
        [randomUUID(), fecha, sku, cant, pago, estado]
      );
    await ins("2025-03-10T15:00:00Z", pack, 2); // 20 u.
    await ins("2025-03-11T15:00:00Z", pack, 5, "NOT_PAID"); // no pagado: no cuenta
    await ins("2025-03-12T15:00:00Z", pack, 5, "PAID", "CANCELED"); // cancelado: no cuenta
    await ins(`${corte}T18:00:00Z`, pack, 1); // ya está en la app: no cuenta
    await ins("2025-03-13T15:00:00Z", "SKU-QUE-NO-EXISTE-" + randomUUID().slice(0, 6), 4);
    const d = await demanda(t, a.id);
    assert.deepEqual(d, [{ origen: "WIX", dia: "2025-03-10", qty: 20 }]);
    const sin = await t.valor(`select sin_equivalencia from forecast_historial_resumen()`);
    assert.ok(sin.some((s) => s.sku.startsWith("SKU-QUE-NO-EXISTE-") && Number(s.unidades) === 4));
  }));
