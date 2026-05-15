# 「ル」メモ管理アプリ

Notion上の「ル」メモデータベースを管理するReactアプリです。  
**Vercelにデプロイして使うことを前提に設計されています。**

## 機能

- **追加** — 言葉・読み方・意味を入力。頭文字で自動的に正しい行のDBへ振り分け
- **検索** — 全DBをまたいで「言葉」「読み方」でキーワード検索
- **一覧** — 行ごとにデータ閲覧
- **削除** — エントリをNotionからアーカイブ

## Vercelへのデプロイ手順

### 1. Notion Integration の作成

1. [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations) を開く
2. 「新しいインテグレーション」を作成
3. **Internal Integration Token**（`secret_xxx...`）をコピーしておく
4. 対象のNotionデータベースページを開き、右上「…」→「コネクト」→作成したIntegrationを追加

### 2. GitHubにプッシュ

```bash
git init
git add .
git commit -m "initial commit"
gh repo create notion-memo-app --public --push
# または GitHub上でリポジトリ作成後:
# git remote add origin https://github.com/<your-name>/notion-memo-app.git
# git push -u origin main
```

### 3. Vercelにデプロイ

1. [https://vercel.com](https://vercel.com) にGitHubでサインイン
2. 「Add New Project」→ GitHubリポジトリを選択
3. そのまま「Deploy」（設定不要、vercel.jsonが自動で読まれる）

### 4. アプリを開く

デプロイ完了後、発行されたURL（例: `https://notion-memo-app.vercel.app`）を開く。  
ログイン画面でNotion Integration Tokenを入力して接続。

---

## 仕組み（CORSを回避する方法）

ブラウザから直接Notion APIを叩くとCORSエラーになるため、  
`api/notion.js`（Vercel Serverless Function）がサーバー側でNotion APIと通信します。

```
ブラウザ → /api/notion?path=... → Vercel Function → api.notion.com
```

## 自動分類ルール

| 言葉の頭文字 | 追加先DB |
|---|---|
| あ〜お / ア〜オ | あ行 |
| か〜ご / カ〜ゴ | か行 |
| さ〜ぞ / サ〜ゾ | さ行 |
| た〜ど・な〜の | た・な行 |
| は〜ぽ / ハ〜ポ | は行 |
| ま〜も・や〜よ | ま・や行 |
| ら〜ろ・わ〜ん | ら・わ行 |
| 英字・数字・その他 | あ行（デフォルト） |

## ローカルでの動作確認

Vercel CLIを使うとローカルでもServerless Functionが動きます：

```bash
npm install -g vercel
vercel dev
```

`http://localhost:3000` で開いて動作確認できます。
