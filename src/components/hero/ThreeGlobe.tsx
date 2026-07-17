// The home hero globe, hand-built on three.js for total control of feel:
// NASA Black Marble night texture on a sphere, fresnel atmosphere shader,
// velocity+damping drag rotation (buttery, with inertia), auto-spin that
// yields to the user and resumes gently, and HTML chokepoint markers
// projected every frame with real occlusion. Entrance: the globe fades and
// scales in once the texture is ready.
import { useEffect, useRef } from "react";
import * as THREE from "three";

const CHOKEPOINTS: Array<{ name: string; slug: string; lat: number; lon: number }> = [
  { name: "Bab el-Mandeb", slug: "bab-el-mandeb", lat: 12.6, lon: 43.4 },
  { name: "Suez", slug: "suez", lat: 30, lon: 32.5 },
  { name: "Good Hope", slug: "good-hope", lat: -34.9, lon: 18.4 },
  { name: "Hormuz", slug: "hormuz", lat: 26.5, lon: 56.5 },
  { name: "Malacca", slug: "malacca", lat: 3, lon: 100.5 },
  { name: "Gibraltar", slug: "gibraltar", lat: 35.9, lon: -5.6 },
  { name: "Panama", slug: "panama", lat: 9.1, lon: -79.7 },
  { name: "Bosphorus", slug: "bosphorus", lat: 41.1, lon: 29.1 },
  { name: "Danish Straits", slug: "danish-straits", lat: 55.9, lon: 12.6 },
  { name: "Dover", slug: "dover", lat: 51.05, lon: 1.5 },
  { name: "Taiwan Strait", slug: "taiwan-strait", lat: 24.5, lon: 119.5 },
];

const AUTO_SPEED = 0.0011; // rad/frame-ish, one revolution ≈ 95 s
const DAMPING = 0.93;
const START_LON = 40;

// Real trade lanes, drawn on the surface as sequences of [lat, lon] waypoints
// (ports, straits and sea marks). Segments are great-circle interpolated so
// the lines hug the ocean; amber pulses travel each lane.
const PORTS: Array<[number, number]> = [
  [51.95, 3.9],    // Rotterdam
  [30.8, 122.7],   // Shanghai
  [1.25, 103.9],   // Singapore
  [33.6, -118.4],  // Los Angeles / Long Beach
  [40.4, -73.6],   // New York
  [59.6, 24.5],    // Gulf of Finland
  [45.8, 31.0],    // Odesa approaches
];
const ROUTES: Array<Array<[number, number]>> = [
  // Asia – Europe mainline via Suez
  [[30.8, 122.7], [24.5, 119.5], [7, 109], [1.25, 103.9], [3, 100.5], [6, 96.5], [5.6, 80.4], [12.3, 54.2], [12.5, 47], [12.6, 43.4], [18, 39.5], [23, 37], [30, 32.5], [34.2, 24], [37.2, 11.3], [35.9, -5.6], [36.8, -9.4], [43.6, -9.7], [48.6, -5.4], [51.05, 1.5], [51.95, 3.9]],
  // Cape of Good Hope diversion (Suez avoidance)
  [[1.25, 103.9], [-6, 92], [-16, 70], [-27, 48], [-32, 30.5], [-34.9, 18.4], [-22, 8], [-8, 2], [5, -8], [14.8, -18.2], [28.3, -14.2], [36.8, -9.4], [43.6, -9.7], [48.6, -5.4], [51.05, 1.5]],
  // Gulf crude, westbound: Hormuz → Bab el-Mandeb
  [[26.5, 56.5], [24.5, 59.5], [14.5, 55.5], [12.7, 46.5], [12.6, 43.4]],
  // Gulf crude, eastbound VLCC route: Hormuz → Malacca
  [[26.5, 56.5], [22, 61], [8, 73], [5.6, 80.4], [6, 96.5], [3, 100.5], [1.25, 103.9]],
  // Transpacific: Shanghai → Los Angeles (great circle by the Aleutians)
  [[30.8, 122.7], [34.5, 141], [42, 155], [49, 180], [50, -160], [40, -130], [33.6, -118.4]],
  // Transatlantic: Channel → New York
  [[51.05, 1.5], [49.5, -6], [48, -20], [42, -50], [40.4, -73.6]],
  // Americas lane: Los Angeles → Panama → New York
  [[33.6, -118.4], [18, -106], [10, -90], [7.5, -81.5], [9.1, -79.7], [12, -77.5], [19.8, -73.9], [25, -74], [40.4, -73.6]],
  // North Sea → Baltic via the Danish Straits
  [[51.95, 3.9], [54.5, 6.5], [57.8, 10.6], [56.8, 11.8], [55.9, 12.6], [55.2, 15], [59.6, 24.5]],
  // Black Sea grain: Odesa → Bosphorus → Mediterranean
  [[45.8, 31.0], [43, 29.5], [41.1, 29.1], [40.3, 26.3], [38.2, 25], [36.2, 22.5], [37.2, 11.3]],
];

