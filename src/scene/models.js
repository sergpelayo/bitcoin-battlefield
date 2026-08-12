import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Modelos low-poly estilo WW2. Cada modelo se fusiona en una única geometría con
 * colores horneados por vértice, de modo que un solo InstancedMesh dibuja cientos
 * de unidades multicolor con una sola draw call.
 *
 * Todos los modelos miran hacia +Z.
 */

const _c = new THREE.Color();

/** Tiñe una geometría y la deja lista para fusionar. */
function paint(geo, hex) {
  _c.setHex(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _c.r;
    arr[i * 3 + 1] = _c.g;
    arr[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function box(w, h, d, x, y, z, hex) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return paint(g, hex);
}

function cyl(rt, rb, h, seg, x, y, z, hex, rot) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  if (rot) g.rotateX(rot);
  g.translate(x, y, z);
  return paint(g, hex);
}

function cone(r, h, seg, x, y, z, hex) {
  const g = new THREE.ConeGeometry(r, h, seg);
  g.translate(x, y, z);
  return paint(g, hex);
}

function finish(parts) {
  const geo = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return geo;
}

// ---------------------------------------------------------------- paletas ----
// Los toros van de azul: contra la pradera verde, el verde no se leería.
// Los osos, de rojo saturado, contra la tierra ocre.
export const BULL_PALETTE = {
  uniform: 0x2f6fb0,
  helmet: 0x1d4a7d,
  skin: 0xd8ab7c,
  metal: 0x1b2b3c,
  hull: 0x2c6aa8,
  track: 0x111c28,
  accent: 0x7fd0ff,
};

export const BEAR_PALETTE = {
  uniform: 0xa32a20,
  helmet: 0x741a13,
  skin: 0xd8ab7c,
  metal: 0x3a1c16,
  hull: 0xb03225,
  track: 0x24100c,
  accent: 0xffb0a0,
};

// --------------------------------------------------------------- unidades ----
/** Soldadito: ~1.15 de alto. */
export function createSoldier(p) {
  return finish([
    box(0.16, 0.44, 0.16, -0.12, 0.22, 0, p.uniform),
    box(0.16, 0.44, 0.16, 0.12, 0.22, 0, p.uniform),
    box(0.44, 0.46, 0.26, 0, 0.67, 0, p.uniform),
    box(0.13, 0.13, 0.34, -0.28, 0.72, 0.06, p.uniform),
    box(0.13, 0.13, 0.34, 0.28, 0.72, 0.06, p.uniform),
    box(0.22, 0.2, 0.22, 0, 1, 0, p.skin),
    // Casco: plato ancho y bajo, la silueta más reconocible del soldado WW2.
    cyl(0.19, 0.21, 0.11, 8, 0, 1.13, 0, p.helmet),
    // Fusil al hombro.
    box(0.05, 0.05, 0.66, 0.26, 0.78, 0.1, p.metal),
    box(0.3, 0.26, 0.12, 0, 0.62, -0.2, p.metal),
  ]);
}

/** Tanquecito: ~3 de largo, mirando a +Z. */
export function createTank(p) {
  const parts = [
    box(1.4, 0.5, 2.3, 0, 0.62, 0, p.hull),
    box(1.15, 0.3, 1.5, 0, 0.95, -0.15, p.hull),
    box(0.44, 0.56, 2.7, -0.82, 0.34, 0, p.track),
    box(0.44, 0.56, 2.7, 0.82, 0.34, 0, p.track),
    // Ruedas insinuadas sobre las orugas.
    box(0.5, 0.16, 2.3, -0.82, 0.5, 0, p.metal),
    box(0.5, 0.16, 2.3, 0.82, 0.5, 0, p.metal),
    box(0.95, 0.42, 1.05, 0, 1.28, -0.1, p.hull),
    cyl(0.09, 0.09, 1.6, 8, 0, 1.32, 0.95, p.metal, Math.PI / 2),
    box(0.16, 0.16, 0.16, -0.3, 1.55, -0.3, p.metal),
  ];
  return finish(parts);
}

/**
 * Tanque superpesado tipo Maus: una orden de un millón de dólares.
 *
 * No es el tanque normal escalado — a igual tamaño se confundirían. Aquí el
 * casco es largo y bajo, las orugas comen media silueta y el cañón sobresale
 * de forma desproporcionada, así que se reconoce por perfil incluso de lejos y
 * aunque tenga tanques normales pegados al lado.
 */
export function createSuperTank(p) {
  return finish([
    // Casco: dos cuerpos para insinuar el blindaje frontal inclinado.
    box(3.0, 1.05, 5.4, 0, 1.35, 0, p.hull),
    box(2.6, 0.62, 4.4, 0, 2.05, -0.2, p.hull),
    box(2.75, 0.5, 1.5, 0, 1.0, 2.6, p.hull),
    // Orugas: enormes, son la mitad del carácter del modelo.
    box(0.95, 1.25, 6.0, -1.72, 0.72, 0, p.track),
    box(0.95, 1.25, 6.0, 1.72, 0.72, 0, p.track),
    box(1.02, 0.3, 5.2, -1.72, 1.2, 0, p.metal),
    box(1.02, 0.3, 5.2, 1.72, 1.2, 0, p.metal),
    // Torreta y cañón largo: lo que remata la silueta.
    box(2.1, 0.95, 2.4, 0, 2.78, -0.25, p.hull),
    box(1.5, 0.4, 0.9, 0, 3.32, -0.3, p.hull),
    cyl(0.19, 0.22, 4.2, 10, 0, 2.85, 2.1, p.metal, Math.PI / 2),
    cyl(0.3, 0.3, 0.5, 10, 0, 2.85, 0.9, p.metal, Math.PI / 2),
    // Detalles: escotilla, antena y cajas de munición.
    box(0.5, 0.16, 0.5, -0.55, 3.55, -0.5, p.metal),
    box(0.08, 1.5, 0.08, 0.8, 3.6, -1.0, p.metal),
    box(0.7, 0.4, 0.8, 0, 2.0, -2.4, p.accent),
  ]);
}

/** Avioncito: ~4 de envergadura, mirando a +Z. */
export function createPlane(p) {
  return finish([
    box(0.46, 0.46, 3.2, 0, 0, 0, p.hull),
    box(4.4, 0.13, 0.86, 0, -0.04, 0.15, p.hull),
    box(1.5, 0.11, 0.5, 0, 0.02, -1.42, p.hull),
    box(0.11, 0.62, 0.55, 0, 0.36, -1.45, p.hull),
    cyl(0.2, 0.28, 0.26, 8, 0, 0, 1.68, p.metal, Math.PI / 2),
    // Hélice: disco fino, se ve como un borrón al girar.
    box(0.06, 1.5, 0.06, 0, 0, 1.84, p.metal),
    box(1.5, 0.06, 0.06, 0, 0, 1.84, p.metal),
    box(0.34, 0.24, 0.5, 0, 0.28, 0.2, p.metal),
    box(0.9, 0.1, 0.36, 0, 0.02, 0.3, p.accent),
  ]);
}

// ------------------------------------------------------------------ props ----
/** Pino: devuelve una sola geometría (tronco + tres conos). */
export function createPine(foliageHex, trunkHex = 0x3a2a1c) {
  return finish([
    cyl(0.13, 0.17, 1, 6, 0, 0.5, 0, trunkHex),
    cone(1.05, 1.5, 7, 0, 1.55, 0, foliageHex),
    cone(0.82, 1.3, 7, 0, 2.35, 0, foliageHex),
    cone(0.55, 1.1, 7, 0, 3.05, 0, foliageHex),
  ]);
}

/** Pino seco / quemado del lado de los osos. */
export function createDeadPine() {
  return finish([
    cyl(0.11, 0.18, 2.4, 6, 0, 1.2, 0, 0x3b2b1e),
    box(0.09, 0.09, 1.1, 0.35, 1.9, 0, 0x3b2b1e),
    box(1.1, 0.09, 0.09, -0.4, 2.3, 0, 0x3b2b1e),
    cone(0.5, 0.9, 6, 0, 2.7, 0, 0x2e2418),
  ]);
}

/** Casita: cuerpo + tejado a cuatro aguas. */
export function createHouse(wallHex, roofHex) {
  const roof = new THREE.ConeGeometry(1.9, 1.2, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 2.1, 0);
  return finish([
    box(2.2, 1.6, 2.5, 0, 0.8, 0, wallHex),
    paint(roof, roofHex),
    box(0.35, 0.9, 0.35, 0.6, 2.3, 0, 0x2a2018),
  ]);
}

/** Casa en ruinas, para el lado árido. */
export function createRuin() {
  return finish([
    box(2.2, 1.1, 2.4, 0, 0.55, 0, 0x4a4038),
    box(0.5, 1.5, 0.5, -0.85, 0.75, -0.95, 0x53483e),
    box(0.5, 0.9, 0.5, 0.9, 0.45, 0.9, 0x53483e),
    box(2.4, 0.14, 0.7, 0.2, 1.15, -0.6, 0x3b332c),
  ]);
}

/** Traviesa de la vía. */
export function createTie() {
  return paint(new THREE.BoxGeometry(5.6, 0.18, 0.7), 0x3a2c1e);
}
