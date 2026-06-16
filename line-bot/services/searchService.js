/**
 * services/searchService.js
 * Tavily APIを使ったウェブ検索
 */

/**
 * @param {string} query - 検索クエリ
 * @returns {string} 検索結果をまとめたテキスト（Claude に渡す用）
 */
export async function search(query) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      search_depth: 'basic',
      max_results: 5,
      include_answer: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`Tavily APIエラー: ${res.status}`);
  }

  const data = await res.json();

  const urls = data.results.map(r => ({ title: r.title, url: r.url }));

  const text = data.answer
    ? data.answer
    : data.results.map(r => `【${r.title}】${r.content}`).join('\n\n');

  return { text, urls };
}
