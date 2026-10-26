# Integración Wix ↔ Stock Melania

Stock Melania es la **fuente de verdad** del stock. Wix manda los pedidos; Melania reserva, descuenta y le devuelve a Wix el disponible y el estado "procesado".

## Cómo funciona (reglas de negocio, decididas con el dueño el 21–22/10/2026)

| Situación en Wix | Qué hace Melania |
|---|---|
| Pedido **web pagado** (`paymentStatus=PAID`) | Lo da de alta en **Pedidos Wix** y **reserva** cada producto en **Depósito** (no baja el físico; baja el disponible). |
| Operador lo **marca procesado en Melania** (`/pedidos/[id]`) | Egreso real `SALE` / `WHOLESALE_SALE` (SKU con `-MAY`) desde Depósito, lote por vencimiento (FEFO), con el **usuario como responsable**. Puede ser parcial: el resto sigue reservado. Melania crea el *fulfillment* en Wix. |
| Pedido **cancelado / reembolsado total** antes de procesar | Se libera la reserva. |
| Reembolso **después** de procesar | No devuelve stock solo. Aviso "a revisar"; si la clienta devuelve, se carga una devolución (RETURN_IN). |
| Alguien lo **marca procesado en Wix** a mano | No descuenta solo. Queda reservado con aviso "confirmá en Melania quién lo armó". |
| Venta en el **POS del local** (`channelInfo.type=POS`) | Egreso inmediato `SALE` desde **Store**, actor `wix` / responsable "Wix POS". **Karla no la carga a mano.** |
| Ítem con **SKU sin equivalencia** o sin SKU | No descuenta ese ítem; aviso en el pedido y en el Dashboard. Se carga en `/equivalencias` y se toca "Actualizar desde Wix". |
| Ítem que **no se pudo descontar** (sin SKU, sin equivalencia o sin stock) | Queda en **Pedidos Wix → Sin descontar** (`/pedidos/sin-descontar`). *Descontar*: se elige el producto de Melania y cantidad → egreso con el N° de pedido (Store si es POS, Depósito si es web); si no hay stock avisa y queda pendiente. *Descartar* (ADMIN/MANAGER, con motivo): no descuenta, queda registrado. Historial de lo regularizado en la misma pantalla. Las líneas regularizadas no se reintentan. |
| Pedido pagado hace **más de 3 días** sin procesar | Aviso rojo en el Dashboard. |
| Pedidos anteriores a la **primera conexión** | Se ignoran (`activated_at`). |
| **Kits** en Wix | Descuentan el stock propio del kit armado (no sus componentes). |
| Packs `-X10` / combos | Descuentan según `channel_sku_lines` (ej. 10 unidades, o varios productos). |

**Disponible = vendible − reservado** (vendible: lotes ACTIVE, sin caja cerrada, fuera de cuarentena). Se ve en Stock y en Nuevo movimiento; `apply_movement` rechaza egresos manuales que dejarían el vendible por debajo de lo reservado (exentos: conteos, reversiones, asignación de lote, rotura/vencido/cuarentena).

**Publicación a Wix** (opción en `/wix`): por cada SKU de Wix se manda el disponible de **Depósito**. Packs = `floor(disponible / unidades)`; combos = el componente que menos alcanza; variantes (`-MAY`, `-NAV`…) = igual que el principal. Wix descuenta su propio inventario al pagar; Melania lo sobreescribe en cada cambio.

**Pulsador de emergencia** (`/wix`, solo ADMIN): *Desconectar* con motivo → no entra ni sale nada de Wix; los eventos quedan en cola. *Conectar* → elegís procesar la cola (reserva/descuenta lo que falte) o descartarla (si ya lo cargaste a mano: además se ignora todo pedido anterior a ese momento, `ignore_before`, para que el sondeo no lo vuelva a traer). Mientras está desconectado, Karla vuelve a cargar las ventas del local a mano.

## Pantallas

- `/pedidos` (sección `pedidos`; todos los roles): lista para armar, filtros, "a revisar". `/pedidos/[id]`: detalle, disponible por producto, **Marcar como procesado y despachado** (total o parcial), "Actualizar desde Wix".
- `/wix` (ADMIN): pulsador, estado, herramientas (Probar conexión, Mapear catálogo, Sincronizar ahora, Publicar todo, Conciliar stock), opciones (publicar disponible, activar seguimiento en Wix), log de eventos con reintento.
- `/equivalencias` (sección `wix`): SKU de Wix → productos y cantidades.
- Dashboard: avisos de integración desconectada, pedidos demorados y pedidos a revisar.

## Arquitectura

