# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

FRED APIを使った信用市場ストレスモニターダッシュボード（Credit Stress Monitor）。
米国ハイイールド債のOAS（Option-Adjusted Spread）を格付け別に可視化し、あわせて銀行・資金市場のストレスを集約して、信用ストレスのシグナルを自動判定する単一ページアプリケーション。

## 開発コマンド

- **開発サーバー起動**: `npm run dev`（自動でブラウザが開く）
- **データ取得**: `npm run fetch:data`（`FRED_API_KEY`環境変数が必要。`public/data/fred.json`を上書き）
- **本番ビルド**: `npm run build`（出力先: `dist/`）
- **プレビュー**: `npm run preview`
- **デプロイ**: `npm run deploy`（GitHub Pages via gh-pages）

テストやリンターは未導入。`npm run build`の成功が唯一の自動検証手段。

## アーキテクチャ

### Vite設定の注意点
- **rootは`src/`ディレクトリ**（`vite.config.js`で`root: 'src'`指定）
- エントリーポイントは`src/index.html`（プロジェクトルートではない）
- `base: "./"` で相対パスビルド
- publicディレクトリは`../public`

### ファイル構成
- `src/index.html` — HTML構造＋全CSSがインライン`<style>`タグ内に記述
- `src/index.js` — フロントエンド全ロジック（JSON読み込み、計算、D3チャート描画、アラート判定）
- `src/index.scss` — 未使用（テンプレートの残骸）
- `scripts/fetch-fred.js` — FRED APIから全シリーズを取得し`public/data/fred.json`を生成するNodeスクリプト（CommonJS）
- `public/data/fred.json` — 取得済みデータ。GitHub Actionsが日次で更新しコミットする
- `.github/workflows/fetch-fred.yml` — 日次データ取得 → コミット → ビルド → GitHub Pagesデプロイ
- `docs/credit_stress_monitor_guid.md` — 各指標の意味を非専門家向けに解説したドキュメント

### 技術スタック
- **D3.js v7** — CDN経由で読み込み（`<script src="...d3.min.js">`）、npmパッケージではない
- **Vite** — バンドラー・開発サーバー
- **@vitejs/plugin-legacy** — レガシーブラウザ対応

### データフロー
フロントエンドはFRED APIを直接叩かない。APIキー入力UIは存在しない。

1. GitHub Actions（毎日UTC 22:00）が`scripts/fetch-fred.js`を実行し、FRED APIから全シリーズを取得して`public/data/fred.json`へ書き出す
2. 差分があれば`chore: FREDデータを更新`でコミット・プッシュし、ビルドしてGitHub Pagesへデプロイ
3. ページロード時に`startFetch()`が`./data/fred.json`をfetchし、日付文字列を`Date`へパースしてグローバル変数`allData`へ格納
4. `renderAll()`が全メトリクス・チャート・アラートを一括再描画

期間ボタン（1年/3年/5年/全期間）と`resize`イベントも`renderAll()`を再実行する。銀行ストレス指数だけは`bankStressCache`にキャッシュされ、データ再読み込み時にクリアされる。

### 取得シリーズ（`scripts/fetch-fred.js`の`SERIES`）
| キー | シリーズID | 用途 |
|---|---|---|
| `HY` | `BAMLH0A0HYM2` | 米国HY OAS（Total） |
| `BB` | `BAMLH0A1HYBB` | BB格 OAS |
| `B` | `BAMLH0A2HYB` | Single-B格 OAS |
| `CCC` | `BAMLH0A3HYC` | CCC格以下 OAS |
| `EMHY` | `BAMLEMHBHYCRPIOAS` | 新興国HY OAS |
| `TEDRATE` | `TEDRATE` | 銀行ストレス構成（2022年で提供終了） |
| `CP3M` | `CP3M` | 銀行ストレス構成（1997年で提供終了） |
| `DTB3` | `DTB3` | CP Spread計算用の3ヶ月物国債金利 |
| `SOFR` | `SOFR` | 銀行ストレス構成 |
| `STLFSI` | `STLFSI4` | 銀行ストレス構成（St. Louis Fed金融ストレス指数） |

