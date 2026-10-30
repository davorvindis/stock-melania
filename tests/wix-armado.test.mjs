// Pedidos web: reserva al pagar, armado (procesado) que descuenta del Depósito,
// armado parcial, doble click y avisos de faltante.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { enTransaccion, sinBase } from "./db.mjs";

test("al pagar se reserva en el Depósito sin tocar el stock físico", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const { deposito } = await t.ubicaciones();
    const p = await t.producto({ stock: { [deposito]: 10 } });
    const sku = await t.equivalencia([{ producto: p, cantidad: 1 }]);
    const o = await t.pedido({ items: [{ sku, cantidad: 3 }] });
    assert.equal(await t.valor(`select wix_reserve_order($1, 'test')`, [o.id]), "reserved");
    assert.equal((await t.pedidoEstado(o.id)).state, "RESERVED");
    assert.equal(await t.stock(p.id, deposito), 10);
    assert.equal(await t.disponible(p.id, deposito), 7);
    // reservar de nuevo no duplica
    await t.filas(`select wix_reserve_order($1, 'test')`, [o.id]);
    assert.equal(await t.disponible(p.id, deposito), 7);
  }));

test("un pack reserva y descuenta las unidades de cada producto", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const { deposito } = await t.ubicaciones();
    const a = await t.producto({ stock: { [deposito]: 20 } });
    const b = await t.producto({ stock: { [deposito]: 20 } });
    const combo = await t.equivalencia([{ producto: a, cantidad: 4 }, { producto: b, cantidad: 1 }]);
    const o = await t.pedido({ items: [{ sku: combo, cantidad: 2 }] });
    await t.filas(`select wix_reserve_order($1, 'test')`, [o.id]);
    assert.equal(await t.disponible(a.id, deposito), 12);
    assert.equal(await t.disponible(b.id, deposito), 18);
    await t.armar(o.id);
    assert.equal(await t.stock(a.id, deposito), 12);
    assert.equal(await t.stock(b.id, deposito), 18);
  }));

test("armar descuenta del Depósito, deja el pedido Procesado y registra la venta con el N°", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const { deposito } = await t.ubicaciones();
    const p = await t.producto({ stock: { [deposito]: 10 } });
    const sku = await t.equivalencia([{ producto: p, cantidad: 1 }]);
    const o = await t.pedido({ items: [{ sku, cantidad: 3 }] });
    await t.filas(`select wix_reserve_order($1, 'test')`, [o.id]);
    await t.armar(o.id);
    assert.equal((await t.pedidoEstado(o.id)).state, "PROCESSED");
    assert.equal(await t.stock(p.id, deposito), 7);
    assert.equal(await t.disponible(p.id, deposito), 7);
    const ventas = await t.filas(`select type, quantity, reason from inventory_movements where product_id = $1 and type = 'SALE'`, [p.id]);
    assert.equal(ventas.length, 1);
    assert.equal(Number(ventas[0].quantity), 3);
    const numero = await t.valor(`select number from channel_orders where id = $1`, [o.id]);
    assert.equal(ventas[0].reason, numero);
  }));

test("armado parcial: lo que falta sigue reservado y se arma después", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const { deposito } = await t.ubicaciones();
    const p = await t.producto({ stock: { [deposito]: 10 } });
    const sku = await t.equivalencia([{ producto: p, cantidad: 1 }]);
    const o = await t.pedido({ items: [{ sku, cantidad: 3 }] });
    await t.filas(`select wix_reserve_order($1, 'test')`, [o.id]);
    const [it] = await t.items(o.id);
    await t.armar(o.id, [{ item_id: it.id, quantity: 1 }]);
    assert.equal((await t.pedidoEstado(o.id)).state, "PARTIAL");
    assert.equal(await t.stock(p.id, deposito), 9);
    assert.equal(await t.disponible(p.id, deposito), 7);
    assert.match(await t.error(`select wix_process_order($1, $2, null, 'test', $3)`, [o.id, JSON.stringify([{ item_id: it.id, quantity: 5 }]), randomUUID()]), /pendientes/);
    await t.armar(o.id);
    assert.equal((await t.pedidoEstado(o.id)).state, "PROCESSED");
    assert.equal(await t.stock(p.id, deposito), 7);
  }));

