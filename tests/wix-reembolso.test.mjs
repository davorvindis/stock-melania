// Reembolsos: botón Reembolso de pedidos web ya armados (total o parcial, vuelve o no
// al Depósito) y Volvió / No volvió de las ventas del local (POS).
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { enTransaccion, sinBase } from "./db.mjs";

// pedido web de `cantidad` unidades ya armado; el Depósito arranca con 10
async function pedidoArmado(t, cantidad = 3) {
  const { deposito } = await t.ubicaciones();
  const p = await t.producto({ stock: { [deposito]: 10 } });
  const sku = await t.equivalencia([{ producto: p, cantidad: 1 }]);
  const o = await t.pedido({ items: [{ sku, cantidad }] });
  await t.filas(`select wix_reserve_order($1, 'test')`, [o.id]);
  await t.armar(o.id);
  const [it] = await t.items(o.id);
  return { deposito, p, o, it };
}

const reembolsar = (t, o, lineas, vuelve, batch = randomUUID()) =>
  t.valor(`select wix_refund_order($1, $2, $3, 'test', $4)`, [o.id, JSON.stringify(lineas), vuelve, batch]);

test("reembolso total que vuelve: el stock vuelve y el pedido queda Reembolsado", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const { deposito, p, o, it } = await pedidoArmado(t, 3);
    assert.equal(await t.stock(p.id, deposito), 7);
    const r = await reembolsar(t, o, [{ item_id: it.id, quantity: 3 }], true);
    assert.equal(r.total, true);
    assert.equal(await t.stock(p.id, deposito), 10);
    const e = await t.pedidoEstado(o.id);
    assert.equal(e.state, "CANCELED");
    assert.equal(e.refund_resolution, "RETURNED");
    assert.equal(e.delivery_status, null);
  }));

test("reembolso parcial que vuelve: vuelve solo lo reembolsado y el resto sigue vendido", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const { deposito, p, o, it } = await pedidoArmado(t, 3);
    const r = await reembolsar(t, o, [{ item_id: it.id, quantity: 1 }], true);
    assert.equal(r.total, false);
    assert.equal(await t.stock(p.id, deposito), 8);
    assert.equal((await t.pedidoEstado(o.id)).state, "PROCESSED");
    // las ventas vigentes suman lo que se quedó la clienta
    const vendido = await t.valor(
      `select coalesce(sum(quantity), 0) from inventory_movements mv where product_id = $1 and type = 'SALE'
        and not exists (select 1 from inventory_movements x where x.reversal_of = mv.id)`, [p.id]);
    assert.equal(Number(vendido), 2);
    // después se reembolsa el resto
    await reembolsar(t, o, [{ item_id: it.id, quantity: 2 }], true);
    assert.equal(await t.stock(p.id, deposito), 10);
    assert.equal((await t.pedidoEstado(o.id)).state, "CANCELED");
  }));

test("reembolso que no vuelve: el stock no se toca", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const { deposito, p, o, it } = await pedidoArmado(t, 2);
    await reembolsar(t, o, [{ item_id: it.id, quantity: 2 }], false);
    assert.equal(await t.stock(p.id, deposito), 8);
    const e = await t.pedidoEstado(o.id);
    assert.equal(e.state, "CANCELED");
    assert.equal(e.refund_resolution, "NOT_RETURNED");
  }));

test("no se puede reembolsar más de lo vendido (ni dos veces lo mismo)", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const { o, it } = await pedidoArmado(t, 2);
    assert.match(await t.error(`select wix_refund_order($1, $2, true, 'test', $3)`, [o.id, JSON.stringify([{ item_id: it.id, quantity: 3 }]), randomUUID()]), /hasta 2/);
    await reembolsar(t, o, [{ item_id: it.id, quantity: 1 }], false);
    assert.match(await t.error(`select wix_refund_order($1, $2, true, 'test', $3)`, [o.id, JSON.stringify([{ item_id: it.id, quantity: 2 }]), randomUUID()]), /hasta 1/);
  }));

