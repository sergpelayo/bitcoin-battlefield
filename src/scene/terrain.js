import * as THREE from 'three';
import { fbm2, smoothstep } from './noise.js';
import { LAKES, TERRAIN } from './field.js';

/**
 * El valle.
 *
 * La altura se calcula una sola vez en CPU y se hornea en la geometría: así el
 * mismo campo de alturas sirve para la malla, para posar árboles, casas, vías y
 * tropas sobre el suelo, y para consultar la cota en cada frame.
 *
 * Lo único que cambia en vivo es el *color*: la frontera entre territorio verde
 * (toros) y territorio árido (osos) se calcula en el fragment shader a partir de
 * `uFrontX`, así que el bando dominante gana terreno sin recalcular geometría.
 */
export class Terrain {
  constructor() {
    this.lakes = LAKES.map((l) => ({ ...l }));
    this._prepareLakes();
    this._buildHeightGrid();

    this.uniforms = { uFrontX: { value: 0 } };
    this.mesh = this._buildMesh();
    this.water = this._buildWater();
  }

  addTo(scene) {
    scene.add(this.mesh);
    for (const w of this.water) scene.add(w);
  }

  setFront(x) {
    this.uniforms.uFrontX.value = x;
  }

  // ------------------------------------------------------------- alturas ----
  /** Relieve base, antes de excavar los lagos. */
  _baseHeight(x, z) {
    let h = (fbm2(x * 0.011, z * 0.011, 4) - 0.5) * 21;
    h += (fbm2(x * 0.045 + 31.7, z * 0.045 + 12.3, 3) - 0.5) * 4.4;

    // Vaguada a lo largo de la línea del frente: los ejércitos chocan en el fondo del valle.
    h -= 5.5 * Math.exp(-(x * x) / (2 * 30 * 30));

    // Cordillera lejana: debe recortarse contra el cielo, no taparlo. Si sube
    // por encima de la cámara se come el horizonte y se pierde la profundidad.
    const far = Math.max(0, (-z - 80) / 110);
    h += far * far * 14;
    const side = Math.max(0, (Math.abs(x) - 100) / 80);
    h += side * side * 12;

    return h;
  }

  /**
   * Cada lago se excava por debajo del mínimo real de su entorno, así el agua
   * nunca puede quedar por encima del borde de la cuenca.
   */
  _prepareLakes() {
    for (const lake of this.lakes) {
      let min = Infinity;
      for (let i = 0; i <= 10; i++) {
        for (let j = 0; j <= 10; j++) {
          const x = lake.x + (i / 10 - 0.5) * 2 * lake.r;
          const z = lake.z + (j / 10 - 0.5) * 2 * lake.r;
          if (Math.hypot(x - lake.x, z - lake.z) > lake.r) continue;
          min = Math.min(min, this._baseHeight(x, z));
        }
      }
      lake.floor = min - 4.5;
      lake.water = lake.floor + 2.6;
    }
  }

  heightAt(x, z) {
    let h = this._baseHeight(x, z);
    for (const lake of this.lakes) {
      const d = Math.hypot(x - lake.x, z - lake.z);
      // Fondo plano hasta 0.75r, y rampa hasta el borde.
      const t = smoothstep(lake.r, lake.r * 0.75, d);
      if (t > 0) h = h * (1 - t) + lake.floor * t;
    }
    return h;
  }

  _buildHeightGrid() {
    const { x0, x1, z0, z1, segX, segZ } = TERRAIN;
    this.nx = segX + 1;
    this.nz = segZ + 1;
    this.dx = (x1 - x0) / segX;
    this.dz = (z1 - z0) / segZ;

    this.heights = new Float32Array(this.nx * this.nz);
    this.vars = new Float32Array(this.nx * this.nz);

    for (let iz = 0; iz < this.nz; iz++) {
      const z = z0 + iz * this.dz;
      for (let ix = 0; ix < this.nx; ix++) {
        const x = x0 + ix * this.dx;
        const k = iz * this.nx + ix;
        this.heights[k] = this.heightAt(x, z);
        this.vars[k] = fbm2(x * 0.021 + 7.1, z * 0.021 - 3.3, 3);
      }
    }
  }

