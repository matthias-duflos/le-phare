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
      el.style.cssText = "position:absolute;width:9px;height:9px;margin:-4.5px 0 0 -4.5px;";
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
      }

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
