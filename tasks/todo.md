# Plan — Integración Wix ↔ Stock Melania (21/10/2026)

**Estado 22/10:** Fases 1–4 programadas y build OK. Falta: aplicar migraciones (`supabase db push`, bloqueado por permisos), crear la app en Wix + env vars (Fase 0), mapear catálogo, pruebas reales (Fase 5), `git push`.

Objetivo: Stock Melania = stock real. Wix manda pedidos; nosotros reservamos (web pagado), descontamos al procesar (con responsable), vendemos al instante lo del POS desde Store, publicamos disponible hacia Wix. Pulsador de emergencia ON/OFF.

## Hallazgos que condicionan el diseño
- Repo local estaba 35 commits atrás → ya actualizado (`git pull`). `channel_skus`/`resolve_channel_sku` existen; `reservations`/`integration_events` NO.
- `apply_movement_batch` líneas no-kit NO hacen FEFO (solo `is_kit` usa `_consume_fefo`) → el egreso Wix debe llamar `_consume_fefo` por producto.
- "Disponible" hoy se calcula en TS (`isAvailable`, queries.ts:236); no existe reservado ni disponible por ubicación → va a SQL.
- `locations` no tiene `code`; se identifican por nombre ("Depósito"/"Store", renombrables) → guardar ids en settings.
- `inventory_movements.reason` = N° de pedido (así agrupa /ventas) → pedidos Wix: `reason = "Wix #<number>"`, mismo `occurred_at` por pedido.
- `proxy.ts` solo deja pasar `/api/backup` sin sesión → agregar `/api/wix/*` con verificación propia.
- Wix: API Key solo sirve desde la CUENTA dueña del sitio (no colaborador). Custom app (manage.wix.com/account/custom-apps) se crea desde cuenta propia, se instala como colaborador, da webhooks firmados (JWT RS256) + OAuth client_credentials (token 4h). → Recomendado.
- Wix descuenta su propio inventario al pagar (no desactivable salvo "sin seguimiento"). Nosotros sobrescribimos con cantidad absoluta → OK siendo fuente de verdad.
- Webhook debe responder 200 en <1,25 s; reintentos 12 veces; duplicados/desorden posibles → guardar evento + `after()` para procesar + cron de reconciliación (`searchOrders` por `updatedDate`).
- Vercel Hobby: cron solo 1×/día → reconciliación cada 5 min vía pg_cron+pg_net de Supabase (gratis) pegándole a `/api/wix/sync` con secret. (o Vercel Pro)
- Catálogo Wix V1 vs V3 cambia la API de inventario → chequear `GET /stores/v3/provision/version` primero.
- Conflicto kits: docs dicen kit = stock propio armado; WIX_V2 dice expandir componentes → decidir (pregunta 2).

## Fase 0 — Acceso Wix (bloqueante, manual + verificación)
- [ ] Confirmar rol: ¿cuenta co-owner o colaborador de sitio? → crear Custom App desde cuenta Davor
- [ ] Scopes: Read/Manage Orders, Read/Manage Products, Inventory read/write (v1 y v3)
- [ ] Webhooks: order created/approved/payment_status_updated/fulfilled/canceled, transactions refund_completed, app instance installed
- [ ] Instalar en sitio Melania; capturar `instanceId`; env Vercel: `WIX_APP_ID`, `WIX_APP_SECRET`, `WIX_PUBLIC_KEY`, `WIX_INSTANCE_ID`, `WIX_SYNC_SECRET`
- [ ] Script `scripts/wix-check.ts`: token OK, versión catálogo, listar 276 SKU Wix ↔ `channel_skus` (faltantes/sobrantes), 39 sin tracking
- [x] Guardar `wix_product_id`/`wix_variant_id`/`wix_inventory_item_id` en `channel_skus` (migración + script de mapeo)

