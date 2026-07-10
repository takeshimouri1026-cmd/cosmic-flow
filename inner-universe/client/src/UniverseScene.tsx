import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Cluster, GraphEdge, GraphNode } from "./types";
import { computeNetDegree, ringTierFor, sourceScoreFor } from "./sourceScore";

interface Props {
  clusters: Cluster[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  onSelect: (node: GraphNode | null) => void;
  selectedKey: string | null;
  /** 直近で生まれた星のkey（誕生アニメ＆カメラが一瞬向く演出のトリガー） */
  bornKey: string | null;
  /** レンズ（§13.4）: nullなら全星表示、Setありならそのkeyの星だけ浮かび上がらせる */
  lensKeys: Set<string> | null;
  /** 一覧から星を選んだ時など、任意のタイミングでカメラをその星へ向けるための要求。
   * 同じkeyを連続で送ってもnonceを変えれば毎回反応する */
  focusRequest: { key: string; nonce: number } | null;
}

interface NodeVisual {
  mesh: THREE.Mesh;
  glow: THREE.Sprite;
  label: THREE.Sprite;
  ring: THREE.Sprite;
  radius: number;
  currentPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  birthStart: number | null;
  status: string;
  /** 選択/レンズによる薄暗さ(0〜1)。点滅演出はこの上に掛け合わせる */
  focusOpacity: number;
  /** 源流らしさ(0〜1)。この星から何本の糸が出ているかで決まる */
  sourceScore: number;
  /** 輪の段階: 0=輪なし, 1=一重, 2=二重 */
  ringTier: 0 | 1 | 2;
}

interface EdgeVisual {
  edge: GraphEdge;
  line: THREE.Line;
  particle: THREE.Sprite | null;
  baseOpacity: number;
  offset: number;
  speed: number;
  birthStart: number | null;
}

// クラスタごとの中心位置を、キー一覧から均等に球面上へ配置して求める。
// 固定リストではなく動的に計算するので、ユーザーが新しいクラスタを追加しても
// 自動的に離れた場所に配置される
function computeClusterCenters(clusterKeys: string[]): Map<string, THREE.Vector3> {
  const centers = new Map<string, THREE.Vector3>();
  const sorted = [...clusterKeys].sort();
  const n = sorted.length;
  const radius = 52;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  sorted.forEach((key, i) => {
    if (n <= 1) {
      centers.set(key, new THREE.Vector3(0, 0, 0));
      return;
    }
    const phi = Math.acos(1 - (2 * (i + 0.5)) / n);
    const theta = goldenAngle * i;
    centers.set(
      key,
      new THREE.Vector3(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi)
      )
    );
  });
  return centers;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.4)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// 「源流の星」（他へ多く影響を与えている星）を囲む輪。カメラに正対するSpriteで
// 描くことで、どの角度から見ても輪っかに見える。糸が1本なら一重、2本以上なら二重
function ringTextureSingle(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.strokeStyle = "rgba(255,255,255,1)";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(128, 128, 96, 0, Math.PI * 2);
  ctx.stroke();
  return new THREE.CanvasTexture(c);
}

function ringTextureDouble(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.strokeStyle = "rgba(255,255,255,1)";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(128, 128, 100, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(128, 128, 82, 0, Math.PI * 2);
  ctx.stroke();
  return new THREE.CanvasTexture(c);
}

function ringBaseOpacity(tier: 0 | 1 | 2): number {
  return tier === 2 ? 0.85 : tier === 1 ? 0.5 : 0;
}

// 糸のkind（§2.1・§13.5）による見た目の違い。influence=現行どおり、
// example=細く・淡く、resonance=向きの表現なし（控えめに、凝った矢印などは足さない）
function edgeBaseOpacity(edge: GraphEdge): number {
  const base = edge.inferred ? 0.1 + edge.strength * 0.12 : 0.1 + edge.strength * 0.26;
  return edge.kind === "example" ? base * 0.5 : base;
}

function makeLabel(text: string, colorCss: string): THREE.Sprite {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const fontPx = 30;
  const font = `500 ${fontPx}px 'Hiragino Sans','Yu Gothic',sans-serif`;
  const c = document.createElement("canvas");
  let ctx = c.getContext("2d")!;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 28;
  const h = 46;
  c.width = w * dpr;
  c.height = h * dpr;
  ctx = c.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 8;
  ctx.fillStyle = colorCss;
  ctx.fillText(text, 14, h / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false });
  const s = new THREE.Sprite(mat);
  const k = 0.075;
  s.scale.set(w * k, h * k, 1);
  return s;
}

