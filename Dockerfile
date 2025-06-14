FROM node:22-slim

WORKDIR /app

# パッケージ依存関係のコピーとインストール
COPY package*.json ./
RUN npm install

# アプリケーションコードのコピー
COPY . .

# アプリケーション実行ユーザーの設定
USER node

# アプリケーションの実行（cron.jsを使用）
CMD ["npm", "run", "cron"] 