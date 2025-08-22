# Mastodon AI Bot

Mastodonアカウントの投稿履歴を取得し、AIを使って新しい投稿文を生成するツールです。  
Google Gemini AIとローカルLLM（LM Studio）の両方に対応しています。

※ 人間注: このbotは Cursor と Claude 3.7 Sonnet, Claude 4 Sonnet, Claude 4 Opus のどれかによって全てのコードが生成されています。

## 機能

- Mastodonの特定アカウントから最大3000件の投稿を取得
- 公開投稿（public）のみを対象とし、非公開や限定公開の投稿は除外
- 投稿データをローカルにJSONとしてキャッシュし、効率的に再利用
- 新しい投稿があった場合のみAPIからデータを取得して更新
- **複数のAIプロバイダーに対応**:
  - Google Gemini AI（クラウド）
  - Groq（高速推論、クラウド）
  - LM Studio（ローカルLLM、プライバシー重視）
- そのアカウントの文体や内容を模倣した新しい投稿を生成
- 生成結果をコンソールに表示
- 別のBotアカウントを使用して生成した文章を自動投稿
- ユーザー名からアカウントIDを自動解決（リモートユーザーも対応）
- 使用するAIモデルを環境変数で柔軟に設定可能
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

   # AIプロバイダー選択
   LLM_PROVIDER=gemini                     # "gemini"、"groq"、または "lmstudio" を選択

   # Google Gemini設定（LLM_PROVIDER=geminiの場合）
   GEMINI_API_KEY=your_gemini_api_key      # Google Gemini APIキー
   GEMINI_MODEL=gemini-2.5-flash           # 使用するGeminiモデル（デフォルト: gemini-2.5-flash）

   # Groq設定（LLM_PROVIDER=groqの場合）
   GROQ_API_KEY=your_groq_api_key               # Groq APIキー
   GROQ_MODEL=llama-3.3-70b-versatile          # 使用するGroqモデル（デフォルト: llama-3.3-70b-versatile）

   # LM Studio設定（LLM_PROVIDER=lmstudioの場合）
   LM_STUDIO_BASE_URL=http://localhost:1234/v1  # LM StudioのAPIエンドポイント
   LM_STUDIO_MODEL=your-local-model-name        # ロードしたモデル名
   LM_STUDIO_API_KEY=lm-studio                  # APIキー（通常は"lm-studio"で固定）

   # 定期実行設定
   CRON_SCHEDULE=0,20,40 * * * *                 # cron形式で実行間隔を指定（例: 毎時0分から20分ごとに実行）
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

### AIプロバイダーの選択

`LLM_PROVIDER`環境変数で使用するAIプロバイダーを選択できます：

- `gemini`: Google Gemini AI（クラウドベース、APIキー必要）
- `groq`: Groq（高速推論に特化したクラウドベース、APIキー必要）
- `lmstudio`: LM Studio（ローカルLLM、プライバシー重視）

### Geminiモデルの設定

`LLM_PROVIDER=gemini`の場合、以下のようなモデルを指定できます：

- `gemini-2.0-flash`: テキスト生成に最適化されたモデル（デフォルト）
- `gemini-2.5-pro`: 最新バージョンのテキスト生成モデル
- `gemini-pro-vision`: 画像入力もサポートするモデル（このアプリでは使用しません）

モデルを指定しない場合は自動的に `gemini-pro` が使用されます。

### Groqの設定

`LLM_PROVIDER=groq`の場合、以下のようなモデルを指定できます：

- `llama-3.3-70b-versatile`: 汎用的な高性能モデル（デフォルト）
- `llama-3.1-70b-versatile`: Llama 3.1ベースの汎用モデル
- `llama-3.1-8b-instant`: 高速応答に最適化された軽量モデル
- `mixtral-8x7b-32768`: Mixtralベースの高性能モデル
- `gemma2-9b-it`: Google Gemma 2ベースのモデル

**Groqの利点：**
- 業界最速クラスの推論速度
- 高品質なオープンソースモデルを利用可能
- シンプルなAPIインターフェース
- 競争力のある価格設定

Groq APIキーは[Groq Console](https://console.groq.com/)から取得できます。

### LM Studioの設定

`LLM_PROVIDER=lmstudio`の場合、以下の手順でLM Studioを設定してください：

1. [LM Studio](https://lmstudio.ai)をダウンロード・インストール
2. 好みのモデルをダウンロード（例: Llama 3.1, Mistral, CodeLlama等）
3. モデルをロードし、Local Serverを起動
4. デフォルトでは `http://localhost:1234` でAPIサーバーが起動
5. `.env`ファイルで以下を設定：
   - `LM_STUDIO_BASE_URL`: APIエンドポイント（通常 `http://localhost:1234/v1`）
   - `LM_STUDIO_MODEL`: ロードしたモデル名（LM Studioで確認）
   - `LM_STUDIO_API_KEY`: 通常は `lm-studio` で固定

**LM Studioの利点：**
- データがローカルで処理されるためプライバシーが保護される
- インターネット接続不要で動作
- 様々なオープンソースモデルが利用可能
- API料金がかからない

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
- `CRON_SCHEDULE=0,20,40 * * * *` - 毎時0分から20分ごと（デフォルト）

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
- **Gemini使用時**: APIキーには料金が発生する可能性があります。Google Cloud Platformの料金体系を確認してください。
- **Groq使用時**: 
  - APIキーには料金が発生する可能性があります
  - レート制限があるため、頻繁な実行には注意が必要です
  - 無料プランでは1分あたりのリクエスト数に制限があります
- **LM Studio使用時**: 
  - ローカルマシンのリソース（CPU/GPU/メモリ）を大量に使用します
  - モデルサイズに応じて十分なストレージ容量を確保してください
  - 初回モデルダウンロード時は時間がかかります
- Bot投稿を有効にする場合は、適切な頻度で実行してください。過度な投稿頻度はサーバーポリシーに違反する可能性があります。
- Docker環境では、`cache`ディレクトリがホストマシンにマウントされるため、コンテナを再起動してもキャッシュデータは保持されます。