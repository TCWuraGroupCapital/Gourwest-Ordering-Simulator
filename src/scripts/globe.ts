/**
 * The hero globe — the logo's emblem made interactive. Gold land dots on a cream sphere, the
 * forest-green "G" orbit, and a pin on each real kitchen. Dragging spins it; choosing a kitchen
 * turns it to face you and sets your pickup store. Pure presentation: store state lives in state.ts.
 */
import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import LAND from '../data/land-points.json';

const DEG = Math.PI / 180;

const PALETTE = {
  light: { sphere: '#EEE6D2', land: '#B48E45', ring: '#173E32', pin: '#173E32', halo: '#C96D4B' },
  dark: { sphere: '#1F3A31', land: '#D1AE69', ring: '#8FC2AE', pin: '#F1E7CF', halo: '#E89A78' },
};

export function latLonToVec(lat: number, lon: number, r = 1): Vector3 {
  const phi = (90 - lat) * DEG;
  const theta = (lon + 180) * DEG;
  return new Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

/** Euler angles (XYZ) that bring a lat/lon to face a camera on +Z. */
const facing = (lat: number, lon: number) => ({ x: lat * DEG, y: -(lon + 90) * DEG });

const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};

export interface GlobePin {
  id: string;
  lat: number;
  lon: number;
}

export interface GlobeHandle {
  focus(pinId: string): void;
  destroy(): void;
}

