# Cosmic Flow 🌌

生年月日からバイオリズムと「覚醒の波」を可視化し、Claude(Anthropic API)が今週の過ごし方・おすすめの体験を提案するWebアプリ。

## 仕組み
- **バイオリズム計算**(`src/biorhythm.js`):身体23日・感情28日・知性33日・直感38日の正弦波サイクルを生年月日から算出。これは決定論的な計算。
- **可視化**(`src/App.jsx`):recharts で今週(±3日)の波形チャート、総合エネルギー、覚醒スコアを表示。
- **AIアドバイス**(`server.js`):計算した数値を Claude に渡し、今週の流れ・調子の良い日・避けたい日・おすすめ体験・整える習慣を生成。

## セットアップ
```bash
npm install
cp .env.example .env   # ANTHROPIC_API_KEY を記入
```

## 起動(2つのターミナルで)
```bash
npm run server   # APIサーバー http://localhost:3001
npm run dev      # フロント   http://localhost:5173
```

## カスタマイズの入口
- サイクル周期や色 → `src/biorhythm.js` の `CYCLES`
- アドバイスの口調・出力項目 → `server.js` の `prompt`
- 「覚醒スコア」の定義 → `biorhythm.js` の `awakeningScore`

## 注意
バイオリズムは自己内省のためのツールであり、医療・科学的予測ではありません。
