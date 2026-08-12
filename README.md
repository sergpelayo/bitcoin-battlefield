# ⚔️ Bitcoin Battlefield

El order book de Bitcoin en vivo convertido en un campo de batalla 3D: los **toros** (bids)
pelean contra los **osos** (asks) sobre un terreno cuya altura *es* la profundidad real del
libro de órdenes de Binance.

![Bitcoin Battlefield](docs/preview.png)

_La escena 3D con datos reales de Binance. El HUD va en DOM sobre el canvas, así que no
sale en esta captura._

---

## Qué estás viendo

Un valle en plena Segunda Guerra Mundial, visto desde una cámara oblicua baja.

| Elemento en pantalla | Qué representa |
| --- | --- |
| **Vía de tren serpenteante** | El precio medio. Es la frontera: divide el valle en dos y todo lo demás se organiza a su alrededor. |
| **Ladera verde y frondosa (izquierda)** | Territorio de los toros: los bids, precios por debajo del mid. |
| **Tierra ocre y seca (derecha)** | Territorio de los osos: los asks, precios por encima. |
| **Soldados, tanques y tanques gigantes** | Dinero. Cada figura vale una cantidad fija, así que contar tropas es leer cuántos dólares defienden ese precio. Ver la tabla de abajo. |
| **Aviones** | La reserva: uno por cada $5M de liquidez que existe **fuera** de la ventana visible. Suele pesar más que lo que se ve en el suelo. |
| **Trazadoras y explosiones** | Trades ejecutados. Dispara el bando agresor: azul si la compra barrió el ask, rojo si la venta barrió el bid. El calibre va con el tamaño de la orden. |
| **Desplazamiento del frente** | La presión de mercado mueve la vía, la frontera de color y el avance de las tropas: el bando dominante gana terreno literalmente. |
| **Regla en el suelo** | Niveles de precio absolutos marcados como ticks en la tierra, en el borde inferior. |

El campo cubre una ventana de ~**±0,6 %** alrededor del precio medio, agrupada en 24 tramos
por bando. Sin esa agrupación no se vería nada: el top del libro de BTCUSDT abarca solo unos
centavos.

## Qué vale cada figura

| Figura | Vale |
| --- | --- |
| Soldado | $10.000 |
| Tanque | $100.000 |
| Tanque gigante (Maus) | $1.000.000 |
| Avión | $5.000.000 de reserva fuera del campo |

La escala es 1 : 10 : 100 para que el campo se lea como billetes: 3 tanques y 4 soldados
son $340.000 sin pensarlo. Y no es una elección estética — con BTCUSDT un tramo mediano
carga ~$450.000, así que a $1.000 el soldado harían falta 450 figuras por tramo (unas
24.000 en pantalla) y el valle sería una alfombra ilegible. A $10.000, el campo entero
ronda las 400 unidades.

Como los valores son **absolutos y no relativos**, el campo se vacía de verdad cuando el
libro adelgaza, y monedas distintas se comparan entre sí: el libro de BTC despliega unas
350 unidades donde el de DOGE despliega 113.

## Reloj y alarmas

La app también funciona como despertador. Todo vive en el navegador y en `localStorage`,
así que **las alarmas sólo suenan con la pestaña abierta** — sin servidor no hay vigilancia
24/7.

- **De hora** — como un despertador normal; si la hora ya pasó, suena mañana.
- **De precio** — por moneda, y saltan aunque estés mirando otro par: el watchlist
  alimenta las cotizaciones del resto.
- **De mercado** — cuatro vigilancias con casilla: muro de liquidez ≥ $2M, trade ballena
  ≥ $250.000, movimiento ≥ 0,4 % en 3 min y cruce de millar. Los umbrales salen de medir
  el libro real, no de redondear a ojo.

Avisan con sirena antiaérea sintetizada, notificación del sistema y un cartel en pantalla.

## Sonido

Las explosiones y la sirena se **sintetizan con WebAudio** (`src/audio.js`): no hay
ficheros que descargar y cada estallido suena distinto. Un tanque suena seco; un gigante
retumba casi el triple. Se activan y desactivan desde el panel ♪ AUDIO.

Para música de fondo propia, deja el fichero en `public/audio/` y carga su ruta desde ese
mismo panel. YouTube Music **no se puede incrustar** (responde con
`x-frame-options: SAMEORIGIN`), así que la música de YouTube suena por el reproductor
normal — pegar un enlace de YouTube Music funciona igual, porque se extrae el ID de la
lista.

## Monedas y planes

El watchlist lleva varias monedas con precio en vivo y, al elegir una, el campo de batalla
entero se muda a ese par. El catálogo son 646 pares contra USDT que se sacan de
`/api/v3/ticker/price` (153 KB con precios incluidos; el endpoint "correcto" para listar
mercados pesa 17 MB).

