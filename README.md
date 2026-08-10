# 信用ストレスモニター（Credit Stress Monitor）

FRED APIを使った信用市場ストレスモニターダッシュボード。
米国ハイイールド債のOAS（Option-Adjusted Spread）を格付け別に可視化し、あわせて銀行・資金市場のストレスを集約して、信用ストレスのシグナルを自動判定する単一ページアプリケーション。

https://shimizu.github.io/FRED-credit-stress-monitor/

## 機能

- 格付け別OASスプレッド推移チャート（HY Total / BB / Single-B / CCC）
- CCC − BB スプレッド差の可視化（σベースの警戒判定付き）
- 20日変化幅（bps）のモニタリング
- 米国HY vs 新興国HYの相関分析
- 銀行ストレス指数（Bank Stress Index）のスコア化と推移チャート
- シグナル自動判定とアラートログ

### シグナル判定基準

| 指標 | 注意（WARN） | 警戒（ALERT） |
|------|-------------|---------------|
| US HY OAS | > 5% | > 7% |
| CCC-BBスプレッド差 | > 1σ | > 2σ |
| 20日変化幅 | > 50bps | > 100bps |
| CCC/BB変化率比 | 絶対値 > 2倍 | 絶対値 > 3倍 |
| US-EM相関 | > 0.6 | > 0.8 かつ両方拡大 |
| 銀行ストレスScore | >= 45 | >= 55（65以上は危機） |

### 銀行ストレス指数について

TED Spread・CP Spread（CP3M − DTB3）・SOFR・St. Louis FSIの4系列をZスコア化し、その日に値がある系列だけ（2系列以上）を平均してBSIとし、`Score = 50 + 10 × BSI` で表示します。

ただしTEDRATEは2022年、CP3Mは1997年でFRED側のデータ提供が終了しているため、**現在のScoreは実質SOFRとSt. Louis FSIの2系列で算出されています**。構成系列数が時期によって変わるため、過去と現在のScoreは厳密には同じ尺度ではありません。

## データ取得の仕組み

GitHub Actionsが毎日UTC 22:00（米国市場クローズ後）にFRED APIからデータを取得し、`public/data/fred.json`に保存します。フロントエンドはこの静的JSONを読み込んで描画します。

- ワークフロー: `.github/workflows/fetch-fred.yml`
- 手動実行: GitHub Actions画面から`workflow_dispatch`で即時実行可能
- リポジトリのSecrets設定に`FRED_API_KEY`（[FRED API](https://fred.stlouisfed.org/docs/api/api_key.html)で取得）が必要

## セットアップ

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. 開発サーバーの起動

```bash
npm run dev
```

`public/data/fred.json`が存在すればダッシュボードが描画されます。ファイルが無い場合は、GitHub Actionsのワークフローを手動実行するか、ローカルで次を実行してデータを生成してください。

```bash
FRED_API_KEY=your_key npm run fetch:data
```

## コマンド

| コマンド | 説明 |
|---------|------|
| `npm run dev` | 開発サーバー起動（自動でブラウザが開く） |
| `npm run fetch:data` | FRED APIからデータを取得して`public/data/fred.json`を更新（`FRED_API_KEY`環境変数が必要） |
| `npm run build` | 本番ビルド（出力先: `dist/`） |
| `npm run preview` | ビルド結果のプレビュー |
| `npm run deploy` | GitHub Pagesへデプロイ |

## 技術スタック

- **D3.js v7** — チャート描画（CDN経由）
- **Vite** — バンドラー・開発サーバー
- **@vitejs/plugin-legacy** — レガシーブラウザ対応

## 使用データ（FREDシリーズ）

### 信用スプレッド

| シリーズID | 内容 |
|-----------|------|
| `BAMLH0A0HYM2` | 米国HY OAS（Total） |
| `BAMLH0A1HYBB` | BB格 OAS |
| `BAMLH0A2HYB` | Single-B格 OAS |
| `BAMLH0A3HYC` | CCC格以下 OAS |
| `BAMLEMHBHYCRPIOAS` | 新興国HY OAS |

ICE BofAのOAS系列はFRED側の仕様により直近約3年分しか取得できません。`fred.json`は取得のたびに全置換されるため、それ以前の履歴は保持されず、期間ボタンの「5年」「全期間」を選んでも3年分までしか表示されません。

### 銀行ストレス

| シリーズID | 内容 |
|-----------|------|
| `TEDRATE` | TED Spread（2022年で提供終了） |
| `CP3M` | 3ヶ月物CP金利（1997年で提供終了） |
| `DTB3` | 3ヶ月物国債金利（CP Spread計算用） |
| `SOFR` | 担保付翌日物調達金利 |
| `STLFSI4` | St. Louis Fed 金融ストレス指数 |

## ファイル構成

```
FRED-credit-stress-monitor/
├── .github/workflows/
│   └── fetch-fred.yml  # 日次データ取得 + ビルド + デプロイ
├── docs/
│   └── credit_stress_monitor_guid.md  # 各指標の解説
├── public/data/
│   └── fred.json       # FREDデータ（GitHub Actionsで自動更新）
├── scripts/
│   └── fetch-fred.js   # FRED APIからのデータ取得スクリプト
├── src/
│   ├── index.html      # HTML構造 + インラインCSS
│   └── index.js        # 計算・D3チャート描画・アラート判定
├── vite.config.js      # Vite設定
└── package.json
```