ICE BofAのOAS系列はFRED側の仕様変更により直近約3年分しか取得できない。`fred.json`は毎回全置換されるため、それ以前の履歴は保持されない。

### 主要な計算ロジック（`src/index.js`）
- `change20d()` — 20営業日変化幅（bps）
- `rollingChange()` — ローリング変化幅の系列化
- `spreadDiff()` — CCC-BBスプレッド差（同一日付で結合）
- `rollingCorrelation()` — 30日ローリング相関
- `rollingChangeCorrelation()` — 変化幅同士のローリング相関（US-EM相関で使用）
- `sigma()` — 1年（252日）のZスコア
- `computeCPSpread()` — CP3M − DTB3（同一日付で結合）
- `zscoreArray()` — 各時点までの累積平均・標準偏差による逐次Zスコア化
- `computeBankStressIndex()` — 銀行ストレス指数（BSI）の算出
- `bankScoreLevel()` — 銀行Scoreのゾーン判定
- `latestWithin()` / `alignSeriesValues()` — 更新頻度の異なる系列を許容日数付きで日付整列

### 銀行ストレス指数（BSI）
TED Spread、CP Spread、SOFR、St. Louis FSIの4系列をZスコア化し、日付ごとに**値が存在するものだけ**を平均する（2系列未満の日はスキップ）。表示スコアは`Score = 50 + 10 × BSI`。

ただしTEDRATEは2022年、CP3Mは1997年でFRED側の提供が終了しているため、**現在のBSIは実質SOFRとSTLFSIの2系列で算出される**。構成系列数が時期によって変わるため、過去と現在のScoreは厳密には同じ尺度ではない。この設計上の問題は未解決。

### シグナル判定基準

指標は性質で2系統に分かれ、**表示ラベルの語彙を分けている**。

**水準系**（絶対的な大きさに意味がある）— 危険度の語を使う
- **US HY OAS**: >5%=注意, >7%=異常
- **20日変化幅**: >50bps=注意, >100bps=異常
- **US-EM相関**: >0.6=注意, >0.8=注意（片側のみ拡大）, >0.8かつ両方拡大=異常
- **CCC/BB変化率比**: 絶対値>2=注意, >3=異常

**乖離系**（過去分布からのズレしか表さない）— `sigmaLevel()`で判定し、危険度ではなく乖離の大きさを示す語を使う
- **CCC-BBスプレッド差**: 1σ以下=平常域, >1σ=上振れ, >2σ=大きく上振れ, >3σ=極端
- **銀行ストレスScore**: `Score = 50 + 10 × BSI` なので50=過去平均、10ポイント=1σ。`bankScoreLevel()`は`sigmaLevel((score - 50) / 10)`へ委譲し、>=60(+1σ)=上振れ, >=70(+2σ)=大きく上振れ, >=80(+3σ)=極端

σは「珍しさ」であって「危険度」ではない。乖離系に「警戒」「危機」といった危険度の語を貼ると、+1.5σ程度（平常時でも年十数日発生する）を危機と呼ぶことになるため避けている。この方針変更により、旧基準（45/55/65）にあった「Score 50=平常なのに45以上で注意と出る」既知の問題も解消した。

ヘッダ右上の総合シグナルバッジは、一部の指標しか判定に含まれず誤解を招くため廃止した。全指標の判定は`renderAlerts()`によるアラートログに一本化されている。

アラートログの深刻度は`ALERT_LEVELS`で定義した4段階（`ok` / `warn` / `caution` / `danger`）。既定ラベルは水準系向けの 通常 / 注意 / 警戒 / 異常 で、乖離系のアラートは`alert.label`に`sigmaLevel()`のラベルを渡して上書きする。`caution`は`--orange`（`.alert-caution` / `.signal-orange`）で表示する。

閾値やラベルを変更したら、`src/index.js`の`GUIDES`と`docs/credit_stress_monitor_guid.md`も必ず併せて更新すること。

## 言語・コミット規約
- コミットメッセージ・コメント・ドキュメントは日本語で記述
- コミットプレフィックス: `feat:`, `fix:`, `docs:`, `refactor:`, `perf:`, `test:`, `chore:`, `style:`
