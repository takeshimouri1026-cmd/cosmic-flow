import { useEffect, useRef } from "react";

// Canvas を使用したゆっくり左回転する宇宙背景。
// 星の瞬き、星雲の脈動、マウスによるパララックス効果を含む。
export default function CosmicBackground() {
  const canvasRef = useRef(null);
  const mouseRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    let animationId;
    let width = 0;
    let height = 0;

    const handleMouseMove = (e) => {
      mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseRef.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };

    const resize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", handleMouseMove, { passive: true });

    // 3層の回転設定（左回転）
    const startTime = performance.now();
    const layers = [
      { speed: 0.2, scale: 1.15, opacity: 0.55 }, // 星雲（遅い）
      { speed: 0.6, scale: 1.05, opacity: 0.75 }, // 中間層
      { speed: 1.0, scale: 1.0, opacity: 0.9 },   // 星（速い）
    ];

    // 星の瞬き用
    const STAR_COUNT = 1600;
    const stars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.pow(Math.random(), 0.6) * 1.1;
      stars.push({
        angle,
        radius,
        r: Math.random() * 1.4 + 0.3,
        phase: Math.random() * Math.PI * 2,
        speed: Math.random() * 2 + 0.5,
        hue: Math.random() < 0.3 ? 45 : Math.random() < 0.5 ? 260 : 210,
        layer: Math.floor(Math.random() * 3),
      });
    }

    // 星雲の塊
    const NEBULA_COUNT = 14;
    const nebulae = [];
    for (let i = 0; i < NEBULA_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.3 + Math.random() * 0.7;
      nebulae.push({
        angle,
        radius,
        size: 120 + Math.random() * 260,
        hue: Math.random() < 0.5 ? 260 : 215,
        phase: Math.random() * Math.PI * 2,
        speed: Math.random() * 0.5 + 0.2,
      });
    }

    // 宇宙の呼吸：吸う4秒・吐く6秒の非対称サイクル(計10秒)
    // breath: 0(吐ききった静寂) 〜 1(吸いきった充溢)
    const INHALE = 4, EXHALE = 6, CYCLE = INHALE + EXHALE;
    const breathAt = (t) => {
      const p = t % CYCLE;
      if (p < INHALE) {
        // 吸う：滑らかに満ちる
        return 0.5 - 0.5 * Math.cos((p / INHALE) * Math.PI);
      }
      // 吐く：ゆっくり沈む
      return 0.5 + 0.5 * Math.cos(((p - INHALE) / EXHALE) * Math.PI);
    };

    const draw = (now) => {
      const t = (now - startTime) / 1000;
      const breath = breathAt(t);
      ctx.clearRect(0, 0, width, height);

      // 背景グラデーション
      const bg = ctx.createRadialGradient(
        width * 0.5, height * 0.35, 0,
        width * 0.5, height * 0.35, Math.max(width, height) * 0.8
      );
      // 中心の明度を呼吸で揺らす（吸うと淡く満ち、吐くと深く沈む）
      const coreL = 18 + breath * 9; // 18%〜27%
      bg.addColorStop(0, `hsl(252, 45%, ${coreL}%)`);
      bg.addColorStop(0.5, "#0d0b22");
      bg.addColorStop(1, "#050410");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      const cx = width / 2 + mouseRef.current.x * 18;
      const cy = height / 2 + mouseRef.current.y * 18;
      const baseR = Math.max(width, height) * 0.62;

      // 星雲（左回転 = マイナス方向）
      ctx.globalCompositeOperation = "lighter";
      for (const n of nebulae) {
        const rot = -t * 0.03 * layers[0].speed;
        const a = n.angle + rot;
        // 全星雲が宇宙の呼吸で一斉に膨張・収縮（位相差はわずかに残し有機的に）
        const pulse = 0.75 + 0.35 * breath + 0.05 * Math.sin(t * n.speed + n.phase);
        const x = cx + Math.cos(a) * n.radius * baseR * layers[0].scale;
        const y = cy + Math.sin(a) * n.radius * baseR * layers[0].scale * 0.85;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, n.size * pulse);
        grad.addColorStop(0, `hsla(${n.hue}, 70%, 60%, ${0.18 * pulse})`);
        grad.addColorStop(1, "hsla(0,0%,0%,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, n.size * pulse, 0, Math.PI * 2);
        ctx.fill();
      }

      // 星（層ごとに回転速度を変える）
      for (const s of stars) {
        const layer = layers[s.layer];
        const rot = -t * 0.04 * layer.speed;
        const a = s.angle + rot;
        const x = cx + Math.cos(a) * s.radius * baseR * layer.scale;
        const y = cy + Math.sin(a) * s.radius * baseR * layer.scale * 0.85;
        const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(t * s.speed + s.phase));
        // 個々の瞬き × 宇宙の呼吸（吸うと星々が一斉に息づく）
        const breathGlow = 0.7 + 0.3 * breath;
        ctx.fillStyle = `hsla(${s.hue}, 80%, 80%, ${twinkle * layer.opacity * breathGlow})`;
        ctx.beginPath();
        ctx.arc(x, y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalCompositeOperation = "source-over";
      animationId = requestAnimationFrame(draw);
    };
    animationId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 -z-10 w-full h-full"
      style={{ pointerEvents: "none" }}
    />
  );
}