| | RECLUTA (gratis) | COMANDANTE (9,99 USD) |
| --- | --- | --- |
| Monedas en el watchlist | 2 | ilimitadas |
| Alarmas de precio por moneda | 1 | ilimitadas |
| Buscador de pares | — | sobre los 646 |

> ⚠️ El cobro **todavía no está conectado**, y el reparto de funciones ocurre en el
> navegador, así que no protege ingresos: cualquiera puede saltárselo desde la consola.
> Qué haría falta para cobrar de verdad está en [DESPLIEGUE-PRO.md](DESPLIEGUE-PRO.md).

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

## Despliegue

Publicado en <https://sergpelayo.github.io/bitcoin-battlefield/>.

Cada push a `main` dispara `.github/workflows/deploy.yml`, que compila `dist/` y lo sube
a GitHub Pages. No hay nada más que mantener: el sitio es estático y **los datos los pide
el navegador de cada visitante directamente a Binance**, así que ni el hosting ni el feed
cuestan nada por mucho tráfico que reciba. También se puede lanzar a mano desde la pestaña
*Actions* sin hacer un commit.

Por eso `data-stream.binance.vision` va primero en `ENDPOINTS`: sirve los mismos streams
que `binance.com` pero sin geobloqueo por IP, y con el sitio abierto a cualquiera importa
que la primera conexión funcione desde cualquier país.

## Pruebas

```bash
npm test
```

Prueba de humo sobre un DOM real (jsdom): construcción de todos los módulos del HUD,
límites de los planes, disparo de alarmas y cambio de moneda. No cubre la escena 3D, que
necesita WebGL.

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
  hud.js                 Precio,24h, market pressure, paredes, market feed
  lib/
    emitter.js           Mini event emitter
    orderbook.js         Libro local + agrupación en tramos de precio
  audio.js               Explosiones y sirena sintetizadas + música de fondo
  alarms.js              Reloj, alarmas de hora/precio y vigilancias de mercado
  watchlist.js           Monedas seguidas, cotizaciones y cambio de par
  symbols.js             Catálogo de pares USDT, buscador y formato de precios
  license.js             Planes RECLUTA / COMANDANTE
  controls.js            Cajón de alarmas, audio y plan
  feed/
    index.js             Orquestador live ⇄ simulado con reintentos
    live.js              WebSocket + snapshot REST de Binance
    sim.js               Feed simulado (mismos eventos, mismo OrderBook)
  scene/
    field.js             Constantes del campo y la curva de la vía
    noise.js             Ruido determinista (el valle es idéntico en cada recarga)
    terrain.js           Campo de alturas, malla del valle, lagos, shader de territorios
    models.js            Geometrías low-poly WW2 con color horneado por vértice
    props.js             Vía, árboles, casas, ruinas, carteles y regla de precios
    armies.js            Soldados, tanques, aviones, trazadoras, explosiones y humo
    battlefield.js       Orquestador: cámara, luces, composer, bucle
```

### Cómo está montado

- **Una única fuente de verdad para el suelo.** La altura se calcula en CPU una sola vez y
  se hornea en la geometría; el mismo grid sirve para posar árboles, vías, carteles y cada
  soldado, así que nada flota ni se hunde.
- **Lo único que cambia en vivo es el color.** La frontera verde/árido se resuelve en el
  fragment shader a partir de un uniform, de modo que el territorio cambia de dueño según
  la presión sin recalcular geometría.
- **La vía es la frontera.** La misma curva (`roadOffset` en `field.js`) la usan el shader
  del terreno, la geometría de la vía y la colocación de las tropas. Está duplicada inline
  en el GLSL: si se toca en un sitio, hay que tocarla en el otro.
- **Todo instanciado.** Soldados, tanques, aviones, árboles, casas y trazadoras van en
  `InstancedMesh`; ~1.500 unidades animadas cuestan ~1 ms de CPU por frame.
- **Las plazas son fijas.** Cada tramo tiene sus posiciones sorteadas una vez con semilla:
  cuando el volumen sube y baja, las unidades aparecen y desaparecen en su sitio en vez de
  bailar por el campo.

## Notas

- El precio grande se actualiza con cada trade (instantáneo), no con el ticker de 1 s.
- Los eventos de libro llegan a 10 Hz pero se consumen a ritmo de render.
- La normalización usa un máximo suavizado: cuando entra una pared enorme, el reparto de
  tropas se reajusta progresivamente en lugar de vaciar el resto del campo de golpe.

## Ideas para siguientes iteraciones

- Cámara cinemática que persiga los barridos de liquidez grandes.
- Cráteres persistentes donde han caído las órdenes grandes.
- Sonido reactivo al flujo de órdenes.
- Selector de símbolo (ETH, SOL…) y de ventana de precio.
- Marcar liquidaciones con el stream de futuros (`@forceOrder`).
