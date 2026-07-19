import { useEffect, useRef, useState } from "react";
import { fetchTranscript } from "./api";
import type { TranscriptItem } from "./types";

interface Props {
  universeId: string;
  onClose: () => void;
}

const PAGE_SIZE = 100;

function dateHeading(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

// 対話の航跡（§14.4）: これまでの語り全体を読み返す全画面シート。
// 蒸留はサーバ側で済んでいる（生のグラフダイジェスト・tool_use JSONはここに来ない）
export default function TranscriptView({ universeId, onClose }: Props) {
  const [items, setItems] = useState<TranscriptItem[]>([]); // 古い→新しい順（画面表示順）
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const loadedOnce = useRef(false);

  const loadMore = async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    const before = items.length > 0 ? items[0].created_at : undefined;
    const el = bodyRef.current;
    const prevScrollHeight = el?.scrollHeight ?? 0;
    try {
      const { items: page } = await fetchTranscript(universeId, { before, limit: PAGE_SIZE });
      if (page.length < PAGE_SIZE) setHasMore(false);
      const chronological = [...page].reverse();
      setItems((prev) => [...chronological, ...prev]);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevScrollHeight;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (loadedOnce.current) return;
    loadedOnce.current = true;
    loadMore().then(() => {
      requestAnimationFrame(() => {
        const el = bodyRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    if (el.scrollTop < 80) loadMore();
  };

  let lastDate = "";

  return (
    <div className="transcript-view">
      <div className="transcript-header">
        <span>航跡</span>
        <button onClick={onClose}>✕</button>
      </div>
      {error && <div className="transcript-error">{error}</div>}
      <div className="transcript-body" ref={bodyRef} onScroll={handleScroll}>
        {loading && <div className="transcript-loading">読み込んでいます…</div>}
        {!hasMore && items.length > 0 && <div className="transcript-start">ここが宇宙のはじまり</div>}
        {items.map((item, i) => {
          const heading = dateHeading(item.created_at);
          const showHeading = heading !== lastDate;
          lastDate = heading;
          return (
            <div key={i}>
              {showHeading && <div className="transcript-date">{heading}</div>}
              {renderItem(item)}
            </div>
          );
        })}
        {items.length === 0 && !loading && <div className="transcript-empty">まだ何も語られていません</div>}
      </div>
    </div>
  );
}

function renderItem(item: TranscriptItem) {
  switch (item.type) {
    case "user_text":
      return <div className="transcript-bubble user">{item.text}</div>;
    case "ai_text":
      return <div className="transcript-bubble ai">{item.text}</div>;
    case "action":
      return <div className="transcript-chip">🛠 {item.summary}</div>;
    case "picked_question":
      return <div className="transcript-chip">💧 泉から選んだ問い:「{item.question}」</div>;
    case "star_born":
      return <div className="transcript-chip">⭐ 星が生まれた「{item.label}」</div>;
    case "thread_tied":
      return (
        <div className="transcript-chip">
          🧵 糸 {item.source_key}→{item.target_key} を張った
        </div>
      );
    case "star_updated":
      return <div className="transcript-chip">✎ 星「{item.key}」を更新した</div>;
    case "thread_cut":
      return <div className="transcript-chip">✂ 糸を切った</div>;
    case "question_queued":
      return <div className="transcript-chip">💧 {item.present ? "締めの質問を保存した" : "質問を泉に貯めた"}</div>;
    default:
      return null;
  }
}
