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
