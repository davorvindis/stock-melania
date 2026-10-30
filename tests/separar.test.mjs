// Separar blisters en unidades: resta los blisters y suma las unidades del mismo lote.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { enTransaccion, sinBase } from "./db.mjs";

async function blisterYUnidad(t) {
  const { deposito } = await t.ubicaciones();
  const unidad = await t.producto({ nombre: "Monodosis x1" });
  const blister = await t.producto({ nombre: "Blister x4" });
  await t.filas(`update products set split_into_product_id = $1, split_factor = 4, split_label = 'blister x4' where id = $2`, [unidad.id, blister.id]);
  const lote = await t.valor(`insert into lots (product_id, code, expires_on) values ($1, $2, '2028-03-31') returning id`, [blister.id, `L-${blister.sku}`]);
  await t.filas(`select apply_movement('RECEIPT', $1, $2, 600, null, $3, 'test', 'Caja del laboratorio')`, [blister.id, lote, deposito]);
  return { deposito, unidad, blister, lote };
}

const stockLote = (t, producto, code, loc) =>
  t.valor(`select coalesce(sum(b.quantity), 0)::float from stock_balances b join lots l on l.id = b.lot_id
            where b.product_id = $1 and l.code = $2 and b.location_id = $3`, [producto, code, loc]);

test("separar 500 blisters: -500 blisters y +2000 unidades del mismo lote y vencimiento", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const { deposito, unidad, blister, lote } = await blisterYUnidad(t);
    const r = await t.valor(`select split_product($1, $2, $3, 500, 'test', $4)`, [blister.id, lote, deposito, randomUUID()]);
    assert.equal(Number(r.unidades), 2000);
    assert.equal(await t.stock(blister.id, deposito), 100);
    assert.equal(await t.stock(unidad.id, deposito), 2000);
    const code = `L-${blister.sku}`;
    assert.equal(await stockLote(t, unidad.id, code, deposito), 2000);
    assert.equal(await t.valor(`select expires_on::text from lots where product_id = $1 and code = $2`, [unidad.id, code]), "2028-03-31");
    // una segunda separación del mismo lote reusa el lote de las unidades
    await t.valor(`select split_product($1, $2, $3, 10, 'test', $4)`, [blister.id, lote, deposito, randomUUID()]);
    assert.equal(await stockLote(t, unidad.id, code, deposito), 2040);
    assert.equal(Number(await t.valor(`select count(*) from lots where product_id = $1`, [unidad.id])), 1);
  }));

test("separar no permite más de lo que hay, ni dos veces el mismo envío, ni caja cerrada", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const { deposito, unidad, blister, lote } = await blisterYUnidad(t);
    assert.match(await t.error(`select split_product($1, $2, $3, 601, 'test', null)`, [blister.id, lote, deposito]), /Stock insuficiente/);
    const idem = randomUUID();
    await t.valor(`select split_product($1, $2, $3, 100, 'test', $4)`, [blister.id, lote, deposito, idem]);
    const otra = await t.valor(`select split_product($1, $2, $3, 100, 'test', $4)`, [blister.id, lote, deposito, idem]);
    assert.equal(otra.repeated, true);
    assert.equal(await t.stock(unidad.id, deposito), 400);
    await t.filas(`update lots set sealed = true where id = $1`, [lote]);
    assert.match(await t.error(`select split_product($1, $2, $3, 1, 'test', null)`, [blister.id, lote, deposito]), /caja cerrada/);
    assert.match(await t.error(`select split_product($1, null, $2, 1, 'test', null)`, [unidad.id, deposito]), /no está configurado/);
  }));
