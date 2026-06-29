import { useEffect, useRef } from "react";
import { getMood } from "./cosmicMood.js";

// Canvas を使用したゆっくり左回転する宇宙背景。
// 星の瞬き、星雲の脈動、宇宙の呼吸、バイオリズムへの応答、マウスのパララックスを含む。
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

    // バイオリズムへの応答（毎フレーム目標値へ滑らかに寄せる）
    // energy: 覚醒の高低(-1〜1) / tone: 上昇=正・内省=負(-1〜1)
    const eased = { energy: 0, tone: 0 };
    // 回転は累積（速度が変わっても角度が飛ばないように dt で積算）
    let spin = 0;
    let lastNow = startTime;

    const draw = (now) => {
      const t = (now - startTime) / 1000;
      const dt = Math.min((now - lastNow) / 1000, 0.05);
      lastNow = now;
      const breath = breathAt(t);

      // 気分を滑らかに反映
      const m = getMood();
      const targetEnergy = m.active ? (m.awakening - 50) / 50 : 0;
      const targetTone = m.active ? m.overall : 0;
      eased.energy += (targetEnergy - eased.energy) * 0.015;
      eased.tone += (targetTone - eased.tone) * 0.015;
      const energy = eased.energy;     // 星の輝き・回転速度
      const warm = Math.max(0, eased.tone);   // 上昇の流れ → 金の温かさ
      const cool = Math.max(0, -eased.tone);  // 内省の流れ → 深い藍

      // 覚醒が高いほど宇宙はわずかに速く巡る
      spin += dt * (1 + energy * 0.4);
      const brightness = 1 + energy * 0.3;

      ctx.clearRect(0, 0, width, height);

      // 背景グラデーション
      const bg = ctx.createRadialGradient(
        width * 0.5, height * 0.35, 0,
        width * 0.5, height * 0.35, Math.max(width, height) * 0.8
      );
      // 中心の明度を呼吸で揺らし、気分で色相を傾ける
      // 上昇(warm)→やや暖かい紫金へ・明るく / 内省(cool)→深い藍へ・静かに
      const coreL = 18 + breath * 9 + energy * 5;        // 明度
      const coreHue = 252 - warm * 24 + cool * 8;        // 252(紫) → 金寄り/藍寄り
      const coreS = 45 + warm * 15;                      // 上昇時は彩度up
      bg.addColorStop(0, `hsl(${coreHue}, ${coreS}%, ${coreL}%)`);
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
        const rot = -spin * 0.03 * layers[0].speed;
        const a = n.angle + rot;
        // 全星雲が宇宙の呼吸で一斉に膨張・収縮（位相差はわずかに残し有機的に）
        const pulse = 0.75 + 0.35 * breath + 0.05 * Math.sin(t * n.speed + n.phase);
        const x = cx + Math.cos(a) * n.radius * baseR * layers[0].scale;
        const y = cy + Math.sin(a) * n.radius * baseR * layers[0].scale * 0.85;
        // 上昇時は金(45)へ寄り、内省時は藍(215)へ深まる
        const nHue = n.hue + warm * (45 - n.hue) * 0.5 + cool * (215 - n.hue) * 0.4;
        const nAlpha = 0.18 * pulse * brightness;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, n.size * pulse);
        grad.addColorStop(0, `hsla(${nHue}, 70%, 60%, ${nAlpha})`);
        grad.addColorStop(1, "hsla(0,0%,0%,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, n.size * pulse, 0, Math.PI * 2);
        ctx.fill();
      }

      // 星（層ごとに回転速度を変える）
      for (const s of stars) {
        const layer = layers[s.layer];
        const rot = -spin * 0.04 * layer.speed;
        const a = s.angle + rot;
        const x = cx + Math.cos(a) * s.radius * baseR * layer.scale;
        const y = cy + Math.sin(a) * s.radius * baseR * layer.scale * 0.85;
        const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(t * s.speed + s.phase));
        // 個々の瞬き × 宇宙の呼吸（吸うと星々が一斉に息づく）× 覚醒の輝き
        const breathGlow = 0.7 + 0.3 * breath;
        // 上昇時は星の色みが金へ寄る
        const sHue = s.hue + warm * (45 - s.hue) * 0.4;
        ctx.fillStyle = `hsla(${sHue}, 80%, 80%, ${twinkle * layer.opacity * breathGlow * brightness})`;
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