test("doble click al armar no descuenta dos veces", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const { deposito } = await t.ubicaciones();
    const p = await t.producto({ stock: { [deposito]: 10 } });
    const sku = await t.equivalencia([{ producto: p, cantidad: 1 }]);
    const o = await t.pedido({ items: [{ sku, cantidad: 2 }] });
    await t.filas(`select wix_reserve_order($1, 'test')`, [o.id]);
    const batch = randomUUID();
    await t.armar(o.id, null, batch);
    const otra = await t.armar(o.id, null, batch);
    assert.equal(otra.repeated, true);
    assert.equal(await t.stock(p.id, deposito), 8);
    // y un pedido ya procesado no se vuelve a armar
    assert.match(await t.error(`select wix_process_order($1, null, null, 'test', $2)`, [o.id, randomUUID()]), /no está reservado/);
  }));

test("cancelado sin armar: la reserva se libera", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const { deposito } = await t.ubicaciones();
    const p = await t.producto({ stock: { [deposito]: 5 } });
    const sku = await t.equivalencia([{ producto: p, cantidad: 1 }]);
    const o = await t.pedido({ items: [{ sku, cantidad: 2 }] });
    await t.filas(`select wix_reserve_order($1, 'test')`, [o.id]);
    await t.filas(`select wix_release_order($1, 'Cancelado en Wix', 'test')`, [o.id]);
    assert.equal(await t.disponible(p.id, deposito), 5);
    assert.equal(await t.stock(p.id, deposito), 5);
  }));

test("falta stock en Depósito: el aviso dice si está en el Store", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const { deposito, store } = await t.ubicaciones();
    const enStore = await t.producto({ nombre: "Film prueba", stock: { [store]: 3 } });
    const enNingunLado = await t.producto({ nombre: "Kit prueba" });
    const a = await t.equivalencia([{ producto: enStore, cantidad: 1 }]);
    const b = await t.equivalencia([{ producto: enNingunLado, cantidad: 1 }]);
    const o = await t.pedido({ items: [{ sku: a, cantidad: 1 }, { sku: b, cantidad: 1 }] });
    await t.filas(`select wix_reserve_order($1, 'test')`, [o.id]);
    const { review_reason } = await t.pedidoEstado(o.id);
    assert.match(review_reason, /^Falta stock en Depósito: /);
    assert.match(review_reason, new RegExp(`Film prueba ${enStore.sku} \\(hay 3 en el Store, pasalo al Depósito\\)`));
    assert.match(review_reason, new RegExp(`Kit prueba ${enNingunLado.sku}(,|$)`));
    assert.equal(await t.disponible(enStore.id, deposito), -1);
  }));

test("SKU sin equivalencia queda A revisar y no descuenta nada", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const o = await t.pedido({ items: [{ sku: "TEST-NO-EXISTE", cantidad: 1 }] });
    await t.filas(`select wix_reserve_order($1, 'test')`, [o.id]);
    assert.match((await t.pedidoEstado(o.id)).review_reason, /Sin equivalencia: TEST-NO-EXISTE/);
  }));

test("el método de entrega se calcula para filtrar y ordenar Para armar", { skip: sinBase }, () =>
  enTransaccion(async (t) => {
    const casos = [
      ["MOTOMENSAJERIA - SOLO CABA", "WEB", 1],
      ["ENVIO POR CORREO ARGENTINO ", "WEB", 2],
      ["RETIRO EN SUCURSAL RECOLETA", "WEB", 3],
      [null, "POS", 3],
      [null, "WEB", 9],
    ];
    for (const [envio, canal, rango] of casos) {
      const o = await t.pedido({ canal, envio, items: [] });
      assert.equal(await t.valor(`select delivery_rank from channel_orders where id = $1`, [o.id]), rango, `${envio} / ${canal}`);
    }
  }));
