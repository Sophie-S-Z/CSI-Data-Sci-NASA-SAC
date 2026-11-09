import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { earthAt, marsAt, vehicleAt, transferAnomaly, transferPoint, R_EARTH, R_MARS, TRANSIT_DAYS } from '../engine/orbit';
function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/**
 * Mission view (three.js). Sun, Earth, Mars, the transfer path, the vehicle, and the signal path to Earth.
 * During a solar particle event, protons stream from the Sun toward the vehicle.
 * The scene renders only when something changes, or while particles move or the user turns the view.
 */
export interface MissionViewProps { day: number; storm: 'none' | 'watch' | 'hit'; theme: string }

const P_COUNT = 420;

/** Read a CSS color token. The tokens use OKLCH, which THREE.Color cannot parse, so the browser paints one pixel and we read it back. */
let probe: CanvasRenderingContext2D | null = null;
function cssColor(name: string, fallback: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  try {
    probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!probe) return new THREE.Color(fallback);
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = fallback;
    probe.fillStyle = v;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
    return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  } catch { return new THREE.Color(fallback); }
}

/** Map the orbit plane (x, y) to three.js (x, -z). */
const v3 = (p: { x: number; y: number }, h = 0) => new THREE.Vector3(p.x, h, -p.y);

export default function MissionView({ day, storm, theme }: MissionViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const api = useRef<{ update: (p: MissionViewProps) => void; dispose: () => void } | null>(null);

  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      el.dataset.nowebgl = 'true';
      return;
    }
    const reduce = prefersReducedMotion();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 50);
    camera.position.set(0.15, 3.1, 2.4);
    camera.lookAt(0.2, 0, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0.2, 0, 0);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = !reduce;
    controls.dampingFactor = 0.08;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = 1.25;
    controls.update();

    let props: MissionViewProps = { day, storm, theme };

    // ---- materials (theme aware) ----
    const mat = {
      orbit: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55 }),
      pathDone: new THREE.LineBasicMaterial(),
      pathNext: new THREE.LineDashedMaterial({ dashSize: 0.035, gapSize: 0.03 }),
      link: new THREE.LineDashedMaterial({ dashSize: 0.02, gapSize: 0.02 }),
      sun: new THREE.MeshBasicMaterial({ color: 0xffc35a }),
      halo: new THREE.MeshBasicMaterial({ color: 0xffc35a, transparent: true, opacity: 0.12, depthWrite: false }),
      earth: new THREE.MeshBasicMaterial({ color: 0x5aa7e8 }),
      mars: new THREE.MeshBasicMaterial({ color: 0xd2774a }),
      ship: new THREE.MeshBasicMaterial(),
      particles: new THREE.PointsMaterial({ size: 0.018, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true }),
    };
    function applyTheme() {
      const text = cssColor('--foreground', '#e4eaf2');
      const line = cssColor('--chart-3', '#34445a');
      const muted = cssColor('--muted-foreground', '#a3b1c4');
      mat.orbit.color = line;
      mat.pathDone.color = text;
      mat.pathNext.color = muted;
      mat.link.color = text;
      mat.ship.color = text;
      // The stream takes the alert color: red during a Warning, yellow during a Caution.
      mat.particles.color = cssColor(props.storm === 'hit' ? '--warning' : '--caution', '#f5c842');
    }
    applyTheme();

    const circle = (r: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 160; i++) { const a = (i / 160) * Math.PI * 2; pts.push(new THREE.Vector3(r * Math.cos(a), 0, -r * Math.sin(a))); }
      return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat.orbit);
    };
    scene.add(circle(R_EARTH), circle(R_MARS));

    const sun = new THREE.Mesh(new THREE.SphereGeometry(0.075, 32, 16), mat.sun);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.16, 32, 16), mat.halo);
    const earth = new THREE.Mesh(new THREE.SphereGeometry(0.035, 24, 12), mat.earth);
    const mars = new THREE.Mesh(new THREE.SphereGeometry(0.03, 24, 12), mat.mars);
    const ship = new THREE.Mesh(new THREE.OctahedronGeometry(0.028), mat.ship);
    scene.add(sun, halo, earth, mars, ship);

    const pathDone = new THREE.Line(new THREE.BufferGeometry(), mat.pathDone);
    const pathNext = new THREE.Line(new THREE.BufferGeometry(), mat.pathNext);
    const link = new THREE.Line(new THREE.BufferGeometry(), mat.link);
    scene.add(pathDone, pathNext, link);

    // ---- proton stream ----
    const pos = new Float32Array(P_COUNT * 3);
    const seed = new Float32Array(P_COUNT * 3); // phase, angle offset, height offset
    for (let i = 0; i < P_COUNT; i++) { seed[i * 3] = Math.random(); seed[i * 3 + 1] = (Math.random() - 0.5); seed[i * 3 + 2] = (Math.random() - 0.5); }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const particles = new THREE.Points(pGeo, mat.particles);
    particles.visible = false;
    scene.add(particles);

    let shipAngle = 0;
    let shipR = 1;

    function layoutParticles(t: number) {
      const spread = props.storm === 'hit' ? 0.42 : 0.6;
      const reach = Math.max(shipR * 1.15, 0.6);
      for (let i = 0; i < P_COUNT; i++) {
        const phase = (seed[i * 3] + t) % 1;
        const r = 0.08 + phase * reach;
        const a = shipAngle + seed[i * 3 + 1] * spread;
        pos[i * 3] = r * Math.cos(a);
        pos[i * 3 + 1] = seed[i * 3 + 2] * 0.05;
        pos[i * 3 + 2] = -r * Math.sin(a);
      }
      pGeo.attributes.position.needsUpdate = true;
    }

    function setLine(line: THREE.Line, pts: THREE.Vector3[], dashed = false) {
      line.geometry.dispose();
      line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      if (dashed) line.computeLineDistances();
    }

    function place() {
      const d = props.day;
      const e = earthAt(d), m = marsAt(d), v = vehicleAt(d);
      earth.position.copy(v3(e));
      mars.position.copy(v3(m));
      ship.position.copy(v3(v));
      shipAngle = Math.atan2(v.y, v.x);
      shipR = Math.hypot(v.x, v.y);
      const nuNow = transferAnomaly(Math.min(d / TRANSIT_DAYS, 1));
      const done: THREE.Vector3[] = [], next: THREE.Vector3[] = [];
      for (let i = 0; i <= 90; i++) {
        const nu = (i / 90) * Math.PI;
        (nu <= nuNow ? done : next).push(v3(transferPoint(nu)));
      }
      next.unshift(v3(v));
      done.push(v3(v));
      setLine(pathDone, done);
      setLine(pathNext, next, true);
      setLine(link, [v3(v), v3(e)], true);
      particles.visible = props.storm !== 'none';
      mat.particles.opacity = props.storm === 'hit' ? 0.95 : 0.55;
      layoutParticles(0.35);
    }

    // ---- labels in HTML, so they stay sharp and readable ----
    const tags = [
      { obj: sun, text: 'Sun' },
      { obj: earth, text: 'Earth' },
      { obj: mars, text: 'Mars' },
      { obj: ship, text: 'You' },
    ].map((t) => {
      const span = document.createElement('span');
      span.className = `mv-label${t.text === 'You' ? ' me' : ''}`;
      span.textContent = t.text;
      labels.current?.appendChild(span);
      return { ...t, span };
    });

    function renderOnce() {
      const w = el.clientWidth, h = el.clientHeight;
      for (const t of tags) {
        const p = t.obj.position.clone().project(camera);
        t.span.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px) translate(-50%, -150%)`;
      }
      renderer.render(scene, camera);
    }

    function resize() {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderOnce();
    }

    let raf = 0;
    let interacting = false;
    let visible = true;
    const t0 = performance.now();
    function loop() {
      raf = 0;
      const moving = !reduce && particles.visible;
      if (moving) layoutParticles(((performance.now() - t0) / 1000) * (props.storm === 'hit' ? 0.22 : 0.1));
      const damp = controls.update();
      renderOnce();
      if (visible && (moving || interacting || damp)) raf = requestAnimationFrame(loop);
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
    controls.addEventListener('start', () => { interacting = true; kick(); });
    controls.addEventListener('end', () => { interacting = false; kick(); });
    controls.addEventListener('change', kick);

    const ro = new ResizeObserver(resize);
    ro.observe(el);
    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) kick(); });
    io.observe(el);

    place();
    resize();
    kick();

    api.current = {
      update(p) {
        const themeChanged = p.theme !== props.theme || p.storm !== props.storm;
        props = p;
        if (themeChanged) applyTheme();
        place();
        kick();
      },
      dispose() {
        cancelAnimationFrame(raf);
        ro.disconnect();
        io.disconnect();
        controls.dispose();
        scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); });
        Object.values(mat).forEach((m) => m.dispose());
        renderer.dispose();
        renderer.domElement.remove();
        tags.forEach((t) => t.span.remove());
      },
    };
    return () => { api.current?.dispose(); api.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Theme tokens change after the DOM attribute flips, so wait one frame.
    const id = requestAnimationFrame(() => api.current?.update({ day, storm, theme }));
    return () => cancelAnimationFrame(id);
  }, [day, storm, theme]);

  return (
    <div className="mv" ref={host}>
      <div className="mv-labels" ref={labels} aria-hidden="true" />
    </div>
  );
}
