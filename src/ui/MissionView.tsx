import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { earthAt, marsAt, vehicleAt, transferAnomaly, transferPoint, R_EARTH, R_MARS, TRANSIT_DAYS } from '../engine/orbit';
function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/**
 * Mission view (three.js). Sun, Earth, Mars, the transfer path, the ship, and the signal path to Earth.
 * - During a solar event, a CME shell grows from the Sun, and protons stream to the ship.
 *   The protons follow the Parker spiral: the Sun's magnetic field turns as the Sun rotates,
 *   so the particles curve on their way out, as real solar protons do.
 * - In the shelter, a shield shows around the ship.
 * The scene renders only when something changes, or while particles move or the user turns the view.
 */
export interface MissionViewProps { day: number; storm: 'none' | 'watch' | 'hit'; shelter: boolean; theme: string }

const P_COUNT = 900;
const STAR_COUNT = 1200;
/** Parker spiral turn, in radians per AU: the Sun's spin rate times 1 AU, over a 400 km/s solar wind. */
const SPIRAL = 1.0;

/** A soft round glow, drawn once on a small canvas. Points and sprites use it so they look like light, not squares. */
function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

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

export default function MissionView({ day, storm, shelter, theme }: MissionViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const api = useRef<{ update: (p: MissionViewProps) => void; dispose: () => void } | null>(null);

  useEffect(() => {
    const el = host.current!;
    const glow = glowTexture();
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
    camera.position.set(0, 2.6, 2.0);
    camera.lookAt(0, 0, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = !reduce;
    controls.dampingFactor = 0.08;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = 1.25;
    controls.update();

    let props: MissionViewProps = { day, storm, shelter, theme };

    // ---- materials (theme aware) ----
    const mat = {
      orbit: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55 }),
      pathDone: new THREE.LineBasicMaterial(),
      pathNext: new THREE.LineDashedMaterial({ dashSize: 0.035, gapSize: 0.03 }),
      link: new THREE.LineDashedMaterial({ dashSize: 0.02, gapSize: 0.02 }),
      sun: new THREE.MeshBasicMaterial({ color: 0xffd27a }),
      halo: new THREE.SpriteMaterial({ map: glow, color: 0xffb347, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }),
      earth: new THREE.MeshStandardMaterial({ color: 0x7fb2dc, roughness: 0.7, emissive: 0x0b1e38 }),
      mars: new THREE.MeshStandardMaterial({ color: 0xc58a6a, roughness: 0.9, emissive: 0x1e0d08 }),
      ship: new THREE.MeshStandardMaterial({ color: 0xdde4ec, metalness: 0.4, roughness: 0.4, emissive: 0x30363e }),
      panel: new THREE.MeshStandardMaterial({ color: 0x2a4f8a, metalness: 0.6, roughness: 0.3, emissive: 0x0c1830 }),
      shield: new THREE.MeshBasicMaterial({ color: 0x8fb4ff, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      cme: new THREE.MeshBasicMaterial({ color: 0xffc35a, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide }),
      stars: new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, color: 0xc8d4e6, transparent: true, opacity: 0.8, depthWrite: false }),
      particles: new THREE.PointsMaterial({ map: glow, size: 0.035, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending }),
    };
    function applyTheme() {
      // The scene is always space, so it keeps dark-sky colors in both themes.
      const text = new THREE.Color(0xdde4ec);
      const line = new THREE.Color(0x3c4655);
      const muted = new THREE.Color(0x8794a6);
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

    // Background stars on a far sphere. They do not move, so they cost nothing after the first frame.
    const starPos = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = 18;
      starPos.set([r * Math.sqrt(1 - u * u) * Math.cos(a), r * u, r * Math.sqrt(1 - u * u) * Math.sin(a)], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, mat.stars));

    // The Sun lights the planets and the ship, so each one has a day side and a night side.
    scene.add(new THREE.PointLight(0xfff1d6, 3, 0, 0), new THREE.AmbientLight(0x404858, 0.6));

    const sun = new THREE.Mesh(new THREE.SphereGeometry(0.07, 32, 16), mat.sun);
    const halo = new THREE.Sprite(mat.halo);
    halo.scale.setScalar(0.5);
    const earth = new THREE.Mesh(new THREE.SphereGeometry(0.035, 32, 16), mat.earth);
    const mars = new THREE.Mesh(new THREE.SphereGeometry(0.03, 32, 16), mat.mars);
    // The ship: a crew module with 2 solar wings, and a shield that shows in the shelter.
    const ship = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.036, 16), mat.ship);
    hull.rotation.z = Math.PI / 2;
    const wings = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.001, 0.07), mat.panel);
    const shield = new THREE.Mesh(new THREE.SphereGeometry(0.04, 32, 16), mat.shield);
    ship.add(hull, wings, shield);
    const cme = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat.cme);
    scene.add(sun, halo, earth, mars, ship, cme);

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

    /** Particles move out along spiral field lines. The bundle is narrow at a Warning, when the ship is on a connected line. */
    function layoutParticles(t: number) {
      const spread = props.storm === 'hit' ? 0.35 : 0.9;
      const reach = Math.max(shipR * 1.2, 0.6);
      for (let i = 0; i < P_COUNT; i++) {
        const phase = (seed[i * 3] + t) % 1;
        const r = 0.08 + phase * reach;
        const a = shipAngle + seed[i * 3 + 1] * spread + SPIRAL * (shipR - r);
        pos[i * 3] = r * Math.cos(a);
        pos[i * 3 + 1] = seed[i * 3 + 2] * 0.06 * r;
        pos[i * 3 + 2] = -r * Math.sin(a);
      }
      pGeo.attributes.position.needsUpdate = true;
    }

    /** The CME: a thin shell that grows from the Sun past the ship, then starts again. */
    function layoutCme(t: number) {
      const f = t % 1;
      cme.scale.setScalar(0.1 + f * shipR * 1.3);
      mat.cme.opacity = 0.14 * (1 - f);
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
      // Keep the ship in frame: the view centers between the Sun and the ship, so the ship moves across the screen.
      const shift = v3(v).multiplyScalar(0.55).sub(controls.target);
      controls.target.add(shift);
      camera.position.add(shift);
      controls.update();
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
      cme.visible = props.storm === 'watch';
      shield.visible = props.shelter;
      ship.lookAt(sun.position);
      mat.particles.opacity = props.storm === 'hit' ? 0.95 : 0.6;
      layoutParticles(0.35);
      layoutCme(0.5);
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
      if (moving) {
        const s = (performance.now() - t0) / 1000;
        layoutParticles(s * (props.storm === 'hit' ? 0.22 : 0.1));
        layoutCme(s * 0.12);
        halo.scale.setScalar(0.5 + 0.04 * Math.sin(s * 3));
      }
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
        glow.dispose();
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
    const id = requestAnimationFrame(() => api.current?.update({ day, storm, shelter, theme }));
    return () => cancelAnimationFrame(id);
  }, [day, storm, shelter, theme]);

  return (
    <div className="mv" ref={host}>
      <div className="mv-labels" ref={labels} aria-hidden="true" />
    </div>
  );
}
