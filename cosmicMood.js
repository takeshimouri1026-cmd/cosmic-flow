// 背景アニメーションへ「今のバイオリズムの気分」を渡す軽量ストア。
// React の再描画を挟まず、Canvas が毎フレーム現在値を読む。
//
// awakening: 0〜100（覚醒スコア）
// overall:   -1〜1（総合エネルギー。正=上昇 / 負=内省）
// active:    波を読んだ後 true（読む前はニュートラルな宇宙）

const mood = { awakening: 50, overall: 0, active: false };

export function setMood(next) {
  Object.assign(mood, next);
}

export function getMood() {
  return mood;
}