  /** Cota del suelo, interpolada del mismo grid que dibuja la malla. */
  sample(x, z) {
    const { x0, z0 } = TERRAIN;
    const fx = Math.min(Math.max((x - x0) / this.dx, 0), this.nx - 1.001);
    const fz = Math.min(Math.max((z - z0) / this.dz, 0), this.nz - 1.001);
    const ix = fx | 0;
    const iz = fz | 0;
    const tx = fx - ix;
    const tz = fz - iz;
    const h = this.heights;
    const k = iz * this.nx + ix;
    const h00 = h[k];
    const h10 = h[k + 1];
    const h01 = h[k + this.nx];
    const h11 = h[k + this.nx + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  /** ¿Está el punto dentro de un lago? Para no plantar árboles en el agua. */
  inLake(x, z, margin = 4) {
    for (const lake of this.lakes) {
      if (Math.hypot(x - lake.x, z - lake.z) < lake.r * 0.85 + margin) return true;
    }
    return false;
  }

  // -------------------------------------------------------------- malla ----
  _buildMesh() {
    const { x0, z0, segX, segZ } = TERRAIN;
    const { nx, nz, dx, dz } = this;

    const positions = new Float32Array(nx * nz * 3);
    const vars = new Float32Array(nx * nz);
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const k = iz * nx + ix;
        positions[k * 3] = x0 + ix * dx;
        positions[k * 3 + 1] = this.heights[k];
        positions[k * 3 + 2] = z0 + iz * dz;
        vars[k] = this.vars[k];
      }
    }

    // Orden (a, c, b) para que la normal apunte a +Y.
    const indices = new Uint32Array(segX * segZ * 6);
    let o = 0;
    for (let iz = 0; iz < segZ; iz++) {
      for (let ix = 0; ix < segX; ix++) {
        const a = iz * nx + ix;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        indices[o++] = a;
        indices[o++] = c;
        indices[o++] = b;
        indices[o++] = b;
        indices[o++] = c;
        indices[o++] = d;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aTerrainVar', new THREE.BufferAttribute(vars, 1));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();

    return new THREE.Mesh(geo, this._buildMaterial());
  }

  _buildMaterial() {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uFrontX = this.uniforms.uFrontX;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           attribute float aTerrainVar;
           varying float vVar;
           varying vec3 vWPos;
           varying vec3 vWNormal;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vVar = aTerrainVar;
           vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
           vWNormal = normalize(mat3(modelMatrix) * objectNormal);`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uFrontX;
           varying float vVar;
           varying vec3 vWPos;
           varying vec3 vWNormal;`,
        )
        .replace(
          '#include <color_fragment>',
          `
          // La frontera es la vía: mismo serpenteo que en props.js (roadOffset).
          float road = uFrontX + sin(vWPos.z * 0.035) * 7.0 + sin(vWPos.z * 0.017 + 1.2) * 4.5;
          float raw = vWPos.x - road;
          float d = raw + (vVar - 0.5) * 15.0;
          float side = smoothstep(-7.0, 7.0, d);

          // Territorio de los toros: pradera viva. El de los osos: tierra seca.
          vec3 lush = mix(vec3(0.120, 0.400, 0.140), vec3(0.310, 0.640, 0.200), vVar);
          vec3 arid = mix(vec3(0.390, 0.270, 0.120), vec3(0.660, 0.500, 0.235), vVar);
          vec3 col = mix(lush, arid, side);

          // Franja calcinada, estrecha, pegada a la vía.
          float scorch = exp(-raw * raw / 190.0);
          col = mix(col, vec3(0.175, 0.145, 0.105), scorch * 0.72);

          // Roca y barro solo en las pendientes de verdad fuertes.
          float slope = 1.0 - clamp(vWNormal.y, 0.0, 1.0);
          col = mix(col, vec3(0.365, 0.320, 0.255), smoothstep(0.35, 0.78, slope));

          // Las hondonadas quedan algo más oscuras que las lomas.
          col *= 0.82 + 0.18 * smoothstep(-16.0, 14.0, vWPos.y);

          diffuseColor.rgb *= col;
          `,
        );
    };

    return mat;
  }

  _buildWater() {
    return this.lakes.map((lake) => {
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(lake.r * 0.8, 44),
        new THREE.MeshStandardMaterial({
          color: 0x10394f,
          roughness: 0.12,
          metalness: 0.55,
          transparent: true,
          opacity: 0.94,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(lake.x, lake.water, lake.z);
      return mesh;
    });
  }
}
