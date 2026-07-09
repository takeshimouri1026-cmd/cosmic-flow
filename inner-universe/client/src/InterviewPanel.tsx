import { useEffect, useRef, useState } from "react";

interface ChatLine {
  role: "user" | "assistant";
  text: string;
}

interface Props {
  pendingQuestion: string | null;
  onSend: (text: string) => Promise<void>;
  lines: ChatLine[];
  streaming: boolean;
  prefill: string;
  onPrefillConsumed: () => void;
}

export default function InterviewPanel({
  pendingQuestion,
  onSend,
  lines,
  streaming,
  prefill,
  onPrefillConsumed,
}: Props) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (prefill) {
      setText(prefill);
      onPrefillConsumed();
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const submit = async () => {
    const value = text.trim();
    if (!value || streaming) return;
    setText("");
    await onSend(value);
    inputRef.current?.focus();
  };

  return (
    <div className="interview-panel">
      <div className="interview-log">
        {lines.length === 0 && pendingQuestion && (
          <div className="chat-line assistant">{pendingQuestion}</div>
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
    </div>
  );
}