## Fase 1 — Modelo y reglas SQL (migración `wix_integracion`)
- [x] `app_settings(key pk, value jsonb, updated_at, updated_by)`: `wix.enabled` (pulsador), `wix.paused_reason`, `wix.location_deposito`, `wix.location_store`, `wix.sync_inventory`, `wix.activated_at` (ignorar pedidos anteriores), `wix.last_poll_at`
- [x] `integration_events(id, channel, event_id unique, event_type, entity_id, payload, received_at, processed_at, status PENDING|DONE|ERROR|SKIPPED|PAUSED, attempts, error)`
- [x] `channel_orders(id, channel, external_id unique, number, channel_type WEB|POS|..., customer, email, wix_status, payment_status, fulfillment_status, state RESERVED|PARTIAL|PROCESSED|RELEASED|CANCELED|REVIEW, location_id, paid_at, processed_at, processed_by_id, processed_by, review_reason, raw jsonb, timestamps)`
- [x] `channel_order_items(order_id, wix_line_id, external_sku, name, quantity, resolved bool, note)`
- [x] `reservations(id, order_id, item_id, product_id, location_id, quantity, consumed, released, status ACTIVE|CONSUMED|RELEASED, created_at)`
- [x] Vista/func `reserved_qty(product, location)` + `available_stock(product, location)` = on_hand ACTIVE/no sealed/no cuarentena − reservado
- [x] `apply_movement` y `_consume_fefo`: egresos (SALE, WHOLESALE_SALE, TRANSFER, SAMPLE, GIFT, SUPPLIER_SEND, INTERNAL_USE…) rechazan si `qty > available_stock` (exentos: REVERSAL, COUNT_ADJUSTMENT, LOT_ASSIGNMENT, KIT_*)
- [x] `wix_upsert_order(p_payload jsonb)` → upsert pedido+items, `resolve_channel_sku`×cantidad; SKU sin equivalencia → item `resolved=false`, pedido `REVIEW`
- [x] `wix_reserve_order(p_order)` idempotente (web pagado → Depósito)
- [x] `wix_pos_sale(p_order, p_idem)` → egreso inmediato SALE desde Store, FEFO, actor `wix-pos`, reason `Wix #n`
- [x] `wix_process_order(p_order, p_lines jsonb [{item_id, quantity}], p_actor_id, p_actor)` → consume reserva (parcial ok), egreso SALE/WHOLESALE_SALE FEFO con idem `wix:<order>:<item>:<n>`, guarda responsable, devuelve líneas para fulfillment en Wix
- [x] `wix_release_order(p_order, p_reason)` → libera reservas activas (cancelado/reembolso antes de procesar)
- [x] Reembolso después de procesar → NO mueve stock; `state=REVIEW` + aviso (devolución se carga a mano como RETURN_IN)
- [x] Alta `wix.enabled=false` por default; `backup.ts` TABLAS += nuevas tablas; CATEGORIAS_AUDITORIA += `wix:`
- [x] Tests en psql `begin; … rollback;` de cada función (reserva, disponible, parcial, idempotencia, liberar, sealed)

## Fase 2 — Entrada de eventos + pulsador
- [x] `src/lib/wix/client.ts`: token client_credentials con cache en memoria (4h), `getOrder`, `searchOrders`, `createFulfillment`, inventario (v1/v3 según versión)
- [x] `src/app/api/wix/webhook/route.ts`: `req.text()`, verificar JWT RS256 con public key, insertar `integration_events` (dedupe `event_id`), responder 200, `after()` → procesar
- [x] `src/lib/wix/processor.ts`: por evento → `getOrder` fresco (no confiar en payload viejo) → reglas: PAID+WEB → reservar; POS (APPROVED/PAID) → venta Store; FULFILLED hecho en Wix por otro → ver pregunta 7; CANCELED/refund → liberar o REVIEW
- [x] Pulsador OFF: eventos se guardan como `PAUSED`, nada se procesa ni se publica a Wix. ON: pantalla ofrece "procesar pendientes" / "descartar"
- [x] `proxy.ts`: bypass `/api/wix/*`
- [x] Pantalla `/wix` (ADMIN): estado (ON/OFF, último evento, último poll, pendientes, errores), botón pulsador con motivo, log de eventos con reintento manual, "Sincronizar stock ahora", "Probar conexión"
- [x] Sección `wix` ya existe (Equivalencias) → agregar `pedidos` nueva con default OPERATOR=true (Juan/Francisco)

## Fase 3 — Pedidos y procesado con responsable
- [x] `/pedidos`: lista (filtros estado/canal/fecha; >3 días pagados sin procesar resaltados), tarjetas mobile
- [x] `/pedidos/[id]`: ítems, equivalencias resueltas, stock disponible por línea, botón "Marcar procesado" (todo o parcial por cantidad), registra `processed_by` = usuario de sesión
- [x] Action `procesarPedido` → `wix_process_order` → `createFulfillment` en Wix (líneas procesadas) → si Wix falla: stock ya descontado, marcar `fulfillment_pending` y reintento por cron
- [x] Dashboard: avisos "pedidos pagados >3 días", "pedidos a revisar" (SKU sin equivalencia / reembolso post-proceso / stock insuficiente), "integración Wix pausada"
- [x] Stock y Nuevo movimiento: columnas Reservado y Disponible; error claro "Reservado por pedidos web"
- [ ] /ventas: pedidos Wix agrupados por `reason` (verificar que agrupe bien)

