import { useEffect, useRef, useState } from "react";

interface ChatLine {
  role: "user" | "assistant";
  text: string;
}

interface Props {
  activeQuestion: string | null;
  onSend: (text: string) => Promise<void>;
  lines: ChatLine[];
  streaming: boolean;
  prefill: string;
  onPrefillConsumed: () => void;
  forceOpenNonce?: number;
}

export default function InterviewPanel({
  activeQuestion,
  onSend,
  lines,
  streaming,
  prefill,
  onPrefillConsumed,
  forceOpenNonce,
}: Props) {
  const [text, setText] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 泉から質問を選んだ時（§14.4）、たたまれていたら開く
  useEffect(() => {
    if (forceOpenNonce) setCollapsed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceOpenNonce]);

  useEffect(() => {
    if (prefill) {
      setText(prefill);
      onPrefillConsumed();
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  // 会話が伸びてこのパネルの高さが変わるたびに、詳細パネル(.card)がその上に
  // 収まるよう高さをCSS変数として公開する（固定オフセットだと会話が伸びた時に隠れてしまう）
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const update = () => document.documentElement.style.setProperty("--interview-h", `${el.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const submit = async () => {
    const value = text.trim();
    if (!value || streaming) return;
    setText("");
    setCollapsed(false);
    await onSend(value);
    inputRef.current?.focus();
  };

  return (
    <div className="interview-panel" ref={panelRef}>
      <button className="interview-toggle" onClick={() => setCollapsed((v) => !v)}>
        {collapsed ? "▲ 会話をひらく" : "▼ 宇宙をみる"}
      </button>
      {!collapsed && (
        <>
          <div className="interview-log">
            {lines.length === 0 && (
              <div className="chat-line assistant">
                {activeQuestion ??
                  "この宇宙は、これまでの対話から生まれた星々で始まっています。いま心にあること、最近熱を持っていることを、自由に話してください。"}
              </div>
            )}
            {lines.map((l, i) => (
              <div key={i} className={`chat-line ${l.role}`}>
                {l.text}
              </div>
            ))}
            {streaming && <div className="chat-line assistant typing">…</div>}
          </div>
          <div className="interview-input">
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="ここに答えを書く…"
              rows={2}
              disabled={streaming}
            />
            <button onClick={submit} disabled={streaming || !text.trim()}>
              送る
            </button>
          </div>
        </>
      )}
    </div>
  );
}
