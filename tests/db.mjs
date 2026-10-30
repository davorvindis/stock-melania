// Ayudas para los tests de la base. Local usa la MISMA base que producción, así que cada
// test corre dentro de una transacción que SIEMPRE se deshace (rollback): crea su propio
// producto, equivalencia y pedido de prueba, y al terminar no queda nada.
import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";

// la contraseña sale de .env.local (nunca se imprime)
function cargarEnv() {
  if (process.env.SUPABASE_DB_PASSWORD) return;
  const ruta = new URL("../.env.local", import.meta.url);
  if (!existsSync(ruta)) return;
  for (const linea of readFileSync(ruta, "utf8").split("\n")) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
cargarEnv();

export const hayBase = !!process.env.SUPABASE_DB_PASSWORD;
export const sinBase = hayBase ? false : "falta SUPABASE_DB_PASSWORD en .env.local: se saltean los tests de la base";

// corre fn(t) dentro de BEGIN … ROLLBACK
export async function enTransaccion(fn) {
  const c = new pg.Client({
    host: "aws-0-sa-east-1.pooler.supabase.com",
    port: 5432,
    user: "postgres.kpybwbjhiitezthammhz",
    password: process.env.SUPABASE_DB_PASSWORD,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  try {
    await c.query("begin");
    // que un test trabado nunca frene a producción
    await c.query("set local lock_timeout = '5s'; set local statement_timeout = '30s'");
    // probar una migración todavía no aplicada: TEST_SQL=supabase/migrations/xxx.sql npm test
    if (process.env.TEST_SQL) await c.query(readFileSync(process.env.TEST_SQL, "utf8"));
    await fn(new Ayuda(c));
  } finally {
    await c.query("rollback").catch(() => {});
    await c.end();
  }
}

class Ayuda {
  constructor(c) {
    this.c = c;
  }

  async filas(sql, params = []) {
    return (await this.c.query(sql, params)).rows;
  }

  async fila(sql, params = []) {
    return (await this.filas(sql, params))[0];
  }

  async valor(sql, params = []) {
    const f = await this.fila(sql, params);
    return f ? Object.values(f)[0] : undefined;
  }

  // ejecuta y devuelve el mensaje de error esperado (falla si NO da error)
  async error(sql, params = []) {
    await this.c.query("savepoint esperado");
    try {
      await this.c.query(sql, params);
    } catch (e) {
      await this.c.query("rollback to savepoint esperado");
      return e.message;
    }
    await this.c.query("release savepoint esperado");
    throw new Error(`Se esperaba un error y no lo hubo: ${sql}`);
  }

  async ubicaciones() {
    const v = await this.valor(`select value from app_settings where key = 'wix'`);
    return { deposito: v.location_deposito, store: v.location_store };
  }

  // producto nuevo, sin lotes, con stock inicial opcional en cada ubicación
  async producto({ nombre = "Producto de prueba", stock = {} } = {}) {
    const sku = `TEST-${randomUUID().slice(0, 8).toUpperCase()}`;
    const id = await this.valor(
      `insert into products (sku, name, unit, tracks_lot, tracks_expiry) values ($1, $2, 'unidad', false, false) returning id`,
      [sku, `${nombre} ${sku}`]
    );
    for (const [loc, cant] of Object.entries(stock)) {
      if (cant > 0) await this.c.query(`select apply_movement('RECEIPT', $1, null, $2, null, $3, 'test', 'Stock de prueba')`, [id, cant, loc]);
    }
    return { id, sku };
  }

  // SKU de Wix que descuenta `lineas` = [{producto, cantidad}]
  async equivalencia(lineas) {
    const sku = `TEST-WIX-${randomUUID().slice(0, 8).toUpperCase()}`;
    const id = await this.valor(`insert into channel_skus (channel, external_sku, active, publish_stock) values ('WIX', $1, true, true) returning id`, [sku]);
    for (const l of lineas) {
      await this.c.query(`insert into channel_sku_lines (channel_sku_id, product_id, quantity) values ($1, $2, $3)`, [id, l.producto.id, l.cantidad]);
    }
    return sku;
  }

  // pedido pagado de Wix con sus ítems [{sku, cantidad}]
  async pedido({ canal = "WEB", items, envio = "ENVIO POR CORREO ARGENTINO" }) {
    const externo = `test-${randomUUID()}`;
    const raw = envio ? { shippingInfo: { title: envio } } : {};
    const id = await this.valor(
      `insert into channel_orders (external_id, number, channel_type, state, payment_status, wix_status, ordered_at, raw)
       values ($1, $2, $3, 'NEW', 'PAID', 'APPROVED', now(), $4) returning id`,
      [externo, `T${externo.slice(5, 11)}`, canal, raw]
    );
    let n = 0;
    for (const it of items) {
      n++;
      await this.c.query(
        `insert into channel_order_items (order_id, external_line_id, external_sku, name, quantity) values ($1, $2, $3, $4, $5)`,
        [id, `linea-${n}`, it.sku, it.nombre ?? it.sku, it.cantidad]
      );
    }
    return { id, externo };
  }

  async items(pedidoId) {
    return this.filas(`select id, external_sku, quantity from channel_order_items where order_id = $1 order by external_line_id`, [pedidoId]);
  }

  async pedidoEstado(pedidoId) {
    return this.fila(`select state, review_reason, refund_resolution, delivery_status from channel_orders where id = $1`, [pedidoId]);
  }

  // stock físico de un producto en una ubicación
  async stock(productoId, loc) {
    return Number(await this.valor(`select coalesce(sum(quantity), 0) from stock_balances where product_id = $1 and location_id = $2`, [productoId, loc]));
  }

  // disponible = vendible − reservado
  async disponible(productoId, loc) {
    return Number(await this.valor(`select available_stock($1, $2)`, [productoId, loc]));
  }

  async armar(pedidoId, lineas = null, batch = randomUUID()) {
    return this.valor(`select wix_process_order($1, $2, null, 'test', $3)`, [pedidoId, lineas ? JSON.stringify(lineas) : null, batch]);
  }
}
