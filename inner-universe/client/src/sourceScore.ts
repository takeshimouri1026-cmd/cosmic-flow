import type { GraphEdge } from "./types";

// 「源流らしさ」= 出ている糸の本数 − 入ってくる糸の本数（純粋にどれだけ他へ影響を
// 与えている側か）。出入り両方ある星は「源流」ではなく「サブ」寄りに扱う。
// 3D宇宙とリスト表示の両方で同じ基準を使う。
// kind='influence' の糸だけを対象にする。example/resonanceは源流性に一切効かせない（§2.1）
export function computeNetDegree(edges: GraphEdge[]): Map<string, number> {
  const net = new Map<string, number>();
  edges
    .filter((e) => e.kind === "influence")
    .forEach((e) => {
      net.set(e.source_key, (net.get(e.source_key) ?? 0) + 1);
      net.set(e.target_key, (net.get(e.target_key) ?? 0) - 1);
    });
  return net;
}

export function sourceScoreFor(netDegree: Map<string, number>, key: string): number {
  const d = netDegree.get(key) ?? 0;
  return Math.min(Math.max(d, 0) / 4, 1);
}

export function ringTierFor(netDegree: Map<string, number>, key: string): 0 | 1 | 2 {
  const d = netDegree.get(key) ?? 0;
  if (d >= 3) return 2;
  if (d >= 1) return 1;
  return 0;
}

export function mixWithWhite(hex: string, whiteBlend: number): string {
  const m = hex.replace("#", "");
  const r = parseInt(m.substring(0, 2), 16);
  const g = parseInt(m.substring(2, 4), 16);
  const b = parseInt(m.substring(4, 6), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * whiteBlend);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