- **App custom de Wix** (creada en `manage.wix.com/account/custom-apps` desde la cuenta de Davor e instalada en el sitio como colaborador). Auth OAuth `client_credentials` (token 4 h, en memoria). Webhooks firmados (JWT RS256) → `POST /api/wix/webhook`: se verifica la firma, se guarda en `integration_events` (idempotente por `event_id`) y se procesa después de responder (`after()`).
- **Reconciliar = releer el pedido en Wix y aplicar la regla** (`reconciliarPedido`): no importa el tipo ni el orden del evento. Polling de respaldo (`searchOrders` por `updatedDate`) en `GET /api/wix/sync` (`Authorization: Bearer WIX_SYNC_SECRET`), que también manda fulfillments pendientes y publica stock. Una vez por día la corrida también **concilia** (`conciliarInventario`): compara la cantidad que muestra Wix con la que publicaríamos, registra las diferencias en auditoría (`wix:inventory_diff`) y reencola esos productos. Lo dispara `pg_cron` cada 5 min (`wix_cron_sync`, migración `wix_cron`) o el botón "Sincronizar ahora".
- Código: `src/lib/wix/client.ts` (API), `processor.ts` (reglas, cola, polling, inventario, mapeo), `queries.ts`, `actions.ts`; rutas `src/app/api/wix/*`; páginas `src/app/pedidos`, `src/app/wix`.
- SQL (migración `wix_integracion`): `app_settings` (clave `wix`: enabled, activated_at, sync_inventory, enable_tracking, location_deposito/store, last_poll_at, catalog_version), `integration_events`, `channel_orders`, `channel_order_items`, `reservations`, `channel_order_fulfillments`, `wix_sync_queue`, vista `v_stock_disponible`, funciones `reserved_qty`, `sellable_on_hand`, `available_stock`, `wix_upsert_order`, `wix_reserve_order`, `wix_pos_sale`, `wix_process_order`, `wix_release_order`, `wix_mark_fulfilled_externally`, `wix_record_event`, `wix_set_enabled`, `wix_update_settings`. `channel_skus` suma `wix_product_id/variant_id/inventory_item_id/tracked` y datos de la última publicación.
- Doble envío del formulario de procesado: cada envío lleva un `batch` (uuid); si ya existe, no descuenta de nuevo. Fulfillments a Wix: hasta 5 intentos; si el pedido ya figura procesado en Wix se marca sincronizado sin llamar.
- Idempotencia de movimientos: `wix:<orderId>:<lineId>:<productId>:<consumido_antes>:<n>` (procesado) y `wix:<orderId>:<lineId>:<productId>:<n>` (POS).
- Catálogo Wix V1 vs V3: se detecta con `GET /stores/v3/provision/version` al mapear; el inventario se publica con la API que corresponda.

## Puesta en marcha (una vez)

1. **Crear la app en Wix**: `manage.wix.com/account/custom-apps` → Create app. Permisos: *Read/Manage Orders*, *Read/Manage Products*, *Read/Manage Stores inventory* (v1 y v3). Webhooks: eCommerce → Order Created, Order Approved, Order Payment Status Updated, Order Fulfilled, Order Canceled; Order Transactions → Refund Completed. URL: `https://stock-melania.vercel.app/api/wix/webhook`. Guardar **App ID**, **App Secret** y **Public key** (Webhooks).
2. **Instalarla en el sitio** de Melania (Install app / link de instalación). El `instanceId` se ve en el panel de la app (o llega en el webhook *App Instance Installed*).
3. **Variables en Vercel** (Production): `WIX_APP_ID`, `WIX_APP_SECRET`, `WIX_INSTANCE_ID`, `WIX_PUBLIC_KEY` (PEM con `\n`), `WIX_SYNC_SECRET` (cualquier string largo), opcional `WIX_SITE_ID`. Redeploy.
4. **Migraciones**: `supabase db push`. Luego en psql: insertar la fila `wix_sync` de `app_settings` (ver cabecera de `20261026130000_wix_cron.sql`).
5. En `/wix`: **Probar conexión** → **Mapear catálogo** (revisar SKU que faltan de un lado u otro) → opciones.
6. **Pruebas**: una venta chica en el POS (baja Store); un pedido web de prueba pagado (queda reservado) → procesarlo desde `/pedidos` (sale del stock y Wix lo marca procesado); cancelar uno (libera).
7. **Conectar** desde `/wix` y avisar a Joel que Karla deje de cargar las ventas a mano.

## Operación diaria (para Joel)

- **Juan / Francisco**: entran a *Pedidos Wix*, arman el pedido, lo abren y tocan *Marcar como procesado y despachado*. Si falta algo, bajan la cantidad y el resto queda reservado. No tocan Wix.
- **Avisos** en el Dashboard: *demorados* (+3 días) → armar; *a revisar* → abrir el pedido: cargar equivalencia faltante y "Actualizar desde Wix", revisar reembolso, o confirmar quién lo armó.
- **Producto/combo nuevo en Wix**: cargarlo en *Equivalencias Wix* con el mismo SKU y tocar *Mapear catálogo* en `/wix`.
- **Algo descuenta mal**: `/wix` → *Desconectar* con motivo. Se sigue todo a mano. Arreglado el problema, *Conectar* y elegir qué hacer con la cola.
- Las ventas Wix aparecen en *Ventas* con el N° de pedido (`1234`, igual que la carga manual) y en *Movimientos*; los POS con responsable "Wix POS".

## Pendiente / a verificar con pedidos reales

- Confirmar con un pedido real del POS que llega con `channelInfo.type=POS` y `paymentStatus=PAID`.
- Decidir si activar el seguimiento de inventario en Wix para los ~39 packs "Mayorista" (opción *Activar seguimiento*).
- Si Wix muestra stock 0 en productos vendidos solo desde Store, el POS puede bloquear la venta: ver con Joel si publicar Depósito+Store.
