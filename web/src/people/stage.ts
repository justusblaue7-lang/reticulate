// A small studio for one 3D person: soft key light, cool rim light on the deep-blue ground,
// drag to turn the person, scroll or buttons to move between the full figure and the face.
// The person breathes and shifts a little, as people standing still do.

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { PersonStyle } from "../types";
import { applyStyle, disposePerson, loadPerson, type Person, type PersonAsset } from "./model";

/** 0 = the full figure, 1 = the face. */
export const FRAMES = { full: 0, bust: 0.62, face: 1 } as const;
export type Framing = keyof typeof FRAMES;

interface Options {
  zoom?: number;
  yaw?: number; // radians; 0 faces the camera
  interactive?: boolean;
  idle?: boolean;
}

const FOV = 26;

export class PersonStage {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 30);
  private turntable = new THREE.Group();
  private person: Person | null = null;
  private zoom: number;
  private zoomShown: number;
  private yaw: number;
  private spin = 0; // angular velocity after a drag
  private dragging: { x: number; t: number } | null = null;
  private clock = new THREE.Clock();
  private visible = true;
  private observer: IntersectionObserver;
  private resizeObserver: ResizeObserver;
  private idle: boolean;
  private loading = 0;
  private disposed = false;
  private style: PersonStyle | null = null;

  constructor(private holder: HTMLElement, options: Options = {}) {
    this.zoom = this.zoomShown = options.zoom ?? FRAMES.full;
    this.yaw = options.yaw ?? 0.32;
    this.idle = options.idle ?? true;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.className = "person-canvas";
    holder.appendChild(this.canvas);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.5;
    pmrem.dispose();

    const key = new THREE.DirectionalLight("#fff2e3", 2.6);
    key.position.set(1.4, 2.7, 2.3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = key.shadow.camera.bottom = -1.2;
    key.shadow.camera.right = key.shadow.camera.top = 1.2;
    key.shadow.radius = 5;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    key.target.position.set(0, 1, 0);
    const rim = new THREE.DirectionalLight("#c3cfff", 1.7);
    rim.position.set(-1.9, 2.2, -2.2);
    const fill = new THREE.HemisphereLight("#e4e8ff", "#151c33", 0.45);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1.4, 64), new THREE.ShadowMaterial({ opacity: 0.38 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(key, key.target, rim, fill, ground, this.turntable);

    this.observer = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.loop();
    });
    this.observer.observe(holder);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(holder);
    if (options.interactive ?? true) this.listen();
    this.resize();
  }

  /** Show a person; resolves when the person stands on the stage. */
  async show(asset: PersonAsset, style?: PersonStyle | null): Promise<void> {
    const ticket = ++this.loading;
    if (style !== undefined) this.style = style;
    const person = await loadPerson(asset);
    if (ticket !== this.loading || this.disposed) {
      disposePerson(person);
      return;
    }
    applyStyle(person, this.style);
    if (this.person) {
      this.turntable.remove(this.person.root);
      disposePerson(this.person);
    }
    this.person = person;
    this.turntable.add(person.root);
    this.zoomShown = this.zoom;
    this.render();
    this.loop();
  }

  /** The person's height as built, in metres (before a style), once they stand on the stage. */
  get builtHeight(): number | null {
    return this.person?.base.height ?? null;
  }

  /** Change the look of the person on the stage (and of anyone shown later). */
  restyle(style: PersonStyle | null) {
    this.style = style;
    if (!this.person) return;
    applyStyle(this.person, style);
    this.render();
  }

  setZoom(zoom: number) {
    this.zoom = THREE.MathUtils.clamp(zoom, 0, 1);
    this.loop();
  }

  turn(radians: number) {
    this.yaw = radians;
    this.spin = 0;
    this.loop();
  }

  /** A still of the current person, e.g. for a portrait. */
  snapshot(width: number, height: number, zoom: number, yaw: number, type = "image/png", quality?: number): string {
    const size = this.renderer.getSize(new THREE.Vector2());
    const ratio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.zoomShown = zoom;
    this.turntable.rotation.y = yaw;
    this.pose(0);
    this.frame();
    this.renderer.render(this.scene, this.camera);
    const url = this.canvas.toDataURL(type, quality);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(size.x, size.y, false);
    this.resize();
    return url;
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.observer.disconnect();
    this.resizeObserver.disconnect();
    if (this.person) disposePerson(this.person);
    this.person = null;
    this.renderer.dispose();
    this.canvas.remove();
  }

  private listen() {
    const c = this.canvas;
    c.style.touchAction = "pan-y";
    c.addEventListener("pointerdown", (e) => {
      this.dragging = { x: e.clientX, t: performance.now() };
      this.spin = 0;
      c.setPointerCapture(e.pointerId);
      this.loop();
    });
    c.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const now = performance.now();
      const delta = (e.clientX - this.dragging.x) * 0.01;
      this.yaw += delta;
      this.spin = THREE.MathUtils.clamp(delta / Math.max(8, now - this.dragging.t), -0.004, 0.004);
      this.dragging = { x: e.clientX, t: now };
    });
    const release = () => (this.dragging = null);
    c.addEventListener("pointerup", release);
    c.addEventListener("pointercancel", release);
    c.addEventListener("dblclick", () => this.turn(0.32));
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.setZoom(this.zoom - e.deltaY * 0.0012);
      },
      { passive: false },
    );
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.holder;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.render();
  }

  /** Camera for the current zoom: from the whole figure to the face. */
  private frame() {
    const p = this.person;
    const height = p?.height ?? 1.75;
    const eyes = p?.eyes ?? height * 0.93;
    const z = this.zoomShown;
    const smooth = z * z * (3 - 2 * z);
    const span = THREE.MathUtils.lerp(height * 1.12, 0.34, smooth); // what must fit, in metres
    const centre = THREE.MathUtils.lerp(height * 0.52, eyes - 0.04, Math.pow(smooth, 0.8));
    const vertical = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const distance = Math.max(span / 2 / vertical, (span * 0.62) / 2 / (vertical * this.camera.aspect));
    this.camera.position.set(0, centre + 0.02 * (1 - smooth), distance);
    this.camera.lookAt(0, centre, 0);
    this.camera.updateProjectionMatrix();
  }

  /** Breathing, a slow weight shift and small head movements, around the relaxed pose. */
  private pose(t: number) {
    const p = this.person;
    if (!p) return;
    const rotate = (name: string, axis: THREE.Vector3, degrees: number) => {
      const bone = p.bones[name];
      if (!bone) return;
      bone.quaternion.copy(p.rest[name]).multiply(new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(degrees)));
    };
    const X = new THREE.Vector3(1, 0, 0);
    const Y = new THREE.Vector3(0, 1, 0);
    const Z = new THREE.Vector3(0, 0, 1);
    const breath = Math.sin(t * Math.PI * 2 * 0.21);
    rotate("Bip01_Spine2", Z, 0.45 * breath);
    rotate("Bip01_Spine1", Z, 0.25 * breath);
    rotate("Bip01_Pelvis", Y, 0.6 * Math.sin(t * 0.33));
    rotate("Bip01_Neck", Z, -0.3 * breath);
    const head = p.bones["Bip01_Head"];
    if (head) {
      head.quaternion
        .copy(p.rest["Bip01_Head"])
        .multiply(new THREE.Quaternion().setFromAxisAngle(Y, THREE.MathUtils.degToRad(1.4 * Math.sin(t * 0.41) + 0.6 * Math.sin(t * 1.3))))
        .multiply(new THREE.Quaternion().setFromAxisAngle(Z, THREE.MathUtils.degToRad(0.7 * Math.sin(t * 0.29 + 1))))
        .multiply(new THREE.Quaternion().setFromAxisAngle(X, THREE.MathUtils.degToRad(0.5 * Math.sin(t * 0.23 + 2))));
    }
  }

  private render() {
    if (this.disposed) return;
    this.frame();
    this.renderer.render(this.scene, this.camera);
  }

  private loop() {
    if (this.disposed) return;
    const run = this.visible && !!this.person && document.visibilityState !== "hidden";
    this.renderer.setAnimationLoop(
      run
        ? () => {
            const dt = Math.min(0.05, this.clock.getDelta());
            if (!this.dragging && Math.abs(this.spin) > 1e-5) {
              this.yaw += this.spin * dt * 1000;
              this.spin *= Math.pow(0.002, dt);
            }
            this.turntable.rotation.y = this.yaw;
            this.zoomShown += (this.zoom - this.zoomShown) * (1 - Math.pow(0.002, dt));
            if (this.idle) this.pose(this.clock.elapsedTime);
            this.render();
          }
        : null,
    );
  }
}
