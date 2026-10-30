import { A, ADMIN, ENCARGADA, L, N, P, S, T, solo, type Capitulo } from "./tipos";

// Manual de uso. REGLA: toda mejora que cambie cómo se usa la app actualiza este archivo en
// el mismo cambio (ver CLAUDE.md). Cada parte lleva `ver` con la pestaña o el rol que hace
// falta para verla; lo que no tiene `ver` lo ven todos.

export const ACTUALIZADO = "30 de octubre de 2026";

export const MANUAL: Capitulo[] = [
  {
    id: "ideas",
    titulo: "Antes de empezar: ideas clave",
    bloques: [
      N([
        "**El sistema es la verdad del stock.** Si algo entra, sale o se mueve y no se carga, para el sistema no pasó. Cargá todo en el momento.",
        "**El stock no se escribe a mano.** Se calcula solo con lo que entra (ingresos) y lo que sale o se mueve (movimientos).",
        "**Todo queda registrado:** quién, cuándo, qué producto, cuánto y por qué. Nada se borra.",
        "**Si te equivocás, no pasa nada:** se corrige con una reversión (la hace Yura o un administrador). No cargues otro movimiento \"al revés\": avisá.",
        "**Cada producto está en un lugar** (Depósito, Store, un laboratorio…). Si cambia de lugar pero sigue siendo de Melania, es una **Transferencia**.",
        "**Las ventas de Wix se descuentan solas.** Las del POS del local y las de la tienda web llegan solas al sistema: **no se cargan a mano**.",
        "**La web muestra el stock de Melania.** Lo que se vende en Wix sale de lo que hay cargado acá. Si algo figura \"Agotado\" en la web pero está físicamente, es que falta cargarlo en Melania.",
      ]),
    ],
  },
  {
    id: "entrar",
    titulo: "Cómo entrar y moverse",
    bloques: [
      L([
        "Entrá a **stock-melania.vercel.app** desde la compu o el celular.",
        "**Usuario:** tu alias, email o DNI. **PIN:** 6 números. La primera vez usás el PIN temporal que te da el administrador y elegís el tuyo. Si te lo olvidás, pedí que te lo blanqueen.",
        "Arriba a la derecha ves tu nombre, tu ubicación de trabajo (por ejemplo, Store) y este **Manual**.",
        "**El menú está agrupado** (Dashboard · Ventas · Pedidos Wix · Stock · Productos y compras · Equipo · Ajustes). Tocás un grupo y abajo aparece una segunda fila con sus pestañas. Quien tiene pocas pestañas las ve todas en una sola fila.",
        "Este manual muestra **solo lo que vos tenés habilitado**. Si te habilitan una pestaña nueva, su explicación aparece sola acá.",
      ]),
      A("Usá siempre tu propio usuario: el sistema registra quién hizo cada cosa. No compartan el PIN.", "Tu usuario es personal"),
    ],
  },
  {
    id: "equipo",
    titulo: "El equipo: quién hace qué",
    bloques: [
      T(["Persona", "Ubicación", "Qué hace"], [
        ["**Karla**", "Store (fija)", "Vende con el **POS de Wix**: esas ventas se descuentan solas del Store y quedan como **Retirado**, **no las carga**. Solo ve y mueve el stock del Store. También puede armar pedidos web."],
        ["**Juan y Francisco**", "Depósito", "Cargan ingresos y movimientos. Arman los pedidos web en **Pedidos Wix**, los marcan como **procesados** y después como **despachados** o **retirados**."],
        ["**Yura** (encargada)", "Depósito", "Además corrige (revertir, ajustar, asignar lotes, separar blisters), carga los pedidos mayoristas en Wix, resuelve avisos y **Ventas sin descontar**, hace reembolsos y el **Cierre de caja**."],
        ["**Joel y Mel**", "Administración", "Todo lo anterior, más aprobar conteos, vacaciones y movimientos de la caja fuerte, usuarios y permisos, y cargar productos o combos nuevos en **Equivalencias Wix**."],
      ]),
      P("**Ubicaciones:** Depósito, Store, Cuarentena y laboratorios/proveedores donde hay mercadería de Melania (Oxapharma, Baricosmos, One Pack). Lo que se manda a un laboratorio sigue siendo de Melania: solo cambia de lugar."),
    ],
  },
  {
    id: "dashboard",
    titulo: "Dashboard (inicio)",
    bloques: [
      P("**Para qué sirve:** ver de un vistazo cómo está todo hoy."),
      L([
        "Arriba: unidades físicas, disponibles para venta, en cuarentena y productos bajo stock mínimo.",
        "**Disponible por producto:** con botones para ver solo un tipo (Terminado, Monodosis, Kits, Packaging, Accesorios…) y su total.",
        "Ventas de los últimos 14 días (minorista y mayorista) y lo vendido en el mes. Si no tenés la pestaña Ventas, ves tus ventas.",
        "**Avisos:** pedidos de Wix demorados o a revisar, preventas con stock para entregar, conteos para revisar, lotes por vencer y productos bajo mínimo (ver *Avisos del Dashboard*).",
      ]),
    ],
  },
  {
    id: "stock",
    titulo: "Stock",
    ver: { s: ["stock"] },
    bloques: [
      P("**Para qué sirve:** saber cuánto hay. Muestra el stock total de Melania sumando todas las ubicaciones."),
      P("Vos ves solo el stock de tu ubicación (por ejemplo, el Store).", { fija: true }),
      L([
        "**Por producto** (la vista de inicio): el total de cada producto, sus lotes con cantidad y vencimiento. **Ver detalle** abre lote y ubicación.",
        "**Por lote y ubicación:** un renglón por cada producto + lote + ubicación.",
        "**Reservado y Disponible:** lo reservado son unidades apartadas para pedidos web ya pagados; siguen en el Depósito pero no se pueden vender a otra persona.",
        "**Sincronizado al stock de Wix:** el cartel verde de arriba avisa que la web está mostrando nuestro stock y cuándo se actualizó. Los productos que se publican en Wix llevan la marca **✓ Wix**. Si el cartel se pone amarillo, avisale a Joel.",
        "**Filtros:** buscar; N° de lote (escribí *sin* para lo que no tiene lote); tipo de producto; ubicación; disponible; Solo productos en 0.",
        "**Stock al día:** elegí una fecha pasada y ves el stock que había al cierre de ese día.",
        "**Caja cerrada:** los lotes guardados en caja cerrada se ven con un candado. Cuentan en el total pero no se venden ni se mueven hasta tocar **Abrir caja**.",
        "**Blisters sin separar:** la Monodosis Botox viene en **blister x4** y también se vende suelta. Al lado de las sueltas se ve cuántos blisters quedan sin separar, por ejemplo *+ 28.214 blister x4 sin separar*.",
        "**Descargar Excel:** baja exactamente lo que estás viendo con los filtros.",
        solo("**Ajustar / Cargar cantidad:** fija la cantidad real con un motivo; queda como \"Ajuste\".", ENCARGADA),
      ]),
      S("Separar blisters en unidades", [
        N([
          "En **Stock**, buscá el producto en blister (por ejemplo, *Monodosis Botox (Blister x 4 unidades)*).",
          "Abrí **Separar en unidades**, elegí el lote y la ubicación de donde salen (por ejemplo *Lote L0215 · Depósito*) y poné cuántos blisters se separan (una caja = 500).",
          "Tocá **Separar** y confirmá. El sistema resta esos blisters y suma 4 unidades sueltas por cada uno, **con el mismo lote y vencimiento**. En Movimientos queda como \"Desarmado (kit o blister)\" con tu usuario, y Wix se actualiza solo.",
        ]),
        A("**No cargues las unidades sueltas con un ingreso o un ajuste:** así se suman las unidades pero los blisters no se restan. Siempre con **Separar en unidades**. Si el lote está en caja cerrada, primero hay que abrirla.", "Importante", "ambar"),
      ], ENCARGADA),
      A("Cuando se terminan las monodosis sueltas y se abre una caja de blisters, avisale a Yura para que lo cargue con **Separar en unidades**. No las cargues como ingreso.", "Monodosis en blister", "info", { r: ["OPERATOR"] }),
    ],
  },
  {
    id: "lotes",
    titulo: "Lotes",
    ver: { s: ["lotes"] },
    bloques: [
      P("**Para qué sirve:** controlar cada tanda de producto con su número de lote y vencimiento."),
      L([
        "Lista con lo que queda de cada lote (o \"Agotado\"), estado y filtros.",
        solo("**Asignar lote a stock existente:** para stock cargado sin lote; no cambia el total.", ENCARGADA),
        "**Nuevo lote:** con cantidad se suma como ingreso. En la ficha del lote: historial, cambiar estado, corregir vencimiento y **Abrir / Cerrar caja**.",
      ]),
      T(["Estado del lote", "Qué significa"], [
        ["**Liberado**", "Normal, se puede vender."],
        ["**Cuarentena**", "En revisión: no se vende hasta liberarlo."],
        ["**Bloqueado**", "No se puede usar ni vender."],
        ["**Vencido**", "Pasó su vencimiento."],
        ["**Agotado**", "No queda stock de ese lote."],
        ["**Caja cerrada**", "Está guardado sin abrir: cuenta en el stock pero no se vende hasta abrir la caja (primero se termina el lote anterior)."],
      ]),
    ],
  },
  {
    id: "ingresos",
    titulo: "Nuevo ingreso",
    ver: { s: ["ingresos"] },
    bloques: [
      P("**Para qué sirve:** cargar la mercadería que entra a Melania (compras, producción de un laboratorio)."),
      N([
        "Arriba, una sola vez: fecha, N° de remito y factura, proveedor y dónde se guarda.",
        "Abajo, cada producto con su buscador: cantidad, lote, vencimiento y costo unitario. **+ Agregar otro producto** para el resto del remito.",
        "Si una caja entra y se guarda sin abrir, tildá **Mantener caja cerrada** (hace falta el número de lote).",
        "Adjuntá la foto del remito y la de la factura (o PDF). Las fotos del celular se achican solas.",
        "**Confirmar ingreso.** Se guarda todo junto o nada.",
      ]),
      L([
        "**Historial de ingresos** (abajo de todo): los últimos ingresos con buscador. Tocando uno ves el detalle, **Ver remito / Ver factura** y, si faltan, **Adjuntar**.",
        "Si entra un producto que tiene preventas, después de confirmar aparece el reparto.",
        "Si la mercadería viene de una **orden de compra**, se recibe desde la orden con **Recibir mercadería**.",
        "Los kits no se ingresan: se arman desde Productos.",
      ]),
    ],
  },
  {
    id: "nuevo-movimiento",
    titulo: "Nuevo movimiento",
    ver: { s: ["movimientos"] },
    bloques: [
      P("**Para qué sirve:** cargar todo lo que sale o se mueve a mano: transferencias, roturas, muestras, uso interno, ventas que no pasan por Wix…"),
      N([
        "Elegí el tipo (ver *Los tipos de movimiento*). Solo Transferencia, A cuarentena, Liberación de cuarentena y Envío a proveedor piden destino.",
        "En Productos, escribí parte del nombre, SKU o lote y elegí. Cada opción dice **producto · lote · ubicación (cantidad)**: esa ubicación es de donde sale. **+ Agregar otro producto** para pedidos con varios.",
        "Completá Motivo / N° de pedido y, si hace falta, observaciones. Confirmar.",
      ]),
      A("Un pedido se guarda completo o no se guarda: si de algún producto no alcanza el stock, avisa y no carga nada. Las unidades **reservadas por pedidos web** y los lotes en **caja cerrada** no se pueden usar.", "Para tener en cuenta"),
      A("Vos solo ves el stock de tu ubicación: si un producto no te aparece, hay que transferirlo primero desde el Depósito.", undefined, "info", { fija: true }),
    ],
  },
  {
    id: "movimientos",
    titulo: "Movimientos",
    ver: { s: ["movimientos"] },
    bloques: [
      P("**Para qué sirve:** ver el historial completo de todo lo que entró, salió o se movió."),
      L([
        "De a 50 por página. Filtros: texto (producto, lote, motivo, persona), tipo, ubicación y fechas (con botones rápidos).",
        "**Origen → Destino** muestra adónde fue: Store → Venta, Depósito → Store, Ingreso → Depósito.",
        "Las ventas de Wix aparecen con el **N° de pedido** como motivo (responsable \"Wix POS\" en el local, o quien procesó el pedido web).",
        "**Descargar Excel** con lo filtrado.",
        solo("**Revertir** anula un movimiento mal cargado. Para los reembolsos de Wix usá los botones del pedido, no Revertir.", ENCARGADA),
      ]),
    ],
  },
  {
    id: "conteos",
    titulo: "Conteos",
    ver: { s: ["conteos"] },
    bloques: [
      P("**Para qué sirve:** contar físicamente y comparar con el sistema."),
      N([
        "**Abrir conteo:** elegí la ubicación y qué tipos de producto vas a contar (ej. solo Terminado y Monodosis). Si no marcás ninguno, entran todos.",
        "**Es ciego:** no ves cuánto \"debería\" haber. Usá el buscador y los botones de tipo para encontrar rápido cada producto.",
        "**Guardar avance** cuando quieras. **Cerrar conteo** aunque no hayas contado todo: lo que quede vacío queda \"sin contar\" y su stock no se toca.",
        "Un administrador revisa teórico vs. físico y aprueba (el stock se corrige con ajustes) o rechaza.",
      ]),
      A("Antes de tocar **Cerrar conteo**, revisá que los números sean los que anotaste. El conteo no cambia el stock hasta que un administrador lo aprueba: si algo quedó mal cargado, avisá y se rechaza.", "Para tener en cuenta"),
    ],
  },
  {
    id: "productos",
    titulo: "Productos",
    ver: { s: ["productos"] },
    bloques: [
      P("**Para qué sirve:** el catálogo: SKU, nombre, tipo, unidad y stock mínimo."),
      L([
        "Buscador y filtros por tipo, categoría y estado. En la compu, tocando el título de una columna se ordena.",
        "**+ Nuevo producto** (con opción de stock inicial). Tocando un producto se edita; con historial no se borra: se desactiva.",
        "**Tipos:** Producto terminado, Monodosis, Kit, Packaging, Granel y Accesorio.",
        "**Armar kit:** nombre y SKU, y los productos con cuánto lleva cada uno. En la ficha del kit: **Armar** descuenta los componentes y suma kits; **Desarmar** hace lo contrario.",
      ]),
    ],
  },
  {
    id: "proveedores",
    titulo: "Proveedores y Ubicaciones",
    ver: { s: ["proveedores", "ubicaciones"] },
    bloques: [P("Las listas de proveedores/laboratorios y de lugares donde hay mercadería de Melania.")],
  },
  {
    id: "wix",
    titulo: "Ventas de Wix",
    ver: { s: ["pedidos"] },
    bloques: [
      A("Wix y Stock Melania están **conectados**. Cada venta de Wix, sea del POS del local o de la tienda web, llega sola y descuenta el stock. **No hay que cargar las ventas de Wix a mano.** Lo único que se hace a mano en cada pedido web es **marcarlo como procesado** cuando se arma y después como **despachado** o **retirado** cuando sale del local.", "Lo más importante"),
      S("El stock de la web sale de Melania", [
        L([
          "Wix muestra el stock **disponible** de Melania: **Depósito + Store**, menos lo reservado para pedidos sin armar y lo que está en cuarentena. Los kits y combos muestran cuántos se pueden armar.",
          "Cada vez que se carga algo en Melania, Wix se actualiza solo en unos minutos. Una vez por día el sistema compara Wix con Melania y corrige cualquier diferencia.",
          "**Ya no se toca el stock en Wix a mano.** Si algo figura \"Agotado\" en la web pero lo tenemos, hay que cargarlo en Melania y en minutos vuelve a estar a la venta.",
        ]),
      ]),
      S("Ventas del local (POS)", [
        N([
          "Vendé con el **POS de Wix** igual que siempre.",
          "La venta se descuenta **sola del Store**, a los pocos segundos, con el número de pedido como motivo y el responsable \"Wix POS\".",
          "En Pedidos Wix aparece sola como **Retirado** (\"Retiro en Store\"): no hay que armarla ni marcarla.",
          "**No la cargues en Nuevo movimiento.** Si la cargás, se descuenta dos veces.",
        ]),
        A("La única excepción es si en el Dashboard aparece **\"La integración con Wix está desconectada\"**: mientras dure el aviso, las ventas se cargan a mano en Nuevo movimiento.", "Atención", "ambar"),
      ]),
      S("Pedidos web", [
        P("Cuando un pedido de la tienda web se **paga**, Stock Melania lo recibe solo y **reserva** los productos en el **Depósito**. Lo mismo con los pedidos creados a mano en el panel de Wix (por ejemplo, mayoristas) cuando quedan pagados. **Reservado** quiere decir que el producto sigue en el Depósito pero ya está apartado."),
        T(["Estado", "Qué significa"], [
          ["**Reservado**", "La clienta pagó. El producto está apartado en el Depósito, falta armarlo."],
          ["**Procesado**", "Ya lo armaron y salió del stock. Está listo para despachar o entregar."],
          ["**Despachado**", "Salió por Correo Argentino, moto o se llevó a algún lugar."],
          ["**Retirado**", "La clienta lo pasó a buscar por el local (o fue una venta del POS)."],
          ["**Reembolsado**", "Se devolvió todo: sale de Procesados, Despachados y Retirados."],
        ]),
      ]),
      S("Cómo armar y despachar un pedido", [
        N([
          "Entrá a **Pedidos Wix**. En **Para armar** los pedidos vienen ordenados por **Entrega**: primero **motomensajería** (la moto pasa tipo 13 h), después **Correo Argentino** (hasta las 18 h) y al final **retiro en sucursal**; dentro de cada grupo, el más viejo primero. En rojo, los que llevan **más de 3 días** pagados sin procesar.",
          "Armá el pedido y abrilo en el sistema.",
          "Si va por **Correo Argentino**, cargá el **N° de seguimiento** en el campo de arriba del botón (si todavía no lo tenés, se carga después desde el pedido).",
          "Tocá **Marcar como procesado (armado)**. Recién ahí se **descuenta del stock**, primero el lote que vence antes, y quedás registrado como responsable. Wix marca el pedido como procesado solo y, si cargaste el seguimiento, la clienta recibe el email con el número.",
          "Si **falta algún producto**, bajá esa cantidad antes de confirmar: se arma lo que hay y el resto sigue reservado.",
          "Cuando el paquete **sale del local**, tocá **Marcar como despachado** o **Marcar como retirado**. El sistema pregunta **\"¿Confirmás?\"** para que no se toque por error.",
        ]),
        P("La lista muestra **50 pedidos por página** (**← Anterior / Siguiente →** abajo) y se puede filtrar por estado, canal, método de entrega, fechas y con el buscador (N° de pedido, clienta o email). Marcar despachado o retirado **no mueve stock**."),
        P("Si alguien lo marca despachado o retirado por error, tocá **Deshacer** y vuelve a Procesado.", ENCARGADA),
        A("**No marques el pedido como procesado directo en Wix.** Hacelo siempre desde Stock Melania. Si alguien lo marca en Wix, el stock **no** se descuenta y el pedido queda con el aviso \"confirmá en Melania quién lo armó\": hay que abrirlo y tocar igual **Marcar como procesado (armado)**.", "Importante", "ambar"),
        A("Como la web muestra Depósito + Store, puede entrar un pedido de algo que **solo está en el Store**. El pedido aparece **A revisar** con el aviso, por ejemplo: *Falta stock en Depósito: Film cejas caja dorada (hay 1 en el Store, pasalo al Depósito)*. Qué hacer: **Nuevo movimiento → Transferencia** del Store al Depósito con el N° de pedido, armar el pedido normal y marcar el aviso como revisado. Si no dice nada del Store, no hay en ningún lado: avisar a Yura.", "Falta stock en Depósito", "ambar"),
      ]),
      S("Número de seguimiento (Correo Argentino)", [
        L([
          "Se carga al procesar el pedido o después, en el pedido, en **Seguimiento → Cargar** (también se puede **Cambiar**).",
          "El número se manda solo a Wix y la clienta recibe el email de envío. Si Wix no lo toma en el momento, dice \"pendiente de mandar a Wix\" y se reintenta solo.",
          "Moto, retiro y ventas del local no llevan seguimiento.",
        ]),
      ]),
      S("Pedidos mayoristas", [
        L([
          "Se cargan a mano en Wix **con los productos normales** (los individuales), **no** con los que dicen \"MAYORISTA\".",
          "Al pedido se le pone la etiqueta **mayorista**: Stock Melania lo registra solo como **venta mayorista**. Se arma y procesa en Pedidos Wix como cualquier pedido.",
          "El descuento del 10, 20 o 30% se sigue aplicando en el pedido, como siempre.",
        ]),
      ], ENCARGADA),
      S("Si la clienta quiere cambiar el pedido", [
        P("El cambio se hace **siempre en Wix**, en el mismo pedido. Stock Melania lo toma solo en unos minutos (o al tocar **Actualizar ahora**)."),
        T(["El pedido estaba…", "Qué pasa", "Qué hay que hacer"], [
          ["**Sin armar**", "La reserva se ajusta sola.", "Armarlo con lo nuevo y marcarlo como procesado."],
          ["**Procesado**, el paquete sigue en el local", "Vuelve a **Para armar** con el aviso \"rearmá el paquete\" y un recuadro **Sacá del paquete**.", "Rearmar el paquete y volver a tocar **Marcar como procesado (armado)**. Lo sacado vuelve solo al stock."],
          ["**Despachado o retirado**", "Queda **A revisar**: \"el paquete ya salió\".", "Avisar a Yura, Mel o Joel."],
        ]),
      ]),
      S("Ventas sin descontar", [
        P("A veces el sistema no puede descontar un producto de una venta de Wix: no tiene SKU, no está en **Equivalencias Wix** o no hay stock. Esos casos aparecen en **Pedidos Wix → Sin descontar** y en el Dashboard."),
        T(["Opción", "Cuándo usarla"], [
          ["**Descontar**", "Sabés qué producto es: elegís el producto y la cantidad, y se descuenta con el número de pedido."],
          { c: ["**Descartar**", "No corresponde descontar nada (un curso, una gift card, un envío). Se escribe el motivo."], ver: ENCARGADA },
        ]),
        P("Si es un **producto o combo nuevo** de Wix, avisale a Joel o a Mel para que lo carguen en **Equivalencias Wix** con el mismo SKU."),
      ]),
      S("Reembolsos y cancelaciones", [
        L([
          "La **plata** se devuelve siempre **en Wix** (o en el POS si es del local). Lo hacen **Yura, Mel o Joel**; si una clienta pide una devolución, avisales.",
          "En Stock Melania se registra qué pasa con el **producto** (si vuelve al stock o no) con los botones del pedido, **no** revirtiendo a mano en Movimientos.",
        ]),
        T(["Caso", "Qué hay que hacer en Melania"], [
          ["Pedido web **sin armar**, reembolsado entero o cancelado", "Nada: la reserva se libera sola. No armar ese pedido."],
          ["Pedido web **sin armar**, reembolso **parcial**", "Queda **A revisar**. Al armarlo, **bajar la cantidad** de lo reembolsado."],
          ["Pedido web **ya armado** y reembolsado", "Yura, Mel o Joel tocan **Reembolso** en el pedido."],
          ["Venta del **POS** reembolsada", "El pedido pregunta *¿el producto volvió al Store?*: tocar **Volvió al Store** (vuelve al stock) o **No volvió** (el stock no se toca)."],
        ]),
      ]),
      S("Botón Reembolso en un pedido web ya armado", [
        N([
          "Primero se devuelve la plata en Wix.",
          "En Melania, abrí el pedido y tocá **Reembolso** (al lado de despachado / retirado).",
          "Elegí **cuántas unidades de cada producto** se reembolsan. Viene cargado todo; para uno parcial, poné 0 en lo que no se reembolsa.",
          "Elegí si **vuelve al Depósito** (la venta se anula y vuelve al stock) o **no vuelve** (se lo quedó la clienta o llegó roto: el stock no se toca).",
          "Confirmá. Si se reembolsó todo, el pedido queda **Reembolsado**. Si fue parcial, sigue igual con el detalle en cada producto.",
        ]),
        A("Si el producto vuelve **roto o vencido**: elegí que **vuelve al Depósito** y después cargá la salida en **Nuevo movimiento** con tipo **Rotura** o **Vencimiento**.", "Producto que vuelve dañado", "verde"),
      ], ENCARGADA),
    ],
  },
  {
    id: "ventas",
    titulo: "Ventas",
    ver: { s: ["ventas"] },
    bloques: [
      P("**Para qué sirve:** saber cuánto se vendió, quién lo vendió y en qué pedidos (incluye las ventas de Wix)."),
      L([
        "Filtros: fechas (con botones rápidos), canal (minorista, mayorista, ambos u otras salidas), persona, ubicación y producto. Arranca en el mes actual.",
        "**Resumen** (por persona y top 10) · **Por producto** · **Por pedido** (tocá para ver los productos).",
        "**Descargar Excel** con lo filtrado. Las ventas revertidas no se cuentan.",
      ]),
    ],
  },
  {
    id: "preventa",
    titulo: "Preventa",
    ver: { s: ["preventa"] },
    bloques: [
      P("**Para qué sirve:** vender productos que todavía no llegaron y entregarlos apenas entran."),
      N([
        "**+ Nueva preventa:** cliente, N° de pedido, canal, fecha y productos. No mueve stock: queda anotada.",
        "Cuando entra la mercadería y se carga el Nuevo ingreso, aparece **Preventas para repartir**, primero las más viejas. Revisá y tocá **Confirmar y registrar las ventas**.",
        "Si llegó menos, se reparte lo que alcanza y el resto sigue pendiente.",
        "Desde la preventa también podés **Entregar desde el stock** o **Cancelar** con motivo.",
      ]),
    ],
  },
  {
    id: "auditoria",
    titulo: "Auditoría",
    ver: { s: ["auditoria"] },
    bloques: [
      P("**Para qué sirve:** saber quién hizo qué y cuándo en el sistema."),
      L([
        "Filtros por persona, tipo de acción y fechas, de a 50.",
        "Cada fila resume qué pasó; tocándola ves el detalle.",
      ]),
    ],
  },
  {
    id: "caja",
    titulo: "Cierre de caja y caja fuerte",
    ver: { s: ["caja"] },
    bloques: [
      S("Cierre de caja", [
        N([
          "Tocá el día y cargá los **pagos que no entran por Wix**: cliente, pedido, factura y el monto en efectivo, posnet, link de pago MP, transferencia o USD.",
          "En cada pago elegí **¿Dónde ingresó el dinero?** (Marrudi, Joel, Melania, Caja fuerte o Caja chica). Es obligatorio para enviar.",
          "Cargá los **ingresos de dinero**, los **gastos**, el **operativo del día** y las **tareas operativas**.",
          "Podés **guardar borrador**. Al final tocá **Enviar cierre**: Joel y Mel ven el aviso en el Dashboard y se guarda un Excel de respaldo del mes.",
        ]),
      ]),
      S("Caja fuerte", [
        L([
          "El saldo se arma solo con el efectivo que en los cierres se marcó como **Caja fuerte**.",
          "**+ Registrar retiro o ingreso:** fecha, moneda, retiro total o parcial, quién lo retira y una nota.",
          "Cada retiro o ingreso queda **esperando aprobación** de Joel o Mel. Recién ahí cambia el saldo.",
          solo("Vos aprobás los retiros e ingresos pendientes; también ves el aviso en el Dashboard.", ADMIN),
        ]),
      ]),
    ],
  },
  {
    id: "faltas",
    titulo: "Faltas y horas",
    ver: { s: ["faltas"] },
    bloques: [
      L([
        "Una tarjeta por persona con su saldo acumulado (verde = a favor, rojo = debe) y lo del mes.",
        "**+ Registrar…:** empleado, fecha, tipo, motivo, horario, certificado y cómo afecta las horas (Debe · A favor · No afecta). Se puede adjuntar el certificado.",
        "Cada uno tiene un **Saldo inicial**. Al recuperar, se carga \"Recuperó horas → A favor\".",
        "Abajo: **Empleados** (agregar, dar de baja, reactivar).",
      ]),
    ],
  },
  {
    id: "vacaciones",
    titulo: "Vacaciones",
    ver: { s: ["vacaciones"] },
    bloques: [
      L([
        "Calendario del año: una fila por persona (verde = aprobadas, amarillo = pendientes).",
        "**Días por persona:** cuántos le corresponden, aprobados, pendientes y cuántos le quedan.",
        "**+ Cargar vacaciones:** persona, desde, hasta y año al que se imputan. Queda **Pendiente de aprobación**; si se superpone con otra persona, avisa.",
        solo("Vos aprobás las vacaciones pendientes (también aparecen en el Dashboard).", ADMIN),
      ]),
    ],
  },
  {
    id: "equivalencias",
    titulo: "Equivalencias e Integración Wix",
    ver: { s: ["wix"] },
    bloques: [
      L([
        "**Equivalencias Wix:** qué productos de Stock Melania descuenta cada SKU de Wix (incluye packs y combos). Cada producto o combo nuevo necesita su SKU en Wix y su equivalencia; si no, la venta cae en **Sin descontar**.",
        "**Publicar stock en Wix:** marca qué SKU reciben el stock de Melania; los internos \"MAYORISTA\" no lo reciben.",
        "**Integración Wix:** conexión, opciones (publicar el disponible, activar seguimiento), **Publicar todo el disponible**, **Conciliar stock con Wix** y últimos eventos.",
      ]),
    ],
  },
  {
    id: "admin",
    titulo: "Otras pestañas de administración",
    ver: { s: ["compras", "costos", "precios", "configuracion"] },
    bloques: [
      L([
        solo("**Órdenes de compra:** pedidos a proveedores y recepción de la mercadería.", { s: ["compras"] }),
        solo("**Costos** e **Historial de precios**.", { s: ["costos", "precios"] }),
        solo("**Configuración:** usuarios, PIN, permisos (qué pestañas ve cada uno), y ubicación fija. Lo que habilites acá aparece solo en el manual de esa persona.", { s: ["configuracion"] }),
      ]),
    ],
  },
  {
    id: "tipos",
    titulo: "Los tipos de movimiento",
    ver: { s: ["movimientos"] },
    bloques: [
      T(["Tipo", "Para qué se usa", "Queda como"], [
        ["**Transferencia**", "Cambiar mercadería de lugar. Sigue siendo de Melania.", "Depósito → Store"],
        ["**Venta**", "Venta a cliente final. Las de Wix se cargan solas.", "Store → Venta"],
        ["**Venta mayorista**", "Venta a revendedores. Las de Wix con etiqueta mayorista se cargan solas.", "Depósito → Venta mayorista"],
        ["**Regalo**", "Entrega sin cargo como obsequio.", "Store → Regalo"],
        ["**Muestra**", "Para que alguien lo pruebe o para promoción.", "Depósito → Muestra"],
        ["**Rotura**", "Producto roto o dañado.", "Store → Rotura"],
        ["**Vencimiento**", "Producto vencido que se descarta.", "Depósito → Vencimiento"],
        ["**Uso interno**", "Lo usa el equipo, no se vende.", "Store → Uso interno"],
        ["**A cuarentena**", "Apartar mercadería en duda.", "Depósito → Cuarentena"],
        ["**Liberación de cuarentena**", "Volver a la venta lo revisado.", "Cuarentena → Depósito"],
        ["**Envío a proveedor**", "Mandar a un laboratorio. Sigue siendo de Melania.", "Depósito → Oxapharma"],
        ["**Desarmado (kit o blister)**", "Lo genera el sistema al desarmar un kit o separar blisters.", "Blister → unidades"],
        ["**Otro**", "Cualquier otra salida (motivo obligatorio).", "Depósito → Otro"],
      ]),
      A("¿La mercadería sigue siendo de Melania? → **Transferencia** (o Envío a proveedor). ¿Se va? → **Venta, Venta mayorista, Regalo o Muestra**. ¿Se pierde o se usa? → **Rotura, Vencimiento o Uso interno**.", "Una regla simple"),
    ],
  },
  {
    id: "como-hago",
    titulo: "¿Cómo hago…?",
    bloques: [
      S("Vendo en el Store", [P("Con el **POS de Wix**, como siempre. Se descuenta solo del Store: **no cargarla** en Nuevo movimiento.")], { s: ["pedidos"] }),
      S("Subir mercadería del Depósito al Store", [P("Nuevo movimiento → **Transferencia** → destino Store → productos del Depósito → Confirmar. Si no se carga, en el Store no se ve para vender.")], { s: ["movimientos"] }),
      S("Armar y despachar un pedido de la web", [P("Pedidos Wix → Para armar → armar → **Marcar como procesado (armado)** → cuando sale, **Marcar como despachado** o **retirado**.")], { s: ["pedidos"] }),
      S("Un pedido dice \"Falta stock en Depósito (hay N en el Store)\"", [P("Nuevo movimiento → **Transferencia** del Store al Depósito con el N° de pedido → armar el pedido → marcar el aviso como revisado.")], { s: ["pedidos"] }),
      S("Cargar el seguimiento de Correo Argentino", [P("Al procesar el pedido, en el campo **N° de seguimiento**; o después, en el pedido → **Seguimiento → Cargar**.")], { s: ["pedidos"] }),
      S("Buscar un pedido viejo", [P("Pedidos Wix → **Todos** → buscador (N°, clienta o email) o fechas; o pasar de página con **Siguiente →**.")], { s: ["pedidos"] }),
      S("Un pedido mayorista", [P("Cargarlo en Wix con los productos normales y la etiqueta **mayorista**; se arma y procesa en Pedidos Wix.")], ENCARGADA),
      S("Una clienta pide reembolso", [P("Avisar a Yura, Mel o Joel.")], { r: ["OPERATOR"], s: ["pedidos"] }),
      S("Una clienta pide reembolso", [P("Devolver la plata en Wix y en Melania tocar **Reembolso** en el pedido, eligiendo si el producto vuelve o no. Si es del POS: **Volvió al Store** o **No volvió**.")], ENCARGADA),
      S("Algo figura Agotado en la web pero lo tenemos", [P("Falta cargarlo en Melania: Nuevo ingreso, o avisar a Yura para que ajuste. En minutos vuelve a estar a la venta.")], { s: ["stock"] }),
      S("Llegó mercadería", [P("**Nuevo ingreso** con todos los productos del remito, lote y vencimiento, y las fotos del remito y la factura.")], { s: ["ingresos"] }),
      S("Guardar una caja sin abrir", [P("Al cargar el ingreso tildá **Mantener caja cerrada**. Cuando se abra, tocá **Abrir caja** en Stock o en la ficha del lote.")], { s: ["ingresos"] }),
      S("Se terminaron las monodosis sueltas y hay que abrir una caja de blisters", [P("Stock → producto en blister → **Separar en unidades** → lote, ubicación y cantidad → Separar. Nunca cargarlas como ingreso.")], ENCARGADA),
      S("Se terminaron las monodosis sueltas y hay que abrir una caja de blisters", [P("Avisale a Yura para que lo cargue con **Separar en unidades**.")], { r: ["OPERATOR"], s: ["stock"] }),
      S("Un cliente compra algo que todavía no llegó", [P("Preventa → **+ Nueva preventa** con cliente, pedido y productos. Cuando entre, se entrega desde el reparto del ingreso.")], { s: ["preventa"] }),
      S("Se rompió o venció algo", [P("Nuevo movimiento → **Rotura** o **Vencimiento** desde donde estaba.")], { s: ["movimientos"] }),
      S("Me equivoqué al cargar", [P("No cargues nada \"al revés\": avisale a Yura, que lo revierte en Movimientos, y se carga de nuevo bien.")], { r: ["OPERATOR"] }),
      S("El sistema dice una cantidad y hay otra", [P("Avisale a Yura: puede ajustar desde Stock, o se hace un Conteo.")], { r: ["OPERATOR"] }),
      S("Saber cuánto había un día pasado", [P("Stock → **Stock al día** → elegí la fecha.")], { s: ["stock"] }),
      S("Contar solo la línea Melania", [P("Conteos → elegí la ubicación y marcá Producto terminado y Monodosis → contá con el buscador → Cerrar (lo demás queda sin contar).")], { s: ["conteos"] }),
      S("Un producto no tiene lote", [P("Lotes → **Asignar lote a stock existente**.")], ENCARGADA),
      S("Cerrar la caja del día", [P("**Cierre de caja** → el día → pagos, gastos, operativo y tareas → **Enviar cierre**.")], { s: ["caja"] }),
    ],
  },
  {
    id: "avisos",
    titulo: "Avisos del Dashboard",
    bloques: [
      T(["Aviso", "Qué significa y qué hacer"], [
        { c: ["**Pedidos pagados hace más de 3 días**", "Hay pedidos web reservados sin armar. Armarlos y marcarlos como procesados."], ver: { s: ["pedidos"] } },
        { c: ["**Pedidos a revisar**", "Abrir el pedido y leer el motivo: reembolso, sin equivalencia, falta de stock (si dice \"hay N en el Store\", transferirlo al Depósito), marcado procesado en Wix o editado después de salir. Una vez resuelto, Yura, Mel o Joel escriben qué se hizo y tocan **Marcar como revisado**."], ver: { s: ["pedidos"] } },
        { c: ["**Ventas sin descontar**", "Resolver en Pedidos Wix → Sin descontar."], ver: { s: ["pedidos"] } },
        ["**Integración con Wix desconectada**", "Mientras tanto, las ventas se cargan a mano como antes."],
        { c: ["**Hay stock para N preventas**", "Entró mercadería de algo prevendido: entrar a Preventa y entregar."], ver: { s: ["preventa"] } },
        ["**Conteos para revisar / lotes por vencer / bajo mínimo**", "Revisar el conteo, usar primero lo que vence y reponer lo que está bajo mínimo. Si dice *(+ N blister x4 sin separar)*, no hace falta comprar: hay que separar blisters."],
        { c: ["**Cierre de caja enviado**", "Yura envió el cierre del día: abrirlo para verlo."], ver: { r: ["ADMIN"], s: ["caja"] } },
        { c: ["**Caja fuerte esperando aprobación**", "Hay un retiro o ingreso para aprobar."], ver: { r: ["ADMIN"], s: ["caja"] } },
        { c: ["**Vacaciones para aprobar**", "Hay pedidos de vacaciones pendientes."], ver: { r: ["ADMIN"], s: ["vacaciones"] } },
      ]),
    ],
  },
  {
    id: "permisos",
    titulo: "Lo que podés hacer vos",
    bloques: [{ tipo: "permisos" }],
  },
];
