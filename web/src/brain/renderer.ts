// Imperative three.js renderer for the atlas specimen. React drives it through methods;
// hover, picking and the frame loop stay outside React for speed.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import type { Atlas } from "../atlas/load";
import { BOUNDARY, DEEP_TONES, MEDIAL_WALL, OVERLAY_STOPS, SPECIMEN, hexToRGB, linear, mix, type RGB } from "../colors";

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export type Surface = "pial" | "inflated";
export type View = "lh-lateral" | "lh-medial" | "rh-lateral" | "rh-medial" | "dorsal" | "ventral" | "anterior" | "posterior";
export type BaseLayer = "plain" | "regions" | "networks";
export type Part = "lh" | "rh" | number; // number = index into atlas.geometry.deep

export interface Anchor {
  part: Part;
  vertex: number;
}

export interface Hit {
  code: number; // structure code (index into atlas.geometry.regions)
  anchor: Anchor;
}

export const VIEW_LABELS: Record<View, string> = {
  "lh-lateral": "Left hemisphere, lateral",
  "lh-medial": "Left hemisphere, medial",
  "rh-lateral": "Right hemisphere, lateral",
  "rh-medial": "Right hemisphere, medial",
  dorsal: "Dorsal",
  ventral: "Ventral",
  anterior: "Anterior",
  posterior: "Posterior",
};

const VIEWS: Record<View, { dir: THREE.Vector3; hide?: "lh" | "rh" }> = {
  "lh-lateral": { dir: new THREE.Vector3(-1, 0, 0) },
  "lh-medial": { dir: new THREE.Vector3(1, 0, 0), hide: "rh" },
  "rh-lateral": { dir: new THREE.Vector3(1, 0, 0) },
  "rh-medial": { dir: new THREE.Vector3(-1, 0, 0), hide: "lh" },
  dorsal: { dir: new THREE.Vector3(0, -0.02, 1).normalize() },
  ventral: { dir: new THREE.Vector3(0, 0.02, -1).normalize() },
  anterior: { dir: new THREE.Vector3(0, 1, 0) },
  posterior: { dir: new THREE.Vector3(0, -1, 0) },
};

// Cortex hidden inside the lateral sulcus is only visible on the inflated surface.
const BURIED = new Set(["insula", "transversetemporal"]);
const HINDBRAIN = new Set(["cerebellum", "brainstem"]);
const INK = "vec3(0.008, 0.016, 0.06)"; // the interface's deep blue, linear RGB

interface Hemi {
  name: "lh" | "rh";
  mesh: THREE.Mesh;
  pial: Float32Array;
  inflated: Float32Array;
  region: Uint8Array;
  network: Uint8Array;
  boundary: Uint8Array;
  pick: { pial: THREE.Mesh; inflated: THREE.Mesh | null };
  index: Uint32Array;
}

interface Deep {
  code: number;
  id: string;
  hemi: "lh" | "rh" | null;
  mesh: THREE.Mesh;
  positions: Float32Array;
  offset: number; // into the map layout
}

interface Animation {
  start: number;
  duration: number;
  step: (t: number) => void;
  done?: () => void;
  tag?: string;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t: number) => 1 - (1 - t) ** 3;

