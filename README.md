# 信用ストレスモニター（Credit Stress Monitor）

FRED APIを使った信用市場ストレスモニターダッシュボード。
米国ハイイールド債のOAS（Option-Adjusted Spread）を格付け別に可視化し、信用ストレスのシグナルを自動判定する単一ページアプリケーション。

## 機能

- 格付け別OASスプレッド推移チャート（HY Total / BB / Single-B / CCC）
- CCC − BB スプレッド差の可視化（σベースの警戒判定付き）
- 20日変化幅（bps）のモニタリング
- 米国HY vs 新興国HYの相関分析
- シグナル自動判定とアラートログ

### シグナル判定基準

| 指標 | 注意（WARN） | 警戒（ALERT） |
|------|-------------|---------------|
| US HY OAS | > 5% | > 7% |
| CCC-BBスプレッド差 | > 1σ | > 2σ |
| 20日変化幅 | > 50bps | > 100bps |
| US-EM相関 | > 0.6 | > 0.8 かつ両方拡大 |

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

`public/data/fred.json`が存在すればダッシュボードが描画されます。初回はGitHub Actionsのワークフローを手動実行してデータを生成してください。

## コマンド

| コマンド | 説明 |
|---------|------|
| `npm run dev` | 開発サーバー起動（自動でブラウザが開く） |
| `npm run build` | 本番ビルド（出力先: `dist/`） |
| `npm run preview` | ビルド結果のプレビュー |
| `npm run deploy` | GitHub Pagesへデプロイ |

## 技術スタック

- **D3.js v7** — チャート描画（CDN経由）
- **Vite** — バンドラー・開発サーバー
- **@vitejs/plugin-legacy** — レガシーブラウザ対応

## 使用データ（FREDシリーズ）

| シリーズID | 内容 |
|-----------|------|
| `BAMLH0A0HYM2` | 米国HY OAS（Total） |
| `BAMLH0A1HYBB` | BB格 OAS |
| `BAMLH0A2HYB` | Single-B格 OAS |
| `BAMLH0A3HYC` | CCC格以下 OAS |
| `BAMLEMHBHYCRPIOAS` | 新興国HY OAS |

## ファイル構成

```
fred_dashboard/
├── .github/workflows/
│   └── fetch-fred.yml  # 日次データ取得 + ビルド + デプロイ
├── public/data/
│   └── fred.json       # FREDデータ（GitHub Actionsで自動更新）
├── src/
│   ├── index.html      # HTML構造 + インラインCSS
│   └── index.js        # 計算・D3チャート描画・アラート判定
├── vite.config.js      # Vite設定
└── package.json
```