## Fase 4 — Reconciliación y publicación de stock a Wix
- [x] `/api/wix/sync` (secret header): `searchOrders` desde `last_poll_at − 1h`, aplica reglas a lo que falte (idempotente); programado con pg_cron cada 5 min (o Vercel Pro)
- [x] Cola `wix_sync_queue(product_id)` marcada por trigger en `stock_balances`/`reservations`; flush en `after()` tras cada action y en el cron: calcula disponible Depósito por SKU Wix (packs = floor(disp/n), combos = min(componente/cant), variantes -MAY etc. = igual al principal), push absoluto (v1 `updateInventoryVariants` con `trackQuantity:true` / v3 bulk update con revision fresca)
- [ ] Activar tracking en los ~39 productos (previa decisión del dueño)
- [ ] Reconciliación diaria: comparar Wix vs nuestro disponible, log de diferencias

## Fase 5 — Pruebas reales, activación, docs
- [ ] Venta chica POS con Karla → baja Store (verificar `channelInfo.type=POS`, estados iniciales)
- [ ] Pedido web de prueba → pagado reserva Depósito; procesado desde /pedidos → egreso + fulfilled en Wix
- [ ] Cancelación de prueba → libera
- [ ] Prender pulsador en prod; avisar a Joel que Karla deje de cargar ventas a mano
- [x] docs/WIX_V2.md → guía de operación (para Joel: cómo ver pedidos, procesar, pulsador, equivalencias, qué hacer en cada aviso); docs/DATABASE.md; .env.example; guía corta para Juan/Francisco
- [x] tasks/lessons.md

## Decisiones (Joel 22/10)
- Kit en Wix → descuenta stock propio del kit armado (NO componentes).
- `-MAY` → WHOLESALE_SALE; resto SALE; por línea.
- Publicar a Wix solo disponible Depósito. POS descuenta de Store.
- Packs -X10 descuentan 10 (ya en equivalencias). Publicación: floor(disp/n) (default, sin objeción).
- Pedido marcado procesado a mano en Wix: NO descuenta solo. Queda reservado + aviso "procesado en Wix, confirmar"; el operador del depósito lo confirma en Melania y queda como responsable.
- Solo registrar quién procesó (sin restringir por canal).
- Sin respuesta (defaults): ignorar pedidos previos a activación; pulsador OFF encola; pg_cron; líneas sin SKU → aviso; tracking 39 packs → pendiente (fase 4).

## Preguntas sin resolver (respondé con número)
1. ¿Sos co-owner de la CUENTA Wix o solo colaborador del sitio? (Define: custom app desde tu cuenta, sin key de Joel)
2. Kit en Wix: ¿descuenta stock propio del kit armado (modelo actual) o componentes? Default: kit armado.
3. Minorista vs mayorista: ¿sufijo `-MAY` → WHOLESALE_SALE, resto SALE? ¿Pedido mixto por línea? Default: sí.
4. Stock publicado a Wix: ¿solo disponible Depósito? ¿O Depósito+Store? Default: Depósito. (POS con Wix en 0: ¿bloquea venta? probar)
5. Packs `-X10` publicar `floor(disp/10)`, combos `min(componentes)`. ¿OK?
6. Pedidos pagados ANTES de activar: ¿ignorar (default) o importar como reservados?
7. Pedido marcado "procesado" a mano en Wix (no desde Melania): ¿descontar igual sin responsable + aviso (default) o dejar en revisar sin descontar?
8. Pulsador OFF: eventos que lleguen quedan en cola; al prender, admin elige procesar/descartar. ¿OK?
9. Cron 5 min: Vercel Hobby no lo permite → pg_cron Supabase (gratis, default) o Vercel Pro (USD 20/mes)?
10. Líneas sin SKU / digitales / servicios: ignorar línea + aviso. ¿OK?
11. Prohibir que operador Juan/Francisco procese pedidos del otro canal, o solo registrar quién fue? Default: solo registrar.
12. ¿Activar seguimiento de inventario en los ~39 packs "Mayorista 10/20/30%" en Wix? Si no, no se publica stock de esos.
