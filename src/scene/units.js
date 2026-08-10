import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Geometrías low-poly de las unidades. Se fusionan en una sola geometría para
 * poder dibujar centenares de soldados con un único InstancedMesh.
 */

function translated(geo, x, y, z) {
  geo.translate(x, y, z);
  return geo;
}

/** Toro: cuerpo robusto, morro adelantado y dos cuernos. */
export function createBullGeometry() {
  const parts = [
    translated(new THREE.BoxGeometry(0.52, 0.46, 0.78), 0, 0.42, 0),
    translated(new THREE.BoxGeometry(0.34, 0.32, 0.3), 0, 0.52, 0.5),
    translated(new THREE.BoxGeometry(0.12, 0.34, 0.12), -0.16, 0.13, -0.24),
    translated(new THREE.BoxGeometry(0.12, 0.34, 0.12), 0.16, 0.13, -0.24),
    translated(new THREE.BoxGeometry(0.12, 0.34, 0.12), -0.16, 0.13, 0.26),
    translated(new THREE.BoxGeometry(0.12, 0.34, 0.12), 0.16, 0.13, 0.26),
  ];

  const hornL = new THREE.ConeGeometry(0.07, 0.3, 5);
  hornL.rotateZ(0.5);
  hornL.translate(-0.22, 0.72, 0.46);
  const hornR = new THREE.ConeGeometry(0.07, 0.3, 5);
  hornR.rotateZ(-0.5);
  hornR.translate(0.22, 0.72, 0.46);
  parts.push(hornL, hornR);

  const geo = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return geo;
}

/** Oso: más ancho y encorvado, con orejas redondas. */
export function createBearGeometry() {
  const parts = [
    translated(new THREE.BoxGeometry(0.6, 0.54, 0.72), 0, 0.46, 0),
    translated(new THREE.BoxGeometry(0.38, 0.36, 0.34), 0, 0.66, 0.42),
    translated(new THREE.BoxGeometry(0.14, 0.16, 0.08), -0.16, 0.9, 0.42),
    translated(new THREE.BoxGeometry(0.14, 0.16, 0.08), 0.16, 0.9, 0.42),
    translated(new THREE.BoxGeometry(0.14, 0.36, 0.14), -0.19, 0.14, -0.22),
    translated(new THREE.BoxGeometry(0.14, 0.36, 0.14), 0.19, 0.14, -0.22),
    translated(new THREE.BoxGeometry(0.14, 0.36, 0.14), -0.19, 0.14, 0.24),
    translated(new THREE.BoxGeometry(0.14, 0.36, 0.14), 0.19, 0.14, 0.24),
  ];

  const snout = new THREE.ConeGeometry(0.11, 0.22, 5);
  snout.rotateX(Math.PI / 2);
  snout.translate(0, 0.62, 0.64);
  parts.push(snout);

  const geo = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return geo;
}
