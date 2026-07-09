// win-ca は型定義を同梱していない（@types/win-ca も存在しない）。
// Windows でしか使わない動的importのためだけに必要な最小宣言。
declare module "win-ca" {
  const winCa: { inject: (mode: string) => void };
  export default winCa;
}
