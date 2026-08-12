/**
 * Constantes del campo. El mundo es *relativo al precio medio*: el mid siempre
 * está en x = 0, los bids se extienden hacia -X y los asks hacia +X.
 */

export const BINS = 24; // tramos de precio por bando
export const BIN_WORLD = 2.2; // unidades de mundo por tramo
/** Corredor libre en el centro: por ahí pasa la vía y chocan los dos bandos. */
export const CENTER_GAP = 4.5;
export const DATA_HALF = CENTER_GAP + BINS * BIN_WORLD; // ~57 -> media anchura con tropas

/** Desplazamiento máximo de la línea del frente según la presión del mercado. */
export const FRONT_MAX = 7;

/** Franja del valle donde se despliegan las tropas. */
export const Z_NEAR = 34;
export const Z_FAR = -46;

/** Regla de precios grabada en el suelo, justo en el borde inferior del encuadre. */
export const RULER_Z = 42;
export const RULER_DEPTH = 13;

/** Malla del terreno: mucho más grande que el campo de juego, para llenar el horizonte. */
export const TERRAIN = {
  x0: -200,
  x1: 200,
  z0: -300,
  z1: 92,
  segX: 220,
  segZ: 214,
};

/** Lagos, en las esquinas y bien lejos de la regla y de la línea del frente. */
export const LAKES = [
  { x: -128, z: -26, r: 38 },
  { x: 132, z: -50, r: 33 },
  { x: -146, z: 50, r: 30 },
  { x: 150, z: 38, r: 27 },
];

/**
 * Serpenteo de la vía respecto de la línea del frente. La vía *es* la frontera
 * entre territorios, así que el terreno (shader), los props y las tropas usan
 * todos esta misma curva. Si cambia aquí, hay que cambiarla también en el
 * fragment shader de terrain.js, que la lleva inline.
 */
export function roadOffset(z) {
  return Math.sin(z * 0.035) * 7 + Math.sin(z * 0.017 + 1.2) * 4.5;
}

export function roadSlope(z) {
  return Math.cos(z * 0.035) * 7 * 0.035 + Math.cos(z * 0.017 + 1.2) * 4.5 * 0.017;
}

export const COLORS = {
  bull: 0x2bff8c,
  bear: 0xff4757,
  fog: 0x0a1a12,
};

// -------------------------------------------------------- denominaciones ----
/**
 * Lo que vale cada figura del campo, en dólares de valor nocional del libro.
 *
 * La escala es 1 : 10 : 100 a propósito, para que el campo se lea como billetes:
 * 3 tanques y 4 soldados son $340.000 sin tener que pensarlo. Y $10.000 por
 * soldado no es un número redondo cualquiera — con BTCUSDT un tramo mediano
 * carga ~$450.000, así que a $1.000 el soldado harían falta 450 figuras por
 * tramo (unas 24.000 en pantalla): una alfombra donde no se distingue nada.
 * A $10.000 el campo entero ronda las 400 unidades y se cuenta de un vistazo.
 */
export const UNIT_USD = Object.freeze({
  soldier: 10_000,
  tank: 100_000,
  giant: 1_000_000,
});

/**
 * Los cupos por tramo salen del propio reparto y no son arbitrarios: al repartir
 * de mayor a menor denominación, lo que sobra tras los gigantes es < $1M (luego
 * como mucho 9 tanques) y lo que sobra tras los tanques es < $100.000 (luego
 * como mucho 9 soldados). Sólo los gigantes podrían crecer sin techo, así que
 * ese sí hay que acotarlo: 8 gigantes = $8M en un único tramo, una pared
 * histórica. Por encima de eso se recorta y el tramo se marca como desbordado.
 */
export const SOLDIERS_PER_BIN = 9;
export const TANKS_PER_BIN = 9;
export const GIANTS_PER_BIN = 8;

/**
 * Un avión por cada $5M de liquidez que queda FUERA de la ventana visible.
 * Es la reserva: profundidad que existe pero todavía no pisa el campo. Suele
 * pesar más que lo que se ve (con el libro de hoy, $16,7M en bids contra $5,2M
 * en asks), así que mirar el cielo dice quién tiene refuerzos esperando.
 */
export const PLANE_USD = 5_000_000;

/**
 * Reparte un importe en dólares en gigantes, tanques y soldados, de mayor a
 * menor denominación. Lo que no llega a $10.000 no se dibuja: es ruido.
 *
 * `overflow` avisa de que el tramo no cabe entero en el cupo — sin ese aviso el
 * campo mentiría por omisión, enseñando $9M donde hay $12M.
 */
export function denominate(usd) {
  let resto = usd;
  const giants = Math.min(GIANTS_PER_BIN, Math.floor(resto / UNIT_USD.giant));
  resto -= giants * UNIT_USD.giant;
  const tanks = Math.min(TANKS_PER_BIN, Math.floor(resto / UNIT_USD.tank));
  resto -= tanks * UNIT_USD.tank;
  const soldiers = Math.min(SOLDIERS_PER_BIN, Math.floor(resto / UNIT_USD.soldier));
  const mostrado = giants * UNIT_USD.giant + tanks * UNIT_USD.tank + soldiers * UNIT_USD.soldier;
  return { giants, tanks, soldiers, overflow: usd - mostrado >= UNIT_USD.soldier };
}
