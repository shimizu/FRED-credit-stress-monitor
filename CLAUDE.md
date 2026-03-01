# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

FRED APIを使った信用市場ストレスモニターダッシュボード（Credit Stress Monitor）。
米国ハイイールド債のOAS（Option-Adjusted Spread）を格付け別に可視化し、信用ストレスのシグナルを自動判定する単一ページアプリケーション。

## 開発コマンド

- **開発サーバー起動**: `npm run dev`（自動でブラウザが開く）
- **本番ビルド**: `npm run build`（出力先: `dist/`）
- **プレビュー**: `npm run preview`
- **デプロイ**: `npm run deploy`（GitHub Pages via gh-pages）

テストやリンターは未導入。

## アーキテクチャ

### Vite設定の注意点
- **rootは`src/`ディレクトリ**（`vite.config.js`で`root: 'src'`指定）
- エントリーポイントは`src/index.html`（プロジェクトルートではない）
- `base: "./"` で相対パスビルド
- publicディレクトリは`../public`

### ファイル構成
- `src/index.html` — HTML構造＋全CSSがインライン`<style>`タグ内に記述
- `src/index.js` — 全ロジック（データ取得、計算、D3チャート描画、アラート判定）
- `src/index.scss` — 未使用（テンプレートの残骸）

### 技術スタック
- **D3.js v7** — CDN経由で読み込み（`<script src="...d3.min.js">`）、npmパッケージではない
- **Vite** — バンドラー・開発サーバー
- **@vitejs/plugin-legacy** — レガシーブラウザ対応

### データフロー
1. ユーザーがFRED APIキーを入力して`FETCH DATA`クリック
2. `fetchSeries()`が5つのFREDシリーズを並列取得（`BAMLH0A0HYM2`等）
3. グローバル変数`allData`にシリーズ別データを格納
4. `renderAll()`が全チャート・メトリクス・アラートを一括再描画

### 主要な計算ロジック（`src/index.js`）
- `change20d()` — 20営業日変化幅（bps）
- `rollingChange()` — ローリング変化幅
- `spreadDiff()` — CCC-BBスプレッド差
- `rollingCorrelation()` — 30日ローリング相関
- `sigma()` — 1年（252日）のZスコア

### シグナル判定基準
- **US HY OAS**: >5%=WARN, >7%=ALERT
- **CCC-BBスプレッド差**: >1σ=WARN, >2σ=ALERT
- **20日変化幅**: >50bps=WARN, >100bps=ALERT
- **US-EM相関**: >0.6=ELEVATED, >0.8かつ両方拡大=SYSTEMIC

## 言語・コミット規約
- コミットメッセージ・コメント・ドキュメントは日本語で記述
- コミットプレフィックス: `feat:`, `fix:`, `docs:`, `refactor:`, `perf:`, `test:`, `chore:`, `style:`
