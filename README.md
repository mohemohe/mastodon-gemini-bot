# Mastodon Gemini Bot

Mastodonアカウントの投稿履歴を取得し、Google Gemini AIを使って新しい投稿文を生成するツールです。

※ 人間注: このbotはCursorとClaude 3.7 Sonnetによって全てのコードが生成されています。

## 機能

- Mastodonの特定アカウントから最大3000件の投稿を取得
- 公開投稿（public）のみを対象とし、非公開や限定公開の投稿は除外
- 投稿データをローカルにJSONとしてキャッシュし、効率的に再利用
- 新しい投稿があった場合のみAPIからデータを取得して更新
- Google Gemini AIを使用してそのアカウントの文体や内容を模倣した新しい投稿を生成
- 生成結果をコンソールに表示
- 別のBotアカウントを使用して生成した文章を自動投稿
- ユーザー名からアカウントIDを自動解決（リモートユーザーも対応）
- 使用するGeminiモデルを環境変数で柔軟に設定可能
- 指定した時間間隔で定期実行可能（node-cronによる内部スケジューリング）
- Docker Composeで簡単に実行が可能

## 準備

1. Node.jsをインストール（バージョン18以上推奨）またはDockerをインストール
2. 必要なパッケージをインストール（通常実行の場合）：
   ```
   npm install
   ```
3. `.env`ファイルを設定：
   ```
   # 投稿取得元Mastodon設定
   MASTODON_BASE_URL=https://example.com   # MastodonインスタンスのベースURL（例：https://mastodon.social）
   MASTODON_ACCESS_TOKEN=your_access_token # 投稿取得元アカウントのアクセストークン
   MASTODON_USERNAME=username              # 取得対象のユーザー名（例: foobar または @foobar）

   # 投稿先Botアカウント設定
   BOT_BASE_URL=https://example.com        # Botアカウントが存在するインスタンスのURL
   BOT_ACCESS_TOKEN=your_bot_access_token  # Botアカウントのアクセストークン
   BOT_POST_ENABLED=true                   # 投稿機能の有効/無効 (true/false)

   # Google Gemini設定
   GEMINI_API_KEY=your_gemini_api_key      # Google Gemini APIキー
   GEMINI_MODEL=gemini-pro                 # 使用するGeminiモデル（デフォルト: gemini-pro）

   # 定期実行設定
   CRON_SCHEDULE=0/20 * * * *                 # cron形式で実行間隔を指定（例: 毎時0分から20分ごとに実行）
   ```

### アクセストークンの取得方法

1. Mastodonにログイン
2. 設定 > 開発 > 新規アプリケーション から新しいアプリケーションを作成
3. スコープは以下を選択：
   - 取得元アカウントの場合: 「read:statuses」
   - Bot投稿アカウントの場合: 「write:statuses」
4. 作成後、表示されるアクセストークンをコピー

### ユーザー名の指定方法

ユーザー名は以下の形式で指定できます：

- 同じインスタンス内のユーザー: `username` または `@username`
- リモートインスタンスのユーザー: `username@example.com` または `@username@example.com`

検索機能を使用してユーザーを特定するため、部分一致でも動作する場合があります。

### Geminiモデルの設定

以下のようなモデルを指定できます：

- `gemini-2.0-flash`: テキスト生成に最適化されたモデル（デフォルト）
- `gemini-2.5-pro`: 最新バージョンのテキスト生成モデル
- `gemini-pro-vision`: 画像入力もサポートするモデル（このアプリでは使用しません）

モデルを指定しない場合は自動的に `gemini-2.0-flash` が使用されます。

### Bot投稿の設定

投稿機能は以下の方法で制御できます：

- `BOT_POST_ENABLED=true`: 投稿機能を有効化（生成したテキストを自動的にBotアカウントから投稿）
- `BOT_POST_ENABLED=false`: 投稿機能を無効化（生成したテキストはコンソールにのみ表示）

投稿元アカウントと投稿先Botアカウントは別々に管理できるため、異なるインスタンスにそれぞれを設定することも可能です。

### 定期実行の設定

定期実行は内部でnode-cronを使用しており、標準的なcron形式で指定できます：

- `CRON_SCHEDULE=0 * * * *` - 毎時0分（1時間ごと）
- `CRON_SCHEDULE=0 */2 * * *` - 2時間ごと
- `CRON_SCHEDULE=0 0 * * *` - 毎日0時（日次）
- `CRON_SCHEDULE=0 9,18 * * *` - 毎日9時と18時
- `CRON_SCHEDULE=*/30 * * * *` - 30分ごと
- `CRON_SCHEDULE=0/20 * * * *` - 毎時0分から20分ごと（デフォルト）

cron式の書式は `分 時 日 月 曜日` の順です。

## 使い方

### 通常実行（Node.js）

単発実行：

```
npm start
```

または

```
node index.js
```

定期実行：

```
npm run cron
```

または

```
node cron.js
```

### Docker Composeでの実行

```
docker-compose up --build
```

または

```
docker-compose up -d
```

バックグラウンドで実行する場合は `-d` オプションを追加してください。

Docker環境では常に`cron.js`で実行され、`.env`ファイルの`CRON_SCHEDULE`で指定した間隔で自動実行されます。初回起動時には即座に1回実行され、その後定期的に実行されます。

実行間隔を変更するには、`.env`ファイルの`CRON_SCHEDULE`の値を編集してください。

実行すると、以下の処理が行われます：

1. 指定されたユーザー名からアカウントIDを検索・変換
2. キャッシュデータがあるか確認
3. 最新の投稿IDを取得して、キャッシュと比較
4. 新しい投稿がある場合のみ差分を取得して更新
5. キャッシュがない初回実行時は最大3000件の投稿を取得
6. Gemini AIによる生成結果がコンソールに表示
7. 設定に応じて、生成した文章をBotアカウントから投稿
8. 指定された間隔で上記処理を繰り返し

## キャッシュについて

投稿データは `cache/` ディレクトリに保存され、次回実行時に再利用されます。これにより：

- APIリクエスト回数を削減
- 実行時間を短縮
- サーバーへの負荷を軽減

最新の投稿IDを保持しているため、新しい投稿がある場合のみAPIから差分を取得します。

## 注意事項

- APIの制限に注意してください。
- 大量の投稿を取得する場合は、Mastodonインスタンスへの負荷に配慮してください。
- Gemini APIキーには料金が発生する可能性があります。Google Cloud Platformの料金体系を確認してください。
- Bot投稿を有効にする場合は、適切な頻度で実行してください。過度な投稿頻度はサーバーポリシーに違反する可能性があります。
- Docker環境では、`cache`ディレクトリがホストマシンにマウントされるため、コンテナを再起動してもキャッシュデータは保持されます。