function makeStars(count: number, rMin: number, rMax: number): THREE.Points {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(rMin + Math.random() * (rMax - rMin));
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({
    color: 0x9fb0ff,
    size: 1.3,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.65,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  return new THREE.Points(g, m);
}

function computeLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  clusterCenters: Map<string, THREE.Vector3>
): Map<string, THREE.Vector3> {
  const positions = new Map<string, THREE.Vector3>();
  let seed = 42;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;

  nodes.forEach((n) => {
    const c = clusterCenters.get(n.cluster) ?? new THREE.Vector3();
    positions.set(n.key, c.clone().add(new THREE.Vector3(rand() * 30, rand() * 30, rand() * 30)));
  });

  const byKey = new Map(nodes.map((n) => [n.key, n]));

  for (let iter = 0; iter < 220; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = positions.get(nodes[i].key)!;
        const b = positions.get(nodes[j].key)!;
        const d = a.clone().sub(b);
        const len2 = Math.max(d.lengthSq(), 4);
        const f = d.normalize().multiplyScalar(1400 / (len2 + 40));
        a.add(f);
        b.sub(f);
      }
    }
    edges.forEach((e) => {
      const a = positions.get(e.source_key);
      const b = positions.get(e.target_key);
      if (!a || !b || !byKey.has(e.source_key) || !byKey.has(e.target_key)) return;
      const d = b.clone().sub(a);
      const len = d.length();
      const rest = 26;
      const f = d.normalize().multiplyScalar((len - rest) * 0.018 * e.strength);
      a.add(f);
      b.sub(f);
    });
    nodes.forEach((n) => {
      const c = clusterCenters.get(n.cluster);
      const p = positions.get(n.key)!;
      if (c) p.add(c.clone().sub(p).multiplyScalar(0.02));
    });
  }

  const mean = new THREE.Vector3();
  positions.forEach((p) => mean.add(p));
  if (nodes.length) mean.multiplyScalar(1 / nodes.length);
  positions.forEach((p) => p.sub(mean));
  return positions;
}