function rampTexture(): THREE.DataTexture {
  const stops = OVERLAY_STOPS.map(hexToRGB);
  const n = 256;
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const p = (i / (n - 1)) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(p));
    const c = mix(stops[k], stops[k + 1], p - k);
    data.set([c[0] * 255, c[1] * 255, c[2] * 255, 255], i * 4);
  }
  const texture = new THREE.DataTexture(data, n, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function atlasMaterial(uniforms: Record<string, THREE.IUniform>, roughness: number): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float aShade; attribute float aRegion; attribute vec3 aBase; attribute float aOverlay;
varying float vShade; flat varying float vRegion; varying vec3 vBase; varying float vOverlay;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vShade = aShade; vRegion = aRegion; vBase = aBase; vOverlay = aOverlay;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uThreshold; uniform float uMax; uniform float uOverlayMix; uniform float uHover; uniform float uSelected;
uniform sampler2D uRamp;
varying float vShade; flat varying float vRegion; varying vec3 vBase; varying float vOverlay;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
vec3 base = vBase;
if (uOverlayMix > 0.0 && vOverlay >= uThreshold) {
  float t = clamp((vOverlay - uThreshold) / max(uMax - uThreshold, 0.001), 0.0, 1.0);
  base = mix(base, texture2D(uRamp, vec2(t, 0.5)).rgb, uOverlayMix);
}
base *= vShade;
if (abs(vRegion - uSelected) < 0.5) base = mix(base, ${INK}, 0.42);
else if (abs(vRegion - uHover) < 0.5) base = mix(base, ${INK}, 0.24);
diffuseColor.rgb *= base;`,
      );
  };
  return material;
}

export class BrainRenderer {
  readonly atlas: Atlas;
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private group = new THREE.Group();
  private hemis: Hemi[] = [];
  private deep: Deep[] = [];
  private envelopes: Record<"lh" | "rh", THREE.Mesh>;
  private uniforms: Record<string, THREE.IUniform>;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerInside = false;
  private pendingPick = false;
  private downAt: { x: number; y: number } | null = null;
  private lastHover = -2;
  private animations: Animation[] = [];
  private dirty = true;
  private raf = 0;
  private observer: ResizeObserver;
  private frameCallbacks = new Set<() => void>();
  private hoverCallback: ((hit: Hit | null) => void) | null = null;
  private clickCallback: ((hit: Hit | null) => void) | null = null;
  private centre = new THREE.Vector3();
  private radius = { pial: 100, inflated: 120 };

  surface: Surface = "pial";
  morph = 0;
  deepMode = false;
  hidden: "lh" | "rh" | null = null;
  baseLayer: BaseLayer = "regions";
  view: View = "lh-lateral";

  constructor(container: HTMLElement, atlas: Atlas) {
    this.atlas = atlas;
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(22, 1, 1, 4000);
    this.camera.up.set(0, 0, 1); // anatomical: z is superior
    this.scene.add(this.camera);
    // Porcelain under a warm key light, with cool shadows taken from the deep-blue surround.
    this.scene.add(new THREE.HemisphereLight(0xfff6ea, 0x3b4b78, 1.2));
    const key = new THREE.DirectionalLight(0xfff1df, 2.0);
    key.position.set(-1, 1.3, 1.1);
    const fill = new THREE.DirectionalLight(0xc9d6f2, 0.5);
    fill.position.set(1.4, -0.3, 0.7);
    const rim = new THREE.DirectionalLight(0xdfe8ff, 0.85);
    rim.position.set(0.3, 1.0, -1.3);
    for (const light of [key, fill, rim]) {
      light.target.position.set(0, 0, -1);
      this.camera.add(light, light.target);
    }

    this.uniforms = {
      uThreshold: { value: atlas.catalogue.threshold },
      uMax: { value: 10 },
      uOverlayMix: { value: 0 },
      uHover: { value: -1 },
      uSelected: { value: -1 },
      uRamp: { value: rampTexture() },
    };
    const cortexMaterial = atlasMaterial(this.uniforms, 0.56);
    const deepMaterial = atlasMaterial(this.uniforms, 0.48);

    for (const name of ["lh", "rh"] as const) this.hemis.push(this.buildHemisphere(name, cortexMaterial));
    atlas.geometry.deep.forEach((d, i) => this.deep.push(this.buildDeep(d, i, deepMaterial)));
    this.envelopes = { lh: this.buildEnvelope("lh"), rh: this.buildEnvelope("rh") };
    this.scene.add(this.group);
    this.measure();
    this.paintBase();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.65;
    this.controls.target.copy(this.centre);
    this.controls.minDistance = 120;
    this.controls.maxDistance = 1400;
    this.controls.addEventListener("change", () => (this.dirty = true));
    this.raycaster.firstHitOnly = true;

    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.setView("lh-lateral", false);
    this.applyVisibility();
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---- construction ----------------------------------------------------------------

  private buildHemisphere(name: "lh" | "rh", material: THREE.Material): Hemi {
    const meta = this.atlas.geometry.hemispheres[name];
    const pial = this.atlas.array(meta.buffers.pial) as Float32Array;
    const inflated = this.atlas.array(meta.buffers.inflated) as Float32Array;
    const index = this.atlas.array(meta.buffers.index) as Uint32Array;
    const region = this.atlas.array(meta.buffers.region) as Uint8Array;
    const sulc = this.atlas.array(meta.buffers.sulc) as Int8Array;
    const n = meta.vertices;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pial, 3));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeVertexNormals();
    const inflatedNormals = new THREE.BufferGeometry();
    inflatedNormals.setAttribute("position", new THREE.BufferAttribute(inflated, 3));
    inflatedNormals.setIndex(new THREE.BufferAttribute(index, 1));
    inflatedNormals.computeVertexNormals();
    geometry.morphAttributes.position = [new THREE.BufferAttribute(inflated, 3)];
    geometry.morphAttributes.normal = [inflatedNormals.getAttribute("normal")];

    const shade = new Float32Array(n);
    for (let i = 0; i < n; i++) shade[i] = Math.min(1.12, Math.max(0.6, 1 - 0.32 * (sulc[i] / 127)));
    geometry.setAttribute("aShade", new THREE.BufferAttribute(shade, 1));
    geometry.setAttribute("aRegion", new THREE.BufferAttribute(Float32Array.from(region), 1));
    geometry.setAttribute("aBase", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geometry.setAttribute("aOverlay", new THREE.BufferAttribute(new Float32Array(n), 1));

    const mesh = new THREE.Mesh(geometry, material);
    mesh.morphTargetInfluences = [0];
    mesh.frustumCulled = false;
    this.group.add(mesh);

    const hemi: Hemi = {
      name,
      mesh,
      pial,
      inflated,
      region,
      network: this.atlas.array(meta.buffers.network) as Uint8Array,
      boundary: this.atlas.array(meta.buffers.boundary) as Uint8Array,
      pick: { pial: this.pickMesh(pial, index, name), inflated: null },
      index,
    };
    return hemi;
  }

  private pickMesh(positions: Float32Array, index: Uint32Array, hemi: "lh" | "rh"): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1)); // the BVH reorders its own copy
    geometry.computeBoundsTree();
    const mesh = new THREE.Mesh(geometry);
    mesh.visible = false; // raycast only
    mesh.userData.hemi = hemi;
    this.group.add(mesh);
    return mesh;
  }

  private buildDeep(d: Atlas["geometry"]["deep"][number], i: number, material: THREE.Material): Deep {
    const structure = this.atlas.geometry.regions[d.region];
    const positions = this.atlas.array(d.buffers.position) as Float32Array;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(this.atlas.array(d.buffers.index) as Uint32Array), 1));
    geometry.computeVertexNormals();
    geometry.setAttribute("aShade", new THREE.BufferAttribute(new Float32Array(d.vertices).fill(1), 1));
    geometry.setAttribute("aRegion", new THREE.BufferAttribute(new Float32Array(d.vertices).fill(d.region), 1));
    const tone = linear(DEEP_TONES[structure.id] ?? SPECIMEN);
    const base = new Float32Array(d.vertices * 3);
    for (let v = 0; v < d.vertices; v++) base.set(tone, v * 3);
    geometry.setAttribute("aBase", new THREE.BufferAttribute(base, 3));
    geometry.setAttribute("aOverlay", new THREE.BufferAttribute(new Float32Array(d.vertices), 1));
    geometry.computeBoundsTree();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.deep = i;
    this.group.add(mesh);
    return { code: d.region, id: structure.id, hemi: structure.hemi, mesh, positions, offset: d.map_offset };
  }

  private buildEnvelope(name: "lh" | "rh"): THREE.Mesh {
    const e = this.atlas.geometry.envelope[name];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.atlas.array(e.position) as Float32Array, 3));
    geometry.setIndex(new THREE.BufferAttribute(this.atlas.array(e.index) as Uint32Array, 1));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color: 0xe6ddca,
      roughness: 1,
      transparent: true,
      opacity: 0.09,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 2;
    mesh.raycast = () => {}; // context only, never picked
    this.group.add(mesh);
    return mesh;
  }

  private measure(): void {
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    for (const h of this.hemis) {
      for (let i = 0; i < h.pial.length; i += 3) box.expandByPoint(point.set(h.pial[i], h.pial[i + 1], h.pial[i + 2]));
    }
    for (const d of this.deep.filter((d) => HINDBRAIN.has(d.id))) {
      for (let i = 0; i < d.positions.length; i += 3)
        box.expandByPoint(point.set(d.positions[i], d.positions[i + 1], d.positions[i + 2]));
    }
    box.getCenter(this.centre);
    this.radius.pial = box.getSize(point).length() / 2;
    const inflatedBox = new THREE.Box3();
    for (const h of this.hemis) {
      for (let i = 0; i < h.inflated.length; i += 3)
        inflatedBox.expandByPoint(point.set(h.inflated[i], h.inflated[i + 1], h.inflated[i + 2]));
    }
    this.radius.inflated = inflatedBox.getSize(point).length() / 2;
  }

  // ---- appearance --------------------------------------------------------------------

  setBaseLayer(layer: BaseLayer): void {
    this.baseLayer = layer;
    this.paintBase();
  }

  private paintBase(): void {
    const structures = this.atlas.geometry.regions;
    const networkColour = new Map(this.atlas.geometry.networks.map((n) => [n.index, hexToRGB(n.color)]));
    const specimen = linear(SPECIMEN);
    const wall = linear(MEDIAL_WALL);
    const edge = linear(mix(SPECIMEN, BOUNDARY, 0.62));
    const networks = new Map([...networkColour].map(([k, c]) => [k, linear(mix(SPECIMEN, c, 0.86))]));
    for (const h of this.hemis) {
      const attribute = h.mesh.geometry.getAttribute("aBase") as THREE.BufferAttribute;
      const out = attribute.array as Float32Array;
      for (let v = 0; v < h.region.length; v++) {
        let c: RGB = specimen;
        if (structures[h.region[v]].kind === "medialwall") c = wall;
        else if (this.baseLayer === "networks") c = networks.get(h.network[v]) ?? wall;
        else if (this.baseLayer === "regions" && h.boundary[v]) c = edge;
        out[v * 3] = c[0];
        out[v * 3 + 1] = c[1];
        out[v * 3 + 2] = c[2];
      }
      attribute.needsUpdate = true;
    }
    this.dirty = true;
  }

  /** values: [lh vertices | rh vertices | deep vertices] in map layout; null clears the overlay. */
  setOverlay(values: Float32Array | null, max = 10, fire = false): void {
    if (!values) {
      const from = this.uniforms.uOverlayMix.value as number;
      this.animate(250, (t) => (this.uniforms.uOverlayMix.value = from * (1 - t)), undefined, "overlay");
      return;
    }
    const { lh } = this.atlas.catalogue.layout;
    const deepStart = lh + this.atlas.catalogue.layout.rh;
    for (const h of this.hemis) {
      const attribute = h.mesh.geometry.getAttribute("aOverlay") as THREE.BufferAttribute;
      const start = h.name === "lh" ? 0 : lh;
      (attribute.array as Float32Array).set(values.subarray(start, start + h.region.length));
      attribute.needsUpdate = true;
    }
    for (const d of this.deep) {
      const attribute = d.mesh.geometry.getAttribute("aOverlay") as THREE.BufferAttribute;
      const start = deepStart + d.offset;
      (attribute.array as Float32Array).set(values.subarray(start, start + attribute.count));
      attribute.needsUpdate = true;
    }
    this.uniforms.uMax.value = max;
    const threshold = this.threshold;
    this.animations = this.animations.filter((a) => a.tag !== "overlay"); // cancel a pending fade-out
    if (fire) {
      // Reveal by descending threshold: strongest associations appear first. Not a time course.
      this.uniforms.uOverlayMix.value = 1;
      this.animate(1700, (t) => (this.uniforms.uThreshold.value = max - (max - threshold) * easeOut(t)), undefined, "threshold");
    } else {
      this.uniforms.uThreshold.value = threshold;
      this.animate(250, (t) => (this.uniforms.uOverlayMix.value = Math.max(this.uniforms.uOverlayMix.value, t)), undefined, "overlay");
    }
    this.dirty = true;
  }

  private threshold = 3.1;

  setThreshold(value: number): void {
    this.threshold = value;
    this.animations = this.animations.filter((a) => a.tag !== "threshold");
    this.uniforms.uThreshold.value = value;
    this.dirty = true;
  }

  setHover(code: number): void {
    this.uniforms.uHover.value = code;
    this.dirty = true;
  }

  setSelected(code: number): void {
    this.uniforms.uSelected.value = code;
    this.dirty = true;
  }

  // ---- surfaces, layers, views ---------------------------------------------------------

  setSurface(surface: Surface, animate = true): void {
    if (surface === this.surface) return;
    this.surface = surface;
    if (surface === "inflated") {
      this.deepMode = false;
      for (const h of this.hemis) if (!h.pick.inflated) h.pick.inflated = this.pickMesh(h.inflated, h.index, h.name);
    }
    const from = this.morph;
    const to = surface === "inflated" ? 1 : 0;
    const startDistance = this.camera.position.distanceTo(this.controls.target);
    const endDistance = this.fitDistance(surface);
    this.applyVisibility();
    this.animate(
      animate ? 1100 : 0,
      (t) => {
        const k = ease(t);
        this.morph = from + (to - from) * k;
        for (const h of this.hemis) h.mesh.morphTargetInfluences![0] = this.morph;
        const dir = this.camera.position.clone().sub(this.controls.target).normalize();
        this.camera.position.copy(this.controls.target).addScaledVector(dir, startDistance + (endDistance - startDistance) * k);
      },
      () => this.applyVisibility(),
      "morph",
    );
  }

  setDeep(on: boolean): void {
    if (on && this.surface === "inflated") this.setSurface("pial");
    this.deepMode = on;
    this.applyVisibility();
  }

  setHidden(hidden: "lh" | "rh" | null): void {
    this.hidden = hidden;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    const inflatedOrMorphing = this.surface === "inflated" || this.morph > 0.001;
    for (const h of this.hemis) h.mesh.visible = !this.deepMode && this.hidden !== h.name;
    for (const name of ["lh", "rh"] as const) this.envelopes[name].visible = this.deepMode && this.hidden !== name;
    for (const d of this.deep) {
      const sideHidden = d.hemi !== null && d.hemi === this.hidden;
      if (this.deepMode) d.mesh.visible = !sideHidden;
      else d.mesh.visible = !inflatedOrMorphing && HINDBRAIN.has(d.id) && !sideHidden && !(d.hemi === null && this.hidden);
    }
    this.dirty = true;
  }

  private fitDistance(surface: Surface = this.surface): number {
    const r = this.radius[surface];
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspectFit = Math.min(1, this.camera.aspect);
    return (r / Math.sin(fov / 2)) * (0.9 / Math.max(aspectFit, 0.55));
  }

  setView(view: View, animate = true): void {
    this.view = view;
    this.setHidden(VIEWS[view].hide ?? null);
    const target = this.controls.target;
    const fromDir = this.camera.position.clone().sub(target).normalize();
    if (!isFinite(fromDir.x) || fromDir.lengthSq() === 0) fromDir.set(-1, 0, 0);
    const toDir = VIEWS[view].dir.clone().normalize();
    const fromDistance = this.camera.position.distanceTo(target) || this.fitDistance();
    const toDistance = this.fitDistance();
    const rotation = new THREE.Quaternion().setFromUnitVectors(fromDir, toDir);
    const identity = new THREE.Quaternion();
    this.controls.enabled = false;
    this.animate(
      animate ? 850 : 0,
      (t) => {
        const k = ease(t);
        const q = identity.clone().slerp(rotation, k);
        const dir = fromDir.clone().applyQuaternion(q);
        this.camera.position.copy(target).addScaledVector(dir, fromDistance + (toDistance - fromDistance) * k);
        this.camera.lookAt(target);
      },
      () => {
        this.controls.enabled = true;
        this.controls.update();
      },
      "camera",
    );
  }

  /** Bring a structure into view: right surface, layer and viewpoint. */
  focus(code: number): void {
    const structure = this.atlas.geometry.regions[code];
    const stats = this.atlas.stats[code];
    if (structure.kind === "deep") {
      this.setDeep(true);
      this.setView(structure.hemi === "rh" ? "rh-lateral" : "lh-lateral");
      return;
    }
    this.setDeep(false);
    if (BURIED.has(structure.id)) this.setSurface("inflated");
    this.setView(stats.view as View);
  }

  // ---- geometry queries ----------------------------------------------------------------

  anchorFor(code: number): Anchor {
    const structure = this.atlas.geometry.regions[code];
    const stats = this.atlas.stats[code];
    if (structure.kind === "deep") return { part: this.deep.findIndex((d) => d.code === code), vertex: stats.anchor };
    return { part: structure.hemi!, vertex: stats.anchor };
  }

  anchorPosition(anchor: Anchor, out = new THREE.Vector3()): THREE.Vector3 {
    if (typeof anchor.part === "number") {
      const p = this.deep[anchor.part].positions;
      return out.set(p[anchor.vertex * 3], p[anchor.vertex * 3 + 1], p[anchor.vertex * 3 + 2]);
    }
    const h = this.hemis[anchor.part === "lh" ? 0 : 1];
    const i = anchor.vertex * 3;
    const t = this.morph;
    return out.set(
      h.pial[i] + (h.inflated[i] - h.pial[i]) * t,
      h.pial[i + 1] + (h.inflated[i + 1] - h.pial[i + 1]) * t,
      h.pial[i + 2] + (h.inflated[i + 2] - h.pial[i + 2]) * t,
    );
  }

  anchorVisible(anchor: Anchor): boolean {
    if (typeof anchor.part === "number") return this.deep[anchor.part].mesh.visible;
    return this.hemis[anchor.part === "lh" ? 0 : 1].mesh.visible;
  }

  /** Page coordinates of a world point, and whether the surface hides it from the camera. */
  project(world: THREE.Vector3): { x: number; y: number; inView: boolean; occluded: boolean } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = world.clone().project(this.camera);
    const inView = ndc.z < 1 && Math.abs(ndc.x) <= 1.02 && Math.abs(ndc.y) <= 1.02;
    let occluded = false;
    if (inView) {
      const dir = world.clone().sub(this.camera.position);
      const distance = dir.length();
      this.raycaster.set(this.camera.position, dir.normalize());
      const hit = this.raycaster.intersectObjects(this.pickTargets(), false)[0];
      occluded = !!hit && hit.distance < distance - 1.5;
    }
    return { x: rect.left + ((ndc.x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc.y) / 2) * rect.height, inView, occluded };
  }

  pixelsPerMm(): number {
    const distance = this.camera.position.distanceTo(this.controls.target);
    const height = this.renderer.domElement.clientHeight;
    return height / (2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }

  /** Screen directions of the anatomical axes (R, A, S), as unit-ish 2D vectors (y down). */
  screenAxes(): Record<"R" | "A" | "S", [number, number]> {
    const origin = this.controls.target.clone().project(this.camera);
    const axis = (v: THREE.Vector3): [number, number] => {
      const p = this.controls.target.clone().addScaledVector(v, 20).project(this.camera);
      return [p.x - origin.x, -(p.y - origin.y) * (1 / this.camera.aspect)];
    };
    const raw = { R: axis(new THREE.Vector3(1, 0, 0)), A: axis(new THREE.Vector3(0, 1, 0)), S: axis(new THREE.Vector3(0, 0, 1)) };
    const longest = Math.max(...Object.values(raw).map(([x, y]) => Math.hypot(x, y)), 1e-6);
    return Object.fromEntries(Object.entries(raw).map(([k, [x, y]]) => [k, [x / longest, y / longest]])) as Record<
      "R" | "A" | "S",
      [number, number]
    >;
  }

  // ---- picking -----------------------------------------------------------------------

  private pickTargets(): THREE.Object3D[] {
    const targets: THREE.Object3D[] = [];
    const settled = this.morph === 0 || this.morph === 1;
    if (!this.deepMode && settled) {
      for (const h of this.hemis) {
        if (!h.mesh.visible) continue;
        const pick = this.morph === 1 ? h.pick.inflated : h.pick.pial;
        if (pick) targets.push(pick);
      }
    }
    for (const d of this.deep) if (d.mesh.visible) targets.push(d.mesh);
    return targets;
  }

  private pick(): Hit | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickTargets(), false)[0];
    if (!hit || !hit.face) return null;
    const hemi = hit.object.userData.hemi as "lh" | "rh" | undefined;
    if (hemi) {
      const h = this.hemis[hemi === "lh" ? 0 : 1];
      const positions = this.morph === 1 ? h.inflated : h.pial;
      let best = hit.face.a;
      let bestDistance = Infinity;
      for (const v of [hit.face.a, hit.face.b, hit.face.c]) {
        const d = hit.point.distanceToSquared(new THREE.Vector3(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]));
        if (d < bestDistance) [best, bestDistance] = [v, d];
      }
      return { code: h.region[best], anchor: { part: hemi, vertex: best } };
    }
    const i = hit.object.userData.deep as number;
    return { code: this.deep[i].code, anchor: { part: i, vertex: hit.face.a } };
  }

  private onPointerMove = (event: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.pointerInside = true;
    this.pendingPick = true;
  };

  private onPointerLeave = () => {
    this.pointerInside = false;
    this.pendingPick = false;
    if (this.lastHover !== -1) {
      this.lastHover = -1;
      this.hoverCallback?.(null);
    }
  };

  private onPointerDown = (event: PointerEvent) => {
    this.downAt = { x: event.clientX, y: event.clientY };
  };

  private onPointerUp = (event: PointerEvent) => {
    if (!this.downAt) return;
    const moved = Math.hypot(event.clientX - this.downAt.x, event.clientY - this.downAt.y);
    this.downAt = null;
    if (moved < 4) this.clickCallback?.(this.pick());
  };

  onHover(callback: (hit: Hit | null) => void): void {
    this.hoverCallback = callback;
  }

  onClick(callback: (hit: Hit | null) => void): void {
    this.clickCallback = callback;
  }

  onFrame(callback: () => void): () => void {
    this.frameCallbacks.add(callback);
    return () => this.frameCallbacks.delete(callback);
  }

  // ---- loop ----------------------------------------------------------------------------

  private animate(duration: number, step: (t: number) => void, done?: () => void, tag?: string): void {
    if (tag) this.animations = this.animations.filter((a) => a.tag !== tag);
    if (duration <= 0) {
      step(1);
      done?.();
      this.dirty = true;
      return;
    }
    this.animations.push({ start: performance.now(), duration, step, done, tag });
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const active = this.animations.length > 0;
    for (const a of [...this.animations]) {
      const t = Math.min(1, (now - a.start) / a.duration);
      a.step(t);
      if (t >= 1) {
        this.animations.splice(this.animations.indexOf(a), 1);
        a.done?.();
      }
    }
    if (this.controls.enabled && this.controls.update()) this.dirty = true;
    if (this.pendingPick && this.pointerInside && !active) {
      this.pendingPick = false;
      const hit = this.pick();
      const code = hit ? hit.code : -1;
      if (code !== this.lastHover) {
        this.lastHover = code;
        this.hoverCallback?.(hit);
      }
    }
    if (this.dirty || active) {
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
      for (const callback of this.frameCallbacks) callback();
    }
  };

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  /** Move the canvas into another container (one renderer serves every view). */
  attach(container: HTMLElement): void {
    if (container === this.container) return;
    this.observer.disconnect();
    this.container = container;
    container.appendChild(this.renderer.domElement);
    this.observer.observe(container);
    this.resize();
    this.setView(this.view, false); // refit the camera to the new aspect ratio
    this.dirty = true;
  }

  /** Transparent PNG at `scale` × the on-screen pixel size, for figures. */
  exportPNG(scale = 3): string {
    const size = this.renderer.getSize(new THREE.Vector2());
    const ratio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(scale);
    this.renderer.setSize(size.x, size.y, false);
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL("image/png");
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(size.x, size.y, false);
    this.dirty = true;
    return url;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
