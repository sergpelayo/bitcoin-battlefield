# Cobrar por el plan COMANDANTE

Este documento existe porque el plan de pago **hoy no protege nada**, y conviene
que eso esté escrito antes de anunciar un precio a nadie.

## El problema

`src/license.js` reparte funciones en el navegador. La app es 100% cliente:
no hay servidor, y el código fuente es público en GitHub. Eso significa que
cualquiera puede activarse el plan de pago con una línea en la consola:

```js
localStorage.setItem('bb.plan.v1', 'BB-AAAA-BBBB-CCCC'); location.reload();
```

No es un fallo que se pueda parchear moviendo la comprobación de sitio o
ofuscando el código: **mientras la decisión la tome el navegador del usuario, el
usuario manda**. Un límite en el cliente sirve para guiar a quien quiere pagar,
no para frenar a quien no.

Es una decisión de negocio, no técnica: si el objetivo es que la mayoría pague
por comodidad, esto basta. Si el objetivo es que nadie use PRO sin pagar, hay
que mover la comprobación fuera.

## Qué hace falta para cobrar de verdad

Tres piezas, ninguna cara:

### 1. Pasarela de pago

No se puede cobrar sin un intermediario que acepte tarjetas. Los tres que
encajan con un producto de 9,99 USD:

| Opción | Comisión | Ventaja |
| --- | --- | --- |
| **Lemon Squeezy** | ~5% + 0,50 | Actúa de *merchant of record*: se encarga del IVA/impuestos por ti |
| **Gumroad** | ~10% | El más simple de montar, licencias incluidas |
| **Stripe** | ~2,9% + 0,30 | El más barato, pero los impuestos son cosa tuya |

Las tres emiten **claves de licencia** y ofrecen una API para validarlas.

### 2. Un validador que el usuario no controle

Un **Cloudflare Worker** en el plan gratuito (100.000 peticiones al día, más que
de sobra) que reciba la clave, pregunte a la API de la pasarela y responda si es
válida. Coste: **0 €**.

### 3. Cambiar una función

Todo el cambio en esta app cabe en `verificarClave()` de `src/license.js`:

```js
export async function verificarClave(clave) {
  const res = await fetch('https://TU-WORKER.workers.dev/validar', {
    method: 'POST',
    body: JSON.stringify({ clave }),
  });
  if (!res.ok) return null;
  const { valida, clave: normalizada } = await res.json();
  return valida ? normalizada : null;
}
```

Aun así seguiría siendo evitable por quien edite el `localStorage` a mano: para
cerrarlo del todo, lo que hay detrás del plan de pago tendría que **servirse**
desde el Worker (por ejemplo, que el catálogo completo de 600+ pares sólo lo
devuelva el servidor si la licencia es válida) en vez de estar ya en el bundle.

## Consecuencia sobre el alojamiento

GitHub Pages gratuito **exige repositorio público**. Si vas a cobrar, seguramente
no quieras el código a la vista. Alternativas sin coste:

- **Cloudflare Pages** — despliega desde repos privados en el plan gratuito.
  Es el cambio natural, y ya estarías ahí por el Worker.
- **GitHub Pro** (4 USD/mes) — permite Pages desde repos privados.

## Resumen

| Pieza | Coste |
| --- | --- |
| Alojamiento (Cloudflare Pages) | 0 € |
| Validador (Cloudflare Worker) | 0 € |
| Datos de mercado (Binance público) | 0 € |
| Pasarela de pago | ~5–10% de cada venta |

El único coste real es la comisión, y sólo se paga cuando alguien compra.
