/**
 * Planes de uso: gratuito y de pago.
 *
 * ⚠️ AVISO IMPORTANTE SOBRE LO QUE ESTO ES Y LO QUE NO ES ⚠️
 *
 * Esto reparte funciones, NO protege ingresos. La app es 100% cliente y su
 * código es público, así que cualquiera con la consola del navegador abierta
 * puede activarse el plan de pago en diez segundos. No es un defecto de esta
 * implementación: es imposible de arreglar mientras la comprobación viva en el
 * navegador. Un límite en el cliente sirve para guiar al usuario honesto, no
 * para frenar al que no quiere pagar.
 *
 * Cobrar de verdad exige que la comprobación ocurra en un sitio que el usuario
 * no controle. El camino más barato está documentado en DESPLIEGUE-PRO.md.
 *
 * Todo lo que hay que cambiar para conectar un validador real está en un único
 * sitio: `verificarClave()`.
 */

const CLAVE = 'bb.plan.v1';

export const PRECIO_PRO = '9,99 USD';

export const PLANES = {
  free: {
    id: 'free',
    nombre: 'RECLUTA',
    monedas: 2,
    alarmasPorMoneda: 1,
    buscador: false,
  },
  pro: {
    id: 'pro',
    nombre: 'COMANDANTE',
    monedas: Infinity,
    alarmasPorMoneda: Infinity,
    buscador: true,
  },
};

/**
 * Punto único de verificación. Hoy sólo comprueba el formato, que es lo máximo
 * que puede hacer un fichero que corre en el navegador del propio usuario.
 *
 * Para que valga de algo hay que sustituir el cuerpo por una llamada al
 * validador (un Worker de Cloudflare contra la API de licencias de la pasarela)
 * y devolver su respuesta. La firma es async precisamente para eso.
 */
export async function verificarClave(clave) {
  const limpia = (clave || '').trim().toUpperCase();
  return /^BB-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(limpia) ? limpia : null;
}

export class License {
  constructor() {
    this.clave = null;
    this.plan = PLANES.free;
    try {
      const g = localStorage.getItem(CLAVE);
      if (g) {
        this.clave = g;
        this.plan = PLANES.pro;
      }
    } catch {
      /* sin storage se queda en el plan gratuito, que es el seguro */
    }
    this.onChange = null;
  }

  get esPro() {
    return this.plan.id === 'pro';
  }

  /** Cuántas monedas más caben en el watchlist. */
  huecoMonedas(actuales) {
    return this.plan.monedas - actuales;
  }

  cabeOtraMoneda(actuales) {
    return actuales < this.plan.monedas;
  }

  cabeOtraAlarma(enEsaMoneda) {
    return enEsaMoneda < this.plan.alarmasPorMoneda;
  }

  async activar(clave) {
    const valida = await verificarClave(clave);
    if (!valida) return false;
    this.clave = valida;
    this.plan = PLANES.pro;
    try {
      localStorage.setItem(CLAVE, valida);
    } catch {
      /* la sesión sigue activa aunque no se pueda recordar */
    }
    this.onChange?.();
    return true;
  }

  desactivar() {
    this.clave = null;
    this.plan = PLANES.free;
    try {
      localStorage.removeItem(CLAVE);
    } catch {
      /* nada que limpiar */
    }
    this.onChange?.();
  }
}