test("mismo formulario enviado dos veces no reembolsa dos veces", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const { deposito, p, o, it } = await pedidoArmado(t, 3);
    const batch = randomUUID();
    await reembolsar(t, o, [{ item_id: it.id, quantity: 1 }], true, batch);
    const otra = await reembolsar(t, o, [{ item_id: it.id, quantity: 1 }], true, batch);
    assert.equal(otra.repeated, true);
    assert.equal(await t.stock(p.id, deposito), 8);
  }));

test("si la venta ya se revirtió a mano en Movimientos, avisa en vez de devolver de más", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const { deposito, p, o, it } = await pedidoArmado(t, 2);
    const venta = await t.valor(`select id from inventory_movements where product_id = $1 and type = 'SALE'`, [p.id]);
    await t.filas(`select reverse_movement($1, 'test', 'Revertido a mano')`, [venta]);
    assert.match(await t.error(`select wix_refund_order($1, $2, true, 'test', $3)`, [o.id, JSON.stringify([{ item_id: it.id, quantity: 1 }]), randomUUID()]), /revirtió a mano/);
    assert.equal(await t.stock(p.id, deposito), 10);
  }));

test("un pedido sin armar no usa el botón Reembolso (se libera solo)", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const { deposito } = await t.ubicaciones();
    const p = await t.producto({ stock: { [deposito]: 5 } });
    const sku = await t.equivalencia([{ producto: p, cantidad: 1 }]);
    const o = await t.pedido({ items: [{ sku, cantidad: 1 }] });
    await t.filas(`select wix_reserve_order($1, 'test')`, [o.id]);
    const [it] = await t.items(o.id);
    assert.match(await t.error(`select wix_refund_order($1, $2, true, 'test', $3)`, [o.id, JSON.stringify([{ item_id: it.id, quantity: 1 }]), randomUUID()]), /todavía no se armó/);
  }));

// venta del local de `cantidad` unidades; el Store arranca con 5
async function ventaPos(t, cantidad = 2) {
  const { store } = await t.ubicaciones();
  const p = await t.producto({ stock: { [store]: 5 } });
  const sku = await t.equivalencia([{ producto: p, cantidad: 1 }]);
  const o = await t.pedido({ canal: "POS", envio: null, items: [{ sku, cantidad }] });
  await t.filas(`select wix_pos_sale($1, 'Wix POS')`, [o.id]);
  return { store, p, o };
}

test("venta del POS: se descuenta del Store y queda Retirado", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const { store, p, o } = await ventaPos(t, 2);
    assert.equal(await t.stock(p.id, store), 3);
    await t.filas(`select wix_pos_mark_picked_up($1)`, [o.id]);
    const e = await t.pedidoEstado(o.id);
    assert.equal(e.state, "PROCESSED");
    assert.equal(e.delivery_status, "PICKED_UP");
    // procesarla de nuevo no descuenta otra vez
    await t.filas(`select wix_pos_sale($1, 'Wix POS')`, [o.id]);
    assert.equal(await t.stock(p.id, store), 3);
  }));

test("reembolso del POS: Volvió al Store devuelve el stock; No volvió no lo toca", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const a = await ventaPos(t, 2);
    assert.match(await t.error(`select wix_pos_refund($1, true, 'test')`, [a.o.id]), /no figura reembolsada/);
    await t.filas(`update channel_orders set payment_status = 'FULLY_REFUNDED' where id = $1`, [a.o.id]);
    await t.filas(`select wix_pos_refund($1, true, 'test')`, [a.o.id]);
    assert.equal(await t.stock(a.p.id, a.store), 5);
    assert.equal((await t.pedidoEstado(a.o.id)).refund_resolution, "RETURNED");
    // contestar de nuevo no hace nada
    assert.equal(await t.valor(`select wix_pos_refund($1, true, 'test')`, [a.o.id]), "sin-cambios");
    assert.equal(await t.stock(a.p.id, a.store), 5);

    const b = await ventaPos(t, 2);
    await t.filas(`update channel_orders set payment_status = 'FULLY_REFUNDED' where id = $1`, [b.o.id]);
    await t.filas(`select wix_pos_refund($1, false, 'test')`, [b.o.id]);
    assert.equal(await t.stock(b.p.id, b.store), 3);
    const e = await t.pedidoEstado(b.o.id);
    assert.equal(e.state, "CANCELED");
    assert.equal(e.refund_resolution, "NOT_RETURNED");
  }));