export default function UniverseScene({
  clusters,
  nodes,
  edges,
  onSelect,
  selectedKey,
  bornKey,
  lensKeys,
  focusRequest,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const graphGroupRef = useRef<THREE.Group | null>(null);
  const nodeVisuals = useRef<Map<string, NodeVisual>>(new Map());
  const edgeVisuals = useRef<Map<string, EdgeVisual>>(new Map());
  const glowTexRef = useRef<THREE.CanvasTexture | null>(null);
  const ringTexSingleRef = useRef<THREE.CanvasTexture | null>(null);
  const ringTexDoubleRef = useRef<THREE.CanvasTexture | null>(null);
  const clockRef = useRef(new THREE.Clock());
  const cameraFocusRef = useRef<{ until: number; pos: THREE.Vector3; distance?: number } | null>(null);

  // ── シーンの初期化（マウント時に1回だけ） ──
  useEffect(() => {
    const wrap = wrapRef.current!;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x05030f, 0.004);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(55, wrap.clientWidth / wrap.clientHeight, 0.1, 2000);
    camera.position.set(0, 26, 150);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);
    renderer.setClearColor(0x05030f);
    wrap.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 25;
    controls.maxDistance = 320;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.45;
    controlsRef.current = controls;

    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    controls.addEventListener("start", () => {
      controls.autoRotate = false;
      if (resumeTimer) clearTimeout(resumeTimer);
    });
    controls.addEventListener("end", () => {
      resumeTimer = setTimeout(() => {
        controls.autoRotate = true;
      }, 5000);
    });

    const glowTex = glowTexture();
    glowTexRef.current = glowTex;
    ringTexSingleRef.current = ringTextureSingle();
    ringTexDoubleRef.current = ringTextureDouble();

    scene.add(makeStars(700, 260, 620));

    const graphGroup = new THREE.Group();
    scene.add(graphGroup);
    graphGroupRef.current = graphGroup;

    // レイキャストでタップ判定
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downX = 0;
    let downY = 0;

    function pick(clientX: number, clientY: number): GraphNode | null {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const meshes = Array.from(nodeVisuals.current.values()).map((v) => v.mesh);
      const hits = raycaster.intersectObjects(meshes);
      return hits.length ? ((hits[0].object.userData.node as GraphNode) ?? null) : null;
    }

    const onPointerDown = (ev: PointerEvent) => {
      downX = ev.clientX;
      downY = ev.clientY;
    };
    const onPointerUp = (ev: PointerEvent) => {
      const moved = Math.hypot(ev.clientX - downX, ev.clientY - downY);
      if (moved > 8) return;
      const n = pick(ev.clientX, ev.clientY);
      onSelect(n);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    let raf = 0;
    const tmpV = new THREE.Vector3();
    function animate() {
      raf = requestAnimationFrame(animate);
      const t = clockRef.current.getElapsedTime();

      nodeVisuals.current.forEach((v) => {
        v.currentPos.lerp(v.targetPos, 0.04);
        let scale = 1;
        if (v.birthStart !== null) {
          const dt = t - v.birthStart;
          const p = Math.min(dt / 0.9, 1);
          scale = 0.15 + 0.85 * (1 - Math.pow(1 - p, 3));
          (v.mesh.material as THREE.MeshBasicMaterial).opacity = p;
          v.glow.material.opacity = 0.55 * p;
          v.label.material.opacity = 0.85 * p;
          v.ring.material.opacity = ringBaseOpacity(v.ringTier) * p;
          if (p >= 1) v.birthStart = null;
        } else {
          // status=inferred（AIの提案・未確定）の星は点滅させ、確認待ちであることを示す
          const blink = v.status === "inferred" ? 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 3.4)) : 1;
          (v.mesh.material as THREE.MeshBasicMaterial).opacity = v.focusOpacity * blink;
          v.glow.material.opacity = 0.55 * v.focusOpacity * blink;
          v.label.material.opacity = 0.85 * v.focusOpacity * blink;
          v.ring.material.opacity = ringBaseOpacity(v.ringTier) * v.focusOpacity * blink;
        }
        v.mesh.position.copy(v.currentPos);
        const breathe = 1 + 0.07 * Math.sin(t * 1.4 + v.glow.userData.phase);
        const s = v.glow.userData.baseScale * breathe;
        v.glow.scale.set(s * scale, s * scale, 1);
        v.mesh.scale.setScalar(scale * (v.mesh.userData.focusScale ?? 1));
        v.glow.position.copy(v.currentPos);
        v.ring.position.copy(v.currentPos);
        v.label.position.copy(v.currentPos).add(new THREE.Vector3(0, v.radius + 2.4, 0));
      });

      edgeVisuals.current.forEach((ev) => {
        const a = nodeVisuals.current.get(ev.edge.source_key);
        const b = nodeVisuals.current.get(ev.edge.target_key);
        if (!a || !b) return;
        let endPos = b.currentPos;
        let opacityMul = 1;
        if (ev.birthStart !== null) {
          const dt = t - ev.birthStart;
          const p = Math.min(dt / 0.7, 1);
          endPos = a.currentPos.clone().lerp(b.currentPos, p);
          opacityMul = p;
          if (p >= 1) ev.birthStart = null;
        }
        const posAttr = ev.line.geometry.getAttribute("position") as THREE.BufferAttribute;
        posAttr.setXYZ(0, a.currentPos.x, a.currentPos.y, a.currentPos.z);
        posAttr.setXYZ(1, endPos.x, endPos.y, endPos.z);
        posAttr.needsUpdate = true;
        // status=inferred（確認待ちの提案）の糸は点滅させる。ノードの点滅と周期を揃える
        const blink = ev.edge.inferred ? 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 3.4)) : 1;
        (ev.line.material as THREE.LineBasicMaterial).opacity = ev.baseOpacity * opacityMul * blink;

        if (ev.particle) {
          const p = (t * ev.speed + ev.offset) % 1;
          tmpV.lerpVectors(a.currentPos, b.currentPos, p);
          ev.particle.position.copy(tmpV);
          ev.particle.material.opacity = 0.8 * opacityMul * blink;
        }
      });

      if (cameraFocusRef.current) {
        const focus = cameraFocusRef.current;
        controls.target.lerp(focus.pos, 0.05);
        if (focus.distance !== undefined) {
          const dir = camera.position.clone().sub(controls.target);
          const curDist = dir.length();
          const nextDist = THREE.MathUtils.lerp(curDist, focus.distance, 0.05);
          dir.setLength(Math.max(nextDist, 1));
          camera.position.copy(controls.target).add(dir);
        }
        if (t > focus.until) cameraFocusRef.current = null;
      }

      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    const onResize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      renderer.dispose();
      wrap.removeChild(renderer.domElement);
      // StrictModeの二重マウントで次のマウント時に再構築させるため、古いシーンを指したままの参照を捨てる
      nodeVisuals.current.clear();
      edgeVisuals.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── グラフデータが変わるたびに、メッシュを diff して同期する ──
  useEffect(() => {
    const graphGroup = graphGroupRef.current;
    const glowTex = glowTexRef.current;
    if (!graphGroup || !glowTex) return;

    const clusterMap = new Map(clusters.map((c) => [c.key, c]));
    const clusterCenters = computeClusterCenters(clusters.map((c) => c.key));
    const positions = computeLayout(nodes, edges, clusterCenters);
    const currentKeys = new Set(nodes.map((n) => n.key));
    const ringTexSingle = ringTexSingleRef.current!;
    const ringTexDouble = ringTexDoubleRef.current!;

    // 源流らしさ = 出ている糸 − 入ってくる糸（他からも多く影響を受けている星は
    // 出ている糸が多少あっても「源流」ではなく「サブ」寄りに扱う）
    const netDegree = computeNetDegree(edges);
    const sourceScoreOf = (key: string) => sourceScoreFor(netDegree, key);
    const ringTierOf = (key: string) => ringTierFor(netDegree, key);
    const colorFor = (baseColor: THREE.Color, sourceScore: number) =>
      baseColor.clone().lerp(new THREE.Color("#ffffff"), 0.45 - 0.32 * sourceScore);

    // 消えたノードを削除
    nodeVisuals.current.forEach((v, key) => {
      if (!currentKeys.has(key)) {
        graphGroup.remove(v.mesh, v.glow, v.label, v.ring);
        v.mesh.geometry.dispose();
        (v.mesh.material as THREE.Material).dispose();
        nodeVisuals.current.delete(key);
      }
    });

    nodes.forEach((n) => {
      const target = positions.get(n.key)!;
      const color = new THREE.Color(clusterMap.get(n.cluster)?.color ?? "#a78bfa");
      const radius = 1.5 + n.size * 0.32;
      const sourceScore = sourceScoreOf(n.key);
      const ringTier = ringTierOf(n.key);
      const existing = nodeVisuals.current.get(n.key);

      if (existing) {
        existing.targetPos.copy(target);
        existing.radius = radius;
        existing.status = n.status;
        existing.sourceScore = sourceScore;
        existing.ringTier = ringTier;
        (existing.mesh.material as THREE.MeshBasicMaterial).color = colorFor(color, sourceScore);
        (existing.ring.material as THREE.SpriteMaterial).map = ringTier === 2 ? ringTexDouble : ringTexSingle;
        existing.ring.material.needsUpdate = true;
        const rs = radius * 4.0;
        existing.ring.scale.set(rs, rs, 1);
        return;
      }

      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 24, 24),
        new THREE.MeshBasicMaterial({
          color: colorFor(color, sourceScore),
          transparent: true,
          opacity: 1,
        })
      );
      mesh.userData.node = n;
      mesh.position.copy(target);

      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex,
          color,
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      const gs = radius * 5.2;
      glow.scale.set(gs, gs, 1);
      glow.userData.baseScale = gs;
      glow.userData.phase = Math.random() * Math.PI * 2;
      glow.position.copy(target);

      // 源流の星ほど輪が付く（糸1本なら一重、2本以上なら二重）。星本体のすぐ外側に
      // 小さめに出し、星同士が近くても見た目がうるさくならないようにする
      const ring = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: ringTier === 2 ? ringTexDouble : ringTexSingle,
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        })
      );
      const rs = radius * 4.0;
      ring.scale.set(rs, rs, 1);
      ring.position.copy(target);

      const label = makeLabel(n.label.length > 12 ? n.label.slice(0, 12) + "…" : n.label, "#ded7f2");
      label.position.copy(target).add(new THREE.Vector3(0, radius + 2.4, 0));

      graphGroup.add(mesh, glow, label, ring);

      nodeVisuals.current.set(n.key, {
        mesh,
        glow,
        label,
        ring,
        radius,
        currentPos: target.clone(),
        targetPos: target.clone(),
        birthStart: n.key === bornKey ? clockRef.current.getElapsedTime() : null,
        status: n.status,
        focusOpacity: 1,
        sourceScore,
        ringTier,
      });
    });

    // 既存ノードもクラスタ変更等でtargetPosが動くので全体を更新
    nodeVisuals.current.forEach((v, key) => {
      const t = positions.get(key);
      if (t) v.targetPos.copy(t);
    });

    const currentEdgeIds = new Set(edges.map((e) => `${e.source_key}->${e.target_key}`));
    edgeVisuals.current.forEach((ev, id) => {
      if (!currentEdgeIds.has(id)) {
        graphGroup.remove(ev.line);
        if (ev.particle) graphGroup.remove(ev.particle);
        ev.line.geometry.dispose();
        (ev.line.material as THREE.Material).dispose();
        edgeVisuals.current.delete(id);
      }
    });

    edges.forEach((e) => {
      const id = `${e.source_key}->${e.target_key}`;
      if (edgeVisuals.current.has(id)) return;
      const a = positions.get(e.source_key);
      const b = positions.get(e.target_key);
      if (!a || !b) return;
      const sourceNode = nodes.find((n) => n.key === e.source_key);
      const targetNode = nodes.find((n) => n.key === e.target_key);
      const ca = new THREE.Color(clusterMap.get(sourceNode?.cluster ?? "")?.color ?? "#a78bfa");
      const cb = new THREE.Color(clusterMap.get(targetNode?.cluster ?? "")?.color ?? "#a78bfa");
      const color = e.inferred ? new THREE.Color("#e8e4ff") : ca.clone().lerp(cb, 0.5);
      const baseOpacity = edgeBaseOpacity(e);

      const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
      const mat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: baseOpacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      graphGroup.add(line);

      // resonanceは向きに意味がないため、向きを示す流れの粒子は出さない（§2.1・§13.5）
      const particle =
        e.kind === "resonance"
          ? null
          : new THREE.Sprite(
              new THREE.SpriteMaterial({
                map: glowTex,
                color,
                transparent: true,
                opacity: 0.8,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
              })
            );
      if (particle) {
        particle.scale.set(2.2, 2.2, 1);
        graphGroup.add(particle);
      }

      const isNewBirth = e.source_key === bornKey || e.target_key === bornKey;
      edgeVisuals.current.set(id, {
        edge: e,
        line,
        particle,
        baseOpacity,
        offset: Math.random(),
        speed: 0.05 + e.strength * 0.09,
        birthStart: isNewBirth ? clockRef.current.getElapsedTime() : null,
      });
    });

    if (bornKey) {
      const target = positions.get(bornKey);
      if (target) {
        cameraFocusRef.current = { until: clockRef.current.getElapsedTime() + 2.2, pos: target.clone() };
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusters, nodes, edges, bornKey]);

  // ── 選択状態の反映（フォーカス表示） ──
  useEffect(() => {
    const selected = selectedKey ? nodes.find((n) => n.key === selectedKey) ?? null : null;
    const connected = new Set<string>();
    if (selected) {
      connected.add(selected.key);
      edges.forEach((e) => {
        if (e.source_key === selected.key) connected.add(e.target_key);
        if (e.target_key === selected.key) connected.add(e.source_key);
      });
    }
    nodeVisuals.current.forEach((v, key) => {
      const passesLens = !lensKeys || lensKeys.has(key);
      const passesSelection = !selected || connected.has(key);
      const on = passesLens && passesSelection;
      // 実際のmaterial.opacityへの反映はanimateループ（点滅演出と合成するため）
      v.focusOpacity = on ? 1 : 0.18;
      v.mesh.userData.focusScale = selected && key === selected.key ? 1.35 : 1;
    });
    edgeVisuals.current.forEach((ev) => {
      const touches = selected && (ev.edge.source_key === selected.key || ev.edge.target_key === selected.key);
      const passesLens =
        !lensKeys || (lensKeys.has(ev.edge.source_key) && lensKeys.has(ev.edge.target_key));
      const base = edgeBaseOpacity(ev.edge);
      let opacity = !selected ? base : touches ? Math.min(base * 2.6, 0.9) : base * 0.12;
      if (!passesLens) opacity *= 0.1;
      ev.baseOpacity = opacity;
    });
  }, [selectedKey, nodes, edges, lensKeys]);

  // ── レンズが変わったら、その星々が画面に映るようカメラを向ける ──
  // （クラスタは3D空間上で離れた領域に配置されているため、明るくなっても
  // 　カメラが別方向を向いていると何も変わって見えない）
  useEffect(() => {
    if (!lensKeys || lensKeys.size === 0) return;
    const matching = Array.from(lensKeys)
      .map((k) => nodeVisuals.current.get(k))
      .filter((v): v is NodeVisual => !!v);
    if (matching.length === 0) return;

    const centroid = new THREE.Vector3();
    matching.forEach((v) => centroid.add(v.targetPos));
    centroid.multiplyScalar(1 / matching.length);

    let maxDist = 0;
    matching.forEach((v) => {
      maxDist = Math.max(maxDist, v.targetPos.distanceTo(centroid));
    });
    const distance = THREE.MathUtils.clamp(maxDist * 2.4 + 40, 60, 300);

    cameraFocusRef.current = { until: clockRef.current.getElapsedTime() + 2, pos: centroid, distance };
  }, [lensKeys]);

  // ── 一覧などから特定の星への注目が要求されたら、カメラをそこへ向ける ──
  useEffect(() => {
    if (!focusRequest) return;
    const v = nodeVisuals.current.get(focusRequest.key);
    if (!v) return;
    cameraFocusRef.current = {
      until: clockRef.current.getElapsedTime() + 2,
      pos: v.targetPos.clone(),
      distance: 80,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  return <div ref={wrapRef} style={{ position: "fixed", inset: 0 }} />;
}
