/**
 * server.js - 毛利家LINE bot メインサーバー
 *
 * 役割：
 * - LINEのWebhookリクエストを受け取る
 * - 署名を検証して本物のLINEからのリクエストかチェックする
 * - イベントをハンドラーに渡して処理する
 *
 * 起動方法:
 *   cd line-bot
 *   npm install
 *   cp .env.example .env  （そして .env を編集）
 *   npm run dev
 */

import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';

// ハンドラーとDBを起動時にインポート（DBの初期化がここで走る）
import { handleMessage } from './handlers/messageHandler.js';

// ============================================================
// Express アプリの設定
// ============================================================
const app = express();

// /webhook エンドポイントは「生のリクエストボディ」が必要
// （署名検証でバイト列をそのままHMAC計算するため）
// express.json() を先に使うとボディが変換されてしまい署名が合わなくなる
app.use('/webhook', express.raw({ type: 'application/json' }));

// /webhook 以外は通常のJSON処理
app.use(express.json());

// ============================================================
// 署名検証
// ============================================================

/**
 * LINEが送ってくるリクエストが本物かチェックする
 *
 * LINEは「チャネルシークレット」を鍵にして、
 * リクエストボディをHMAC-SHA256でハッシュ化したものをヘッダーに入れてくる。
 * こちらでも同じ計算をして一致するか確認する（改ざん・なりすまし防止）。
 *
 * @param {Buffer} body       - 生のリクエストボディ（Bufferのまま）
 * @param {string} signature  - X-Line-Signature ヘッダーの値
 * @returns {boolean}
 */
function verifySignature(body, signature) {
  if (!signature) return false;
  const hash = crypto
    .createHmac('sha256', process.env.LINE_CHANNEL_SECRET)
    .update(body)
    .digest('base64');
  return hash === signature;
}

// ============================================================
// Webhookエンドポイント
// ============================================================

app.post('/webhook', (req, res) => {
  // LINEは「5秒以内に200 OKを返す」ことを要求している
  // 処理が長くなるので、まず200を返してから非同期で処理する
  res.status(200).send('OK');

  // 署名チェック
  const signature = req.headers['x-line-signature'];
  if (!verifySignature(req.body, signature)) {
    console.error('[Webhook] ❌ 署名検証失敗 - 不正なリクエストの可能性があります');
    return;
  }

  // ボディをJSONにパース
  let payload;
  try {
    payload = JSON.parse(req.body.toString());
  } catch (e) {
    console.error('[Webhook] ❌ JSONパース失敗:', e.message);
    return;
  }

  const events = payload.events ?? [];
  console.log(`[Webhook] ✅ 署名OK - イベント数: ${events.length}`);

  // 各イベントを非同期で処理（200 OK返却後に実行される）
  for (const event of events) {
    handleMessage(event).catch(err => {
      console.error('[Webhook] イベント処理エラー:', err);
    });
  }
});

// ============================================================
// ヘルスチェックエンドポイント
// ブラウザで http://localhost:3002/health を開いて確認できる
// ============================================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: '毛利家LINE bot',
    timestamp: new Date().toLocaleString('ja-JP'),
  });
});

// ============================================================
// サーバー起動
// ============================================================
const PORT = process.env.PORT ?? 3002;
app.listen(PORT, () => {
  console.log('');
  console.log('🏠 毛利家LINE bot サーバー起動しました');
  console.log(`   ローカルURL: http://localhost:${PORT}`);
  console.log(`   Webhook URL: http://localhost:${PORT}/webhook`);
  console.log('');
  console.log('📡 外部からアクセスするにはngrokが必要です:');
  console.log(`   ngrok http ${PORT}`);
  console.log('   → 表示された https://xxxx.ngrok-free.app/webhook を LINE Developersに設定`');
  console.log('');
});
