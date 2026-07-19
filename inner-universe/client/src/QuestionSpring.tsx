import { useEffect, useState } from "react";
import { fetchQuestions, patchQuestion } from "./api";
import type { GraphNode, Question } from "./types";

interface Props {
  universeId: string;
  nodeByKey: Map<string, GraphNode>;
  onClose: () => void;
  onSelectNode: (key: string) => void;
  onPick: (question: Question) => void;
  busy: boolean;
}

// 質問の泉（§14.4）: AIが聞きたいことが複数貯まる場所。ユーザーは提示中の質問に答えても、
// 泉から別の質問を選んで答えてもいい。「消す」より「暗くする」（dismissed）— 泉の底から復活できる
export default function QuestionSpring({ universeId, nodeByKey, onClose, onSelectNode, onPick, busy }: Props) {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bottomOpen, setBottomOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Question[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    fetchQuestions(universeId)
      .then(({ questions }) => setQuestions(questions))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [universeId]);

  const loadBottom = async () => {
    setBottomOpen((v) => !v);
    if (dismissed !== null) return;
    try {
      const { questions: all } = await fetchQuestions(universeId, true);
      setDismissed(all.filter((q) => q.status === "dismissed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const dismiss = async (q: Question) => {
    setPending(q.id);
    try {
      await patchQuestion(q.id, "dismissed");
      setQuestions((prev) => (prev ? prev.filter((x) => x.id !== q.id) : prev));
      setDismissed((prev) => (prev ? [{ ...q, status: "dismissed" }, ...prev] : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  };

  const restore = async (q: Question) => {
    setPending(q.id);
    try {
      await patchQuestion(q.id, "open");
      setDismissed((prev) => (prev ? prev.filter((x) => x.id !== q.id) : prev));
      setQuestions((prev) => (prev ? [{ ...q, status: "open" }, ...prev] : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="question-spring">
      <div className="question-spring-header">
        <span>泉（{questions?.length ?? "…"}）</span>
        <button onClick={onClose}>✕</button>
      </div>
      {error && <div className="question-spring-error">{error}</div>}
      <div className="question-spring-body">
        {questions === null && <div className="question-spring-empty">読み込んでいます…</div>}
        {questions !== null && questions.length === 0 && (
          <div className="question-spring-empty">泉はまだ空です。対話が進むと、AIが聞きたいことがここに貯まっていきます。</div>
        )}
        {questions?.map((q) => {
          const expanded = expandedId === q.id;
          return (
            <div key={q.id} className={`question-spring-row${q.status === "asked" ? " asked" : ""}`}>
              <button className="question-spring-question" onClick={() => setExpandedId((cur) => (cur === q.id ? null : q.id))}>
                {q.status === "asked" && <span className="question-spring-badge">提示中</span>}
                <span>{q.question}</span>
                <span className="question-spring-chevron">{expanded ? "▲" : "▼"}</span>
              </button>
              {expanded && (
                <div className="question-spring-detail">
                  {q.rationale && <div className="question-spring-rationale">AIがこれを聞きたい理由: {q.rationale}</div>}
                  {(q.evidence?.node_keys ?? []).length > 0 && (
                    <div className="question-spring-chips">
                      {q.evidence?.node_keys?.map((key) => (
                        <button key={key} className="question-spring-chip" onClick={() => onSelectNode(key)}>
                          {nodeByKey.get(key)?.label ?? key}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="question-spring-actions">
                    <button
                      className="question-spring-pick"
                      disabled={busy || pending === q.id}
                      onClick={() => onPick(q)}
                    >
                      これに答えたい
                    </button>
                    <button
                      className="question-spring-dismiss"
                      disabled={busy || pending === q.id}
                      onClick={() => dismiss(q)}
                    >
                      暗くする
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <button className="question-spring-bottom-toggle" onClick={loadBottom}>
          {bottomOpen ? "▲ 泉の底を閉じる" : "▼ 泉の底（暗くした質問）"}
        </button>
        {bottomOpen && (
          <div className="question-spring-bottom">
            {dismissed === null && <div className="question-spring-empty">読み込んでいます…</div>}
            {dismissed !== null && dismissed.length === 0 && (
              <div className="question-spring-empty">暗くした質問はありません</div>
            )}
            {dismissed?.map((q) => (
              <div key={q.id} className="question-spring-bottom-row">
                <span>{q.question}</span>
                <button disabled={busy || pending === q.id} onClick={() => restore(q)}>
                  泉に戻す
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