const latLonToVec3 = (lat: number, lon: number, r: number) => {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
};

const ATMO_VERT = `
varying vec3 vNormal;
void main() {
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const ATMO_FRAG = `
varying vec3 vNormal;
void main() {
  float rim = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.5);
  gl_FragColor = vec4(0.435, 0.639, 0.780, 1.0) * rim;
}`;

export default function ThreeGlobe() {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0, 4.6);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
    wrap.appendChild(renderer.domElement);

    // globe group (rotation target)
    // with rotation.y = 0, longitude -90° faces the camera; offset accordingly
    const globe = new THREE.Group();
    globe.rotation.y = (-(START_LON + 90) * Math.PI) / 180;
    globe.rotation.x = 0.12;
    scene.add(globe);

    const geo = new THREE.SphereGeometry(1, 96, 96);
    const mat = new THREE.MeshBasicMaterial({ color: 0x9fb4cc });
    const sphere = new THREE.Mesh(geo, mat);
    globe.add(sphere);

    // atmosphere rim
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(1.045, 96, 96),
      new THREE.ShaderMaterial({
        vertexShader: ATMO_VERT,
        fragmentShader: ATMO_FRAG,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
      }),
    );
    scene.add(atmo);

    // starfield: sparse, deep, drifting very slowly the other way
    const starGeo = new THREE.BufferGeometry();
    const starCount = 650;
    const starPos = new Float32Array(starCount * 3);
    const starCol = new Float32Array(starCount * 3);
    const cSteel = new THREE.Color(0x9fb4cc);
    const cAmber = new THREE.Color(0xf2b950);
    for (let i = 0; i < starCount; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(18 + Math.random() * 22);
      starPos.set([v.x, v.y, v.z], i * 3);
      const c = Math.random() < 0.06 ? cAmber : cSteel;
      const dim = 0.35 + Math.random() * 0.65;
      starCol.set([c.r * dim, c.g * dim, c.b * dim], i * 3);
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute("color", new THREE.BufferAttribute(starCol, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({
        size: 0.055,
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      }),
    );
    scene.add(stars);

    // trade lanes + travelling pulses (inside the globe group so they rotate with it)
    const laneMat = new THREE.MeshBasicMaterial({
      color: 0xf2b950,
      transparent: true,
      opacity: 0.26,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pulseGeo = new THREE.SphereGeometry(0.011, 12, 12);
    const pulseMat = new THREE.MeshBasicMaterial({
      color: 0xf7c766,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    // great-circle interpolation between consecutive waypoints, on the surface
    const LANE_R = 1.004;
    const laneGeos: THREE.BufferGeometry[] = [];
    const pulses: Array<{ mesh: THREE.Mesh; curve: THREE.Curve<THREE.Vector3>; dur: number; phase: number }> = [];
    for (const wps of ROUTES) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < wps.length - 1; i++) {
        const a = latLonToVec3(wps[i][0], wps[i][1], 1).normalize();
        const b = latLonToVec3(wps[i + 1][0], wps[i + 1][1], 1).normalize();
        const omega = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
        const steps = Math.max(2, Math.ceil(omega / 0.05)); // ~3° per step
        for (let s = i === 0 ? 0 : 1; s <= steps; s++) {
          const t = s / steps;
          const p = a
            .clone()
            .multiplyScalar(Math.sin((1 - t) * omega))
            .add(b.clone().multiplyScalar(Math.sin(t * omega)))
            .divideScalar(Math.sin(omega) || 1)
            .multiplyScalar(LANE_R);
          pts.push(p);
        }
      }
      const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.1);
      const tubeGeo = new THREE.TubeGeometry(curve, pts.length * 2, 0.0022, 6);
      laneGeos.push(tubeGeo);
      globe.add(new THREE.Mesh(tubeGeo, laneMat));
      const len = curve.getLength();
      const nPulses = len > 2.2 ? 2 : 1; // long lanes carry two pulses
      for (let k = 0; k < nPulses; k++) {
        const pulse = new THREE.Mesh(pulseGeo, pulseMat.clone());
        globe.add(pulse);
        pulses.push({ mesh: pulse, curve, dur: 5200 + len * 6500, phase: Math.random() * 0.5 + k * 0.5 });
      }
    }

    // port dots: quiet steel points where the lanes begin and end
    const portGeo = new THREE.SphereGeometry(0.0075, 10, 10);
    const portMat = new THREE.MeshBasicMaterial({
      color: 0x9fb4cc,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });
    for (const [lat, lon] of PORTS) {
      const dot = new THREE.Mesh(portGeo, portMat);
      dot.position.copy(latLonToVec3(lat, lon, 1.004));
      globe.add(dot);
    }

    // instrument bezel: a graduated ring around the Earth, turning slowly.
    // Lives in the camera-facing plane so it frames the globe at any size.
    const bezel = new THREE.Group();
    const bezelMat = new THREE.LineBasicMaterial({
      color: 0x71869b,
      transparent: true,
      opacity: 0.3,
    });
    const ringPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 180; i++) {
      const a = (i / 180) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a) * 1.42, Math.sin(a) * 1.42, 0));
    }
    bezel.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPts), bezelMat));
    const tickPts: THREE.Vector3[] = [];
    for (let d = 0; d < 360; d += 5) {
      const a = (d * Math.PI) / 180;
      const r1 = d % 30 === 0 ? 1.35 : 1.39;
      tickPts.push(
        new THREE.Vector3(Math.cos(a) * r1, Math.sin(a) * r1, 0),
        new THREE.Vector3(Math.cos(a) * 1.42, Math.sin(a) * 1.42, 0),
      );
    }
    bezel.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tickPts), bezelMat));
    scene.add(bezel);

    // entrance state: revealed once the texture lands
    wrap.style.opacity = "0";
    wrap.style.transition = "opacity 1.1s cubic-bezier(0.16,1,0.3,1)";
    let entered = 0;

    new THREE.TextureLoader().load("/textures/earth-night.jpg", (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
      mat.map = tex;
      mat.color = new THREE.Color(0xffffff);
      mat.needsUpdate = true;
      wrap.style.opacity = "1";
      entered = performance.now();
    });

    // markers as clickable HTML overlays
    const markers = CHOKEPOINTS.map((c) => {
      const el = document.createElement("a");
      el.className = "map-marker map-marker-link";
      el.href = `/straits#${c.slug}`;
      el.setAttribute("aria-label", `${c.name} strait monitor`);
      el.style.cssText = "position:absolute;width:11px;height:11px;margin:-5.5px 0 0 -5.5px;";
      const label = document.createElement("span");
      label.className = "map-marker-label";
      label.textContent = c.name;
      el.appendChild(label);
      wrap.appendChild(el);
      return { el, base: latLonToVec3(c.lat, c.lon, 1.005) };
    });

    // layout: globe sits right of center on desktop
    let w = 0, h = 0;
    const layout = () => {
      w = wrap.clientWidth;
      h = wrap.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const desktop = w >= 1024;
      camera.setViewOffset(w, h, desktop ? -w * 0.24 : 0, desktop ? 0 : -h * 0.22, w, h);
      camera.updateProjectionMatrix();
    };
    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(wrap);

    // drag with inertia
    let dragging = false;
    let px = 0, py = 0;
    let vx = reduce ? 0 : AUTO_SPEED, vy = 0;
    let userUntil = 0;
    const canvas = renderer.domElement;
    canvas.style.cursor = "grab";
    canvas.style.touchAction = "pan-y";
    canvas.style.pointerEvents = "auto";

    const down = (e: PointerEvent) => {
      dragging = true;
      px = e.clientX;
      py = e.clientY;
      canvas.style.cursor = "grabbing";
      canvas.setPointerCapture(e.pointerId);
      userUntil = performance.now() + 2200;
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - px;
      const dy = e.clientY - py;
      px = e.clientX;
      py = e.clientY;
      vx = dx * 0.0035;
      vy = dy * 0.0022;
      globe.rotation.y += vx;
      globe.rotation.x += vy;
      userUntil = performance.now() + 2200;
    };
    const up = () => {
      dragging = false;
      canvas.style.cursor = "grab";
    };
    canvas.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);

    const readout = document.getElementById("globe-readout");
    let lastReadout = 0;

    const camDir = new THREE.Vector3(0, 0, 1);
    const tmp = new THREE.Vector3();

    let raf = 0;
    let running = false;
    const frame = (now: number) => {
      // physics
      if (!dragging) {
        globe.rotation.y += vx;
        globe.rotation.x += vy;
        vx *= DAMPING;
        vy *= DAMPING;
        const idle = now >= userUntil;
        if (!reduce && idle) {
          // ease auto-spin back in
          vx += (AUTO_SPEED - vx) * 0.02;
          vy += (0 - vy) * 0.04;
          globe.rotation.x += (0.12 - globe.rotation.x) * 0.01;
        }
      }
      globe.rotation.x = Math.max(Math.min(globe.rotation.x, 0.9), -0.9);

      // entrance scale
      if (entered) {
        const p = Math.min((now - entered) / 1400, 1);
        const s = 0.92 + 0.08 * (1 - Math.pow(1 - p, 3));
        globe.scale.setScalar(s);
        atmo.scale.setScalar(s);
        bezel.scale.setScalar(s);
      }
      if (!reduce) bezel.rotation.z -= 0.00035;

      // arcs pulse; stars drift opposite the spin
      for (const p of pulses) {
        const t = ((now / p.dur + p.phase) % 1 + 1) % 1;
        p.mesh.position.copy(p.curve.getPoint(t));
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95 * Math.sin(t * Math.PI);
      }
      if (!reduce) stars.rotation.y += 0.00006;

      renderer.render(scene, camera);

      // project markers
      for (const m of markers) {
        tmp.copy(m.base).applyEuler(globe.rotation).multiplyScalar(globe.scale.x);
        const facing = tmp.clone().normalize().dot(camDir);
        const sp = tmp.project(camera);
        const x = ((sp.x + 1) / 2) * w;
        const y = ((1 - sp.y) / 2) * h;
        const visible = facing > 0.18;
        m.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        m.el.style.opacity = visible ? String(Math.min((facing - 0.18) / 0.3, 1)) : "0";
        m.el.style.pointerEvents = visible ? "auto" : "none";
      }

      if (readout && now - lastReadout > 180) {
        lastReadout = now;
        const lon = ((((-globe.rotation.y * 180) / Math.PI - 90) % 360) + 540) % 360 - 180;
        const manual = dragging || now < userUntil;
        readout.textContent = `CAM ${Math.abs(lon).toFixed(1).padStart(5, "0")}°${lon >= 0 ? "E" : "W"} · ROT ${manual ? "MANUAL" : "AUTO"} · VIIRS NIGHT`;
      }

      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (!running) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop()), {
      threshold: 0.05,
    });
    io.observe(wrap);

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      canvas.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      markers.forEach((m) => m.el.remove());
      renderer.dispose();
      geo.dispose();
      mat.map?.dispose();
      mat.dispose();
      starGeo.dispose();
      (stars.material as THREE.Material).dispose();
      bezelMat.dispose();
      bezel.children.forEach((c) => (c as THREE.Line).geometry.dispose());
      laneMat.dispose();
      laneGeos.forEach((g) => g.dispose());
      pulseGeo.dispose();
      pulseMat.dispose();
      pulses.forEach((p) => (p.mesh.material as THREE.Material).dispose());
      portGeo.dispose();
      portMat.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 overflow-hidden"
      style={{
        maskImage:
          "linear-gradient(to bottom, transparent 0%, black 9%, black 90%, transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent 0%, black 9%, black 90%, transparent 100%)",
      }}
    />
  );
}