export function mountGlobe(
  host: HTMLElement,
  places: GlobePin[],
  options: { initialPinId: string; onSelect(pinId: string): void },
): GlobeHandle | null {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (!gl) return null;

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new WebGLRenderer({ canvas, context: gl as WebGLRenderingContext, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  canvas.className = 'globe__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 0, 4.6);

  const world = new Group();
  scene.add(world);

  const sphereMat = new MeshBasicMaterial();
  world.add(new Mesh(new SphereGeometry(0.995, 64, 48), sphereMat));

  // Land: one instanced disc per sampled land point, oriented along the surface normal.
  const landMat = new MeshBasicMaterial();
  const count = LAND.length / 2;
  const land = new InstancedMesh(new CircleGeometry(0.0125, 6), landMat, count);
  const dummy = new Object3D();
  for (let i = 0; i < count; i++) {
    const p = latLonToVec(LAND[i * 2], LAND[i * 2 + 1], 1.001);
    dummy.position.copy(p);
    dummy.lookAt(p.clone().multiplyScalar(2));
    dummy.updateMatrix();
    land.setMatrixAt(i, dummy.matrix);
  }
  world.add(land);

  // A hairline rim just outside the silhouette (a unit sphere seen from z = 4.6 projects to r ≈ 1.024 at z = 0).
  const rimMat = new MeshBasicMaterial({ transparent: true, opacity: 0.35 });
  scene.add(new Mesh(new RingGeometry(1.022, 1.03, 128), rimMat));

  // The "G": an open orbit ring that stays fixed in view while the earth turns inside it.
  const ringMat = new MeshBasicMaterial();
  const ring = new Mesh(new TorusGeometry(1.24, 0.022, 12, 160, Math.PI * 1.62), ringMat);
  ring.rotation.set(0.32, -0.18, 0.95);
  scene.add(ring);

  // Pins: a raised dot plus a pulsing halo per kitchen.
  const pinMat = new MeshBasicMaterial();
  const haloMat = new MeshBasicMaterial({ transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false });
  const pins = places.map((place) => {
    const pos = latLonToVec(place.lat, place.lon, 1.012);
    const dot = new Mesh(new CircleGeometry(0.024, 20), pinMat);
    dot.position.copy(pos);
    dot.lookAt(pos.clone().multiplyScalar(2));
    const halo = new Mesh(new RingGeometry(0.03, 0.042, 32), haloMat.clone());
    halo.position.copy(pos);
    halo.lookAt(pos.clone().multiplyScalar(2));
    world.add(dot, halo);
    return { place, pos, halo };
  });

  function applyTheme() {
    const p = isDark() ? PALETTE.dark : PALETTE.light;
    sphereMat.color = new Color(p.sphere);
    landMat.color = new Color(p.land);
    ringMat.color = new Color(p.ring);
    rimMat.color = new Color(p.ring);
    pinMat.color = new Color(p.pin);
    pins.forEach(({ halo }) => ((halo.material as MeshBasicMaterial).color = new Color(p.halo)));
    needsRender = true;
  }

  // HTML labels: real buttons, positioned over their pins every frame.
  const labels = new Map<string, HTMLButtonElement>();
  host.querySelectorAll<HTMLButtonElement>('[data-globe-pin]').forEach((btn) => labels.set(btn.dataset.globePin!, btn));

  const start = places.find((p) => p.id === options.initialPinId) ?? places[0];
  const target = facing(start.lat, start.lon);
  world.rotation.set(target.x, target.y, 0);

  let width = 0;
  let height = 0;
  let needsRender = true;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let idleSince = performance.now();
  let animating = false;
  let visible = true;
  let frame = 0;

  function resize() {
    width = host.clientWidth;
    height = host.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    needsRender = true;
  }

  const world3 = new Vector3();
  const toCam = new Vector3();
  function placeLabels() {
    for (const { place, pos } of pins) {
      const label = labels.get(place.id);
      if (!label) continue;
      world3.copy(pos).applyEuler(world.rotation);
      toCam.copy(camera.position).sub(world3).normalize();
      const front = world3.clone().normalize().dot(toCam);
      const screen = world3.clone().project(camera);
      const x = (screen.x * 0.5 + 0.5) * width;
      const y = (-screen.y * 0.5 + 0.5) * height;
      label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      // Flip a label to the other side of its pin rather than let it run off the globe's box.
      const room = label.offsetWidth + 18;
      const preferred = label.dataset.prefer ?? (label.dataset.prefer = label.dataset.side ?? 'right');
      label.dataset.side = preferred === 'left' ? (x - room < 0 ? 'right' : 'left') : x + room > width ? 'left' : 'right';
      const shown = front > 0.18;
      label.dataset.hidden = String(!shown);
      label.tabIndex = shown ? 0 : -1;
    }
  }

  function tick(now: number) {
    frame = requestAnimationFrame(tick);
    if (!visible) return;
    const idle = !dragging && now - idleSince > 2400;
    if (animating) {
      world.rotation.x += (target.x - world.rotation.x) * 0.08;
      world.rotation.y += (target.y - world.rotation.y) * 0.08;
      if (Math.abs(target.x - world.rotation.x) + Math.abs(target.y - world.rotation.y) < 0.0015) animating = false;
      needsRender = true;
    } else if (idle && !reduceMotion) {
      world.rotation.y += 0.0012;
      needsRender = true;
    }
    if (!reduceMotion) {
      const pulse = (now % 2200) / 2200;
      for (const { halo } of pins) {
        halo.scale.setScalar(1 + pulse * 1.6);
        (halo.material as MeshBasicMaterial).opacity = 0.6 * (1 - pulse);
      }
      needsRender = true;
    }
    if (needsRender) {
      renderer.render(scene, camera);
      placeLabels();
      needsRender = false;
    }
  }

  const onDown = (e: PointerEvent) => {
    if ((e.target as Element).closest('[data-globe-pin]')) return;
    dragging = true;
    animating = false;
    lastX = e.clientX;
    lastY = e.clientY;
    host.setPointerCapture(e.pointerId);
    host.dataset.dragging = 'true';
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    world.rotation.y += (e.clientX - lastX) * 0.006;
    world.rotation.x = Math.max(-0.9, Math.min(0.9, world.rotation.x + (e.clientY - lastY) * 0.004));
    lastX = e.clientX;
    lastY = e.clientY;
    needsRender = true;
  };
  const onUp = () => {
    dragging = false;
    idleSince = performance.now();
    delete host.dataset.dragging;
  };
  host.addEventListener('pointerdown', onDown);
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerup', onUp);
  host.addEventListener('pointercancel', onUp);

  const onPin = (e: Event) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>('[data-globe-pin]');
    if (btn) options.onSelect(btn.dataset.globePin!);
  };
  host.addEventListener('click', onPin);

  const ro = new ResizeObserver(resize);
  ro.observe(host);
  const io = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
  io.observe(host);
  const themeObserver = new MutationObserver(applyTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  scheme.addEventListener('change', applyTheme);

  applyTheme();
  resize();
  frame = requestAnimationFrame(tick);
  host.dataset.ready = 'true';

  return {
    focus(pinId) {
      const place = places.find((p) => p.id === pinId);
      if (!place) return;
      const next = facing(place.lat, place.lon);
      // Take the short way round.
      const turns = Math.round((world.rotation.y - next.y) / (Math.PI * 2));
      target.x = next.x;
      target.y = next.y + turns * Math.PI * 2;
      idleSince = performance.now();
      if (reduceMotion) {
        world.rotation.set(target.x, target.y, 0);
        needsRender = true;
      } else animating = true;
    },
    destroy() {
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
      themeObserver.disconnect();
      scheme.removeEventListener('change', applyTheme);
      host.removeEventListener('click', onPin);
      renderer.dispose();
      canvas.remove();
    },
  };
}
