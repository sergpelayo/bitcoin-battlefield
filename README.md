# ⚔️ Bitcoin Battlefield

El order book de Bitcoin en vivo convertido en un campo de batalla 3D: los **toros** (bids)
pelean contra los **osos** (asks) sobre un terreno cuya altura *es* la profundidad real del
libro de órdenes de Binance.

---

## Qué estás viendo

| Elemento en pantalla | Qué representa |
| --- | --- |
| **Mesetas verdes (izquierda)** | Paredes de compra. Altura = volumen agregado de bids en ese tramo de precio. |
| **Mesetas rojas (derecha)** | Paredes de venta. Altura = volumen agregado de asks. |
| **Unidades verdes / rojas** | Densidad de liquidez en cada nivel: más volumen, más soldados sobre la meseta. |
| **Haz central** | Línea de batalla. Se desplaza hacia el bando con más presión y se tiñe de su color. |
| **Proyectiles** | Trades ejecutados. El bando agresor dispara: verde si la compra barrió el ask, rojo si la venta barrió el bid. Tamaño ∝ tamaño de la orden. |
| **Avance de los ejércitos** | El bando dominante empuja hacia la tierra de nadie. |

El campo cubre una ventana de **±0,2 %** alrededor del precio medio (~±$200 con BTC a 100k),
agrupada en 20 tramos por bando. Sin esa agrupación no se vería nada: el top del libro de
BTCUSDT abarca solo unos centavos.

## Datos

Todo sale de la **API pública de Binance — sin API key, sin registro**:

- `btcusdt@depth@100ms` — diffs del order book, sincronizados contra un snapshot REST
  (`/api/v3/depth?limit=5000`) siguiendo el algoritmo oficial de libro local, con
  re-sincronización automática si se detecta un hueco en la secuencia.
- `btcusdt@aggTrade` — trades agregados; el flag `m` decide quién fue el agresor.
- `btcusdt@ticker` — estadísticas de 24 h (máximo, mínimo, volumen, variación).

**Fallback:** si Binance no responde (geobloqueo, CORS, red caída, o simplemente estás sin
internet) arranca un feed simulado que mantiene un order book real con paredes que aparecen
y se consumen. La app nunca se queda en negro. El HUD lo indica en ámbar
(`DATOS SIMULADOS`) y sigue reintentando la conexión real cada 25 s; en cuanto Binance
vuelve, corta el simulador y retoma los datos de verdad.

## Cómo ejecutarlo

Requiere Node 18+.

```bash
npm install
npm run dev
```

Abre <http://localhost:5173>.

Para producción:

```bash
npm run build     # genera dist/
npm run preview   # sirve dist/ en local
```

El build usa rutas relativas, así que `dist/` se puede servir desde cualquier hosting
estático (o subcarpeta) sin tocar nada.

## Controles

| Tecla / gesto | Acción |
| --- | --- |
| Arrastrar | Orbitar la cámara |
| Rueda | Zoom |
| `R` | Reencuadrar la cámara |
| `B` | Activar/desactivar bloom (súbelo de FPS si vas justo) |

## Estructura

```
index.html               HUD en DOM + canvas
src/
  main.js                Wiring: feed → escena → HUD, y bucle de render
  style.css              HUD estilo terminal (scanlines, viñeta, esquinas de mira)
  hud.js                 Precio, estadísticas 24h, presión de mercado, log de órdenes
  lib/
    emitter.js           Mini event emitter
    orderbook.js         Libro local + agrupación en tramos de precio
  feed/
    index.js             Orquestador live ⇄ simulado con reintentos
    live.js              WebSocket + snapshot REST de Binance
    sim.js               Feed simulado (mismos eventos, mismo OrderBook)
  scene/
    battlefield.js       Escena Three.js: terreno, ejércitos, proyectiles, bloom
    units.js             Geometrías low-poly de toro y oso (fusionadas para instancing)
```

Toros, osos, mesetas y proyectiles se dibujan con `InstancedMesh`, así que cientos de
unidades cuestan un puñado de draw calls.

## Notas de la v1

- El precio grande se actualiza con cada trade (instantáneo), no con el ticker de 1 s.
- Los eventos de libro llegan a 10 Hz pero se consumen a ritmo de render, y las alturas se
  interpolan, así que el terreno se deforma suave en vez de dar saltos.
- La normalización de altura usa un máximo suavizado: cuando entra una pared enorme el
  terreno se reajusta progresivamente en lugar de aplastar todo lo demás de golpe.

## Ideas para siguientes iteraciones

- Cámara cinemática que persiga las batallas grandes (barridos de liquidez).
- Sonido reactivo al flujo de órdenes.
- Selector de símbolo (ETH, SOL…) y de ventana de precio.
- Marcar liquidaciones con el stream de futuros (`@forceOrder`).
- Estela histórica del precio como cicatriz en el terreno.
