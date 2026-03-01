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

## セットアップ

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. FRED APIキーの設定

[FRED API](https://fred.stlouisfed.org/docs/api/api_key.html)からAPIキーを取得し、`.env`ファイルを作成してください。

```bash
cp .env.example .env
```

`.env`ファイルを編集してAPIキーを設定します。

```
VITE_FRED_API_KEY=your_fred_api_key_here
```

### 3. 開発サーバーの起動

```bash
npm run dev
```

ページ読み込み時にFRED APIから自動的にデータを取得し、ダッシュボードを描画します。

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
├── src/
│   ├── index.html   # HTML構造 + インラインCSS
│   └── index.js     # データ取得・計算・D3チャート描画・アラート判定
├── .env             # FRED APIキー（git管理外）
├── .env.example     # .envのテンプレート
├── vite.config.js   # Vite設定
└── package.json
```
