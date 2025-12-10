FROM node:22-slim

WORKDIR /app

# パッケージ依存関係のコピーとインストール
COPY package*.json ./
COPY .npmrc ./
RUN npm ci

# アプリケーションコードのコピー
COPY . .

# アプリケーション実行ユーザーの設定
USER node

# アプリケーションの実行（cron.jsを使用）
CMD ["npm", "run", "cron"] 