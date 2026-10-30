// El ledger: el stock sale solo de los movimientos, nunca queda negativo, nada se borra
// y las correcciones son reversiones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { enTransaccion, sinBase } from "./db.mjs";

test("ingreso suma, venta resta y no se puede vender de más", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const { deposito } = await t.ubicaciones();
    const p = await t.producto({ stock: { [deposito]: 10 } });
    assert.equal(await t.stock(p.id, deposito), 10);
    await t.filas(`select apply_movement('SALE', $1, null, 3, $2, null, 'test', 'Venta de prueba')`, [p.id, deposito]);
    assert.equal(await t.stock(p.id, deposito), 7);
    const err = await t.error(`select apply_movement('SALE', $1, null, 8, $2, null, 'test', 'Venta de prueba')`, [p.id, deposito]);
    assert.match(err, /Stock insuficiente/);
    assert.equal(await t.stock(p.id, deposito), 7);
  }));

test("transferencia mueve entre ubicaciones sin cambiar el total", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const { deposito, store } = await t.ubicaciones();
    const p = await t.producto({ stock: { [deposito]: 5 } });
    await t.filas(`select apply_movement('TRANSFER', $1, null, 2, $2, $3, 'test', 'Para venta Store')`, [p.id, deposito, store]);
    assert.equal(await t.stock(p.id, deposito), 3);
    assert.equal(await t.stock(p.id, store), 2);
  }));

test("la reversión devuelve el stock y no se puede revertir dos veces", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const { deposito } = await t.ubicaciones();
    const p = await t.producto({ stock: { [deposito]: 4 } });
    const venta = await t.valor(`select apply_movement('SALE', $1, null, 4, $2, null, 'test', 'Venta de prueba')`, [p.id, deposito]);
    assert.equal(await t.stock(p.id, deposito), 0);
    await t.filas(`select reverse_movement($1, 'test', 'Devolvió la clienta')`, [venta]);
    assert.equal(await t.stock(p.id, deposito), 4);
    assert.match(await t.error(`select reverse_movement($1, 'test', 'otra vez')`, [venta]), /ya fue revertido/);
    assert.equal(await t.stock(p.id, deposito), 4);
  }));

test("misma clave de idempotencia no descuenta dos veces", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const { deposito } = await t.ubicaciones();
    const p = await t.producto({ stock: { [deposito]: 10 } });
    const sql = `select apply_movement('SALE', $1, null, 2, $2, null, 'test', 'Venta', null, null, null, $3)`;
    const a = await t.valor(sql, [p.id, deposito, `test:${p.sku}`]);
    const b = await t.valor(sql, [p.id, deposito, `test:${p.sku}`]);
    assert.equal(a, b);
    assert.equal(await t.stock(p.id, deposito), 8);
  }));

test("los movimientos no se pueden modificar ni borrar", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const { deposito } = await t.ubicaciones();
    const p = await t.producto({ stock: { [deposito]: 1 } });
    const id = await t.valor(`select id from inventory_movements where product_id = $1`, [p.id]);
    assert.match(await t.error(`update inventory_movements set quantity = 99 where id = $1`, [id]), /append-only/);
    assert.match(await t.error(`delete from inventory_movements where id = $1`, [id]), /append-only/);
  }));

test("lo reservado por pedidos web no se puede vender a mano", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const { deposito } = await t.ubicaciones();
    const p = await t.producto({ stock: { [deposito]: 3 } });
    const sku = await t.equivalencia([{ producto: p, cantidad: 1 }]);
    const o = await t.pedido({ items: [{ sku, cantidad: 2 }] });
    await t.filas(`select wix_reserve_order($1, 'test')`, [o.id]);
    assert.equal(await t.disponible(p.id, deposito), 1);
    assert.match(await t.error(`select apply_movement('SALE', $1, null, 2, $2, null, 'test', 'Venta a mano')`, [p.id, deposito]), /reservadas por pedidos web/);
    await t.filas(`select apply_movement('SALE', $1, null, 1, $2, null, 'test', 'Venta a mano')`, [p.id, deposito]);
    assert.equal(await t.stock(p.id, deposito), 2);
  }));
