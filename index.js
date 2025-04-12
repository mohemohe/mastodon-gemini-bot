require('dotenv').config();
const generator = require('megalodon');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

// 投稿取得元の環境変数の取得と検証
const SOURCE_BASE_URL = process.env.MASTODON_BASE_URL || '';
const SOURCE_ACCESS_TOKEN = process.env.MASTODON_ACCESS_TOKEN || '';
const SOURCE_USERNAME = process.env.MASTODON_USERNAME || '';

// 投稿先Botアカウントの環境変数
const BOT_BASE_URL = process.env.BOT_BASE_URL || '';
const BOT_ACCESS_TOKEN = process.env.BOT_ACCESS_TOKEN || '';
const BOT_POST_ENABLED = (process.env.BOT_POST_ENABLED || 'false').toLowerCase() === 'true';

// Gemini APIの環境変数
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-pro';

// 履歴の保持件数
const HISTORY_LIMIT = parseInt(process.env.HISTORY_LIMIT || '5', 10);

// アカウントIDキャッシュファイルのパス
const CACHE_DIR = path.join(__dirname, 'cache');

// 必要な環境変数が設定されているか確認
function validateEnvVariables() {
  if (!SOURCE_BASE_URL || !SOURCE_ACCESS_TOKEN || !SOURCE_USERNAME || !GEMINI_API_KEY) {
    console.error('エラー: 必要な環境変数が設定されていません。.envファイルを確認してください。');
    return false;
  }

  // 投稿機能を使用する場合は必要な環境変数をチェック
  if (BOT_POST_ENABLED && (!BOT_BASE_URL || !BOT_ACCESS_TOKEN)) {
    console.error('エラー: 投稿機能を有効にするには、BOT_BASE_URLとBOT_ACCESS_TOKENが必要です。');
    return false;
  }
  return true;
}

// Mastodon クライアントの初期化（ソースアカウント用）
function initSourceClient() {
  return generator.default('mastodon', SOURCE_BASE_URL, SOURCE_ACCESS_TOKEN);
}

// Mastodon クライアントの初期化（投稿用Botアカウント用）
function initBotClient() {
  if (BOT_POST_ENABLED) {
    const client = generator.default('mastodon', BOT_BASE_URL, BOT_ACCESS_TOKEN);
    console.log('Bot投稿機能が有効になっています');
    return client;
  }
  return null;
}

// ユーザー名からアカウントIDを解決する関数
async function resolveAccountId(username, sourceClient) {
  try {
    // @から始まる場合は@を取り除く
    const cleanUsername = username.startsWith('@') 
      ? username.substring(1) 
      : username;
    
    console.log(`ユーザー名 '${cleanUsername}' からアカウントIDを取得します...`);
    
    // ユーザー名の形式をチェック
    const isRemoteUser = cleanUsername.includes('@');
    const searchQuery = isRemoteUser ? cleanUsername : `@${cleanUsername}`;
    
    // 検索エンドポイントを使用して検索
    const res = await sourceClient.search(searchQuery, { type: 'accounts', limit: 10 });
    const accounts = res.data.accounts;
    
    if (accounts.length === 0) {
      throw new Error(`ユーザー名 '${cleanUsername}' に一致するアカウントが見つかりませんでした`);
    }
    
    // 完全一致または部分一致でアカウントを検索
    const exactMatch = accounts.find(account => {
      const acct = account.acct.toLowerCase();
      const username = account.username.toLowerCase();
      const cleanUsernameL = cleanUsername.toLowerCase();
      
      // リモートユーザーの場合は完全一致のみ
      if (isRemoteUser) {
        return acct === cleanUsernameL;
      }
      
      // ローカルユーザーの場合は、リモートユーザーを除外してから検索
      if (acct.includes('@')) {
        return false; // リモートユーザーはスキップ
      }
      return acct === cleanUsernameL || username === cleanUsernameL;
    });
    
    if (exactMatch) {
      console.log(`ユーザー名 '${cleanUsername}' のアカウントIDは '${exactMatch.id}' です`);
      return exactMatch.id;
    }
    
    // 完全一致がなければ最初の結果を使用
    console.log(`注意: '${cleanUsername}' の完全一致が見つからなかったため、最も関連性の高い結果を使用します: ${accounts[0].acct} (ID: ${accounts[0].id})`);
    return accounts[0].id;
  } catch (error) {
    console.error('アカウントIDの解決中にエラーが発生しました:', error);
    throw new Error(`ユーザー名 '${username}' からアカウントIDを取得できませんでした`);
  }
}

// Botアカウントから投稿する関数
async function postToBot(text, botClient) {
  if (!BOT_POST_ENABLED || !botClient) {
    console.log('Bot投稿機能が無効になっているため、投稿はスキップされました');
    return null;
  }
  
  try {
    console.log('生成されたテキストをBotアカウントから投稿します...');
    const response = await botClient.postStatus(text, { visibility: 'public' });
    console.log(`投稿が完了しました: ${response.data.url}`);
    return response.data;
  } catch (error) {
    console.error('投稿中にエラーが発生しました:', error);
    return null;
  }
}

// キャッシュディレクトリの確認と作成
function ensureCacheDirectory() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    console.log(`キャッシュディレクトリを作成しました: ${CACHE_DIR}`);
  }
}

// キャッシュから投稿を読み込む関数
function loadStatusesFromCache(STATUSES_CACHE_FILE) {
  try {
    if (fs.existsSync(STATUSES_CACHE_FILE)) {
      const data = fs.readFileSync(STATUSES_CACHE_FILE, 'utf8');
      const cachedData = JSON.parse(data);
      console.log(`キャッシュから${cachedData.statuses.length}件の投稿を読み込みました`);
      return { 
        statuses: cachedData.statuses,
        latest_id: cachedData.latest_id
      };
    }
  } catch (error) {
    console.error('キャッシュの読み込み中にエラーが発生しました:', error);
  }
  return { statuses: [], latest_id: null };
}

// キャッシュに投稿を保存する関数
function saveStatusesToCache(statuses, latest_id, STATUSES_CACHE_FILE, LATEST_ID_CACHE_FILE) {
  try {
    const data = JSON.stringify({ 
      statuses: statuses,
      latest_id: latest_id,
      updated_at: new Date().toISOString()
    }, null, 2);
    fs.writeFileSync(STATUSES_CACHE_FILE, data, 'utf8');
    console.log(`${statuses.length}件の投稿をキャッシュに保存しました`);
    
    // 最新のIDも別のファイルに保存（簡易アクセス用）
    fs.writeFileSync(LATEST_ID_CACHE_FILE, JSON.stringify({ latest_id: latest_id }, null, 2), 'utf8');
  } catch (error) {
    console.error('キャッシュの保存中にエラーが発生しました:', error);
  }
}

// 最新の投稿IDを取得する関数
async function fetchLatestStatusId(accountId, sourceClient) {
  try {
    const res = await sourceClient.getAccountStatuses(accountId, { limit: 1 });
    const statuses = res.data;
    
    if (statuses.length > 0) {
      return statuses[0].id;
    }
    return null;
  } catch (error) {
    console.error('最新の投稿ID取得中にエラーが発生しました:', error);
    return null;
  }
}

// 新しい投稿を取得する関数
async function fetchNewStatuses(accountId, since_id, sourceClient) {
  console.log(`ID: ${since_id} より新しい投稿を取得します...`);
  
  let allNewStatuses = [];
  let maxId = null;
  const limit = 40; // 1リクエストあたりの最大投稿数
  
  while (true) {
    try {
      const options = { 
        limit: limit,
        since_id: since_id
      };
      
      if (maxId) {
        options.max_id = maxId;
      }
      
      const res = await sourceClient.getAccountStatuses(accountId, options);
      const statuses = res.data;
      
      if (statuses.length === 0) {
        break;
      }
      
      // 投稿からテキスト内容のみを抽出して配列に追加
      const statusTexts = statuses
        .filter(status => !status.reblog) // リブログは除外
        .filter(status => status.visibility === 'public') // publicのみを対象にする
        .map(status => {
          // HTML要素を除去してプレーンテキストだけを取得
          const text = status.content.replace(/<[^>]*>/g, '');
          return text;
        })
        .filter(text => text.trim().length > 0); // 空のテキストを除外
      
      allNewStatuses = allNewStatuses.concat(statusTexts);
      console.log(`${allNewStatuses.length}件の新しい投稿を取得しました`);
      
      // 次のページ用にmaxIdを設定
      maxId = statuses[statuses.length - 1].id;
      
    } catch (error) {
      console.error('投稿の取得中にエラーが発生しました:', error);
      break;
    }
  }
  
  return allNewStatuses;
}

// アカウントの投稿を取得する関数（キャッシュ対応版）
async function fetchAccountStatuses(accountId, sourceClient) {
  console.log('投稿の取得を開始します...');
  
  // キャッシュファイルのパスを設定
  const STATUSES_CACHE_FILE = path.join(CACHE_DIR, `statuses_${accountId}.json`);
  const LATEST_ID_CACHE_FILE = path.join(CACHE_DIR, `latest_id_${accountId}.json`);
  
  // キャッシュディレクトリの確認
  ensureCacheDirectory();
  
  // キャッシュからデータを読み込む
  const cachedData = loadStatusesFromCache(STATUSES_CACHE_FILE);
  let allStatuses = cachedData.statuses;
  let cachedLatestId = cachedData.latest_id;
  
  // 最新の投稿IDを取得
  const latestId = await fetchLatestStatusId(accountId, sourceClient);
  
  if (!latestId) {
    console.error('最新の投稿IDを取得できませんでした');
    if (allStatuses.length > 0) {
      console.log('キャッシュされた投稿を使用します');
      return allStatuses;
    }
    return [];
  }
  
  // キャッシュがない場合、または最新IDが更新されている場合は新しい投稿を取得
  if (allStatuses.length === 0 || cachedLatestId !== latestId) {
    if (allStatuses.length === 0) {
      console.log('キャッシュがないため、最初から投稿を取得します');
      
      // キャッシュがない場合は全件取得
      let maxId = null;
      const limit = 40; // 1リクエストあたりの最大投稿数
      
      // 最大3000件の投稿を取得するまでループ
      while (allStatuses.length < 3000) {
        try {
          const options = { limit: limit };
          if (maxId) {
            options.max_id = maxId;
          }
          
          const res = await sourceClient.getAccountStatuses(accountId, options);
          const statuses = res.data;
          
          if (statuses.length === 0) {
            console.log('これ以上の投稿はありません');
            break;
          }
          
          // 投稿からテキスト内容のみを抽出して配列に追加
          const statusTexts = statuses
            .filter(status => !status.reblog) // リブログは除外
            .filter(status => status.visibility === 'public') // publicのみを対象にする
            .map(status => {
              // HTML要素を除去してプレーンテキストだけを取得
              const text = status.content.replace(/<[^>]*>/g, '');
              return text;
            })
            .filter(text => text.trim().length > 0); // 空のテキストを除外
          
          allStatuses = allStatuses.concat(statusTexts);
          console.log(`${allStatuses.length}件の投稿を取得しました`);
          
          // 次のページ用にmaxIdを設定
          maxId = statuses[statuses.length - 1].id;
          
        } catch (error) {
          console.error('投稿の取得中にエラーが発生しました:', error);
          break;
        }
      }
    } else {
      console.log('新しい投稿が見つかりました。キャッシュを更新します');
      // キャッシュがあり、新しい投稿がある場合は差分だけを取得
      const newStatuses = await fetchNewStatuses(accountId, cachedLatestId, sourceClient);
      
      // 新しい投稿を既存の投稿リストの先頭に追加
      allStatuses = newStatuses.concat(allStatuses);
      console.log(`${newStatuses.length}件の新しい投稿を追加しました`);
    }
    
    // 3000件を超えた場合は切り詰め
    if (allStatuses.length > 3000) {
      allStatuses = allStatuses.slice(0, 3000);
    }
    
    // 更新されたデータをキャッシュに保存
    saveStatusesToCache(allStatuses, latestId, STATUSES_CACHE_FILE, LATEST_ID_CACHE_FILE);
  } else {
    console.log('新しい投稿はありません。キャッシュを使用します');
  }
  
  console.log(`取得完了: 合計${allStatuses.length}件の投稿を使用します`);
  return allStatuses;
}

// 履歴ファイルのパスを取得する関数
function getHistoryFilePath(accountId) {
  return path.join(CACHE_DIR, `history_${accountId}.json`);
}

// 履歴ファイルの確認と作成
function ensureHistoryFile(accountId) {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  const historyFile = getHistoryFilePath(accountId);
  if (!fs.existsSync(historyFile)) {
    fs.writeFileSync(historyFile, JSON.stringify({ history: [] }, null, 2));
  }
}

// 履歴を読み込む関数
function loadHistory(accountId) {
  try {
    const historyFile = getHistoryFilePath(accountId);
    const data = fs.readFileSync(historyFile, 'utf8');
    return JSON.parse(data).history;
  } catch (error) {
    console.error('履歴の読み込み中にエラーが発生しました:', error);
    return [];
  }
}

// 履歴を保存する関数
function saveHistory(text, accountId) {
  try {
    const history = loadHistory(accountId);
    history.unshift({
      text: text,
      timestamp: new Date().toISOString()
    });
    
    // 設定された件数まで保持
    const trimmedHistory = history.slice(0, HISTORY_LIMIT);
    const historyFile = getHistoryFilePath(accountId);
    fs.writeFileSync(historyFile, JSON.stringify({ history: trimmedHistory }, null, 2));
  } catch (error) {
    console.error('履歴の保存中にエラーが発生しました:', error);
  }
}

// Geminiモデルを使って文章を生成する関数
async function generateTextWithGemini(statuses, accountId) {
  const MAX_RETRIES = 10;
  let retryCount = 0;
  
  // 履歴の初期化
  ensureHistoryFile(accountId);
  const history = loadHistory(accountId);
  
  while (retryCount < MAX_RETRIES) {
    try {
      console.log('Geminiを使用して文章を生成します...');
      
      // ステータスの内容を結合して、シンプルなコーパスを作成
      const statusesText = statuses.join('\n\n');
      
      // 履歴の内容を結合
      const historyText = history.map(h => h.text).join('\n\n');
      
      // Geminiモデルの設定
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
      
      // プロンプトの作成
      const prompt = `
以下の文章は、あるMastodonユーザーの過去の投稿の集まりです。
これらの投稿の文体と内容を学習して、そのユーザーが書きそうな新しい投稿を1つ生成してください。

以下の点に注意してください：
- 生成する文章は、1文のみで、短すぎず長すぎず、元の投稿と同じような雰囲気を持ち、自然に見えるようにしてください
- 装飾やメタ情報は含めず、純粋に投稿文のみを出力してください
- 文末の句点「。」は省いてください
- 以下の「最近生成された投稿」と似た内容は生成しないでください

参考投稿:
${statusesText}

最近生成された投稿:
${historyText}
`;

      // 生成の実行
      const result = await model.generateContent(prompt);
      const response = result.response;
      let generatedText = response.text().trim();
      
      // 末尾の連続した改行を削除
      generatedText = generatedText.replace(/[\r\n]+$/, '');
      
      // 履歴に保存
      saveHistory(generatedText, accountId);
      
      // #botタグを追加
      generatedText = generatedText + ' #bot';
      
      return generatedText;
    } catch (error) {
      if (error.message.includes('RECITATION') && retryCount < MAX_RETRIES - 1) {
        retryCount++;
        console.log(`RECITATIONエラーが発生しました。リトライします (${retryCount}/${MAX_RETRIES})`);
        // 少し待機してからリトライ
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      console.error('文章生成中にエラーが発生しました:', error);
      return null;
    }
  }
  
  console.error(`最大リトライ回数(${MAX_RETRIES}回)に達しました`);
  return null;
}

// メイン処理を行う関数
async function runMain() {
  try {
    // 環境変数の検証
    if (!validateEnvVariables()) {
      process.exit(1);
    }
    
    // クライアントの初期化
    const sourceClient = initSourceClient();
    const botClient = initBotClient();
    
    // ユーザー名からアカウントIDを解決
    const accountId = await resolveAccountId(SOURCE_USERNAME, sourceClient);
    
    // 投稿の取得
    const statuses = await fetchAccountStatuses(accountId, sourceClient);
    
    if (statuses.length === 0) {
      console.log('投稿が見つかりませんでした。プログラムを終了します。');
      return;
    }
    
    // 文章の生成
    const generatedText = await generateTextWithGemini(statuses, accountId);
    
    if (generatedText) {
      console.log('\n===== 生成された文章 =====\n');
      console.log(generatedText);
      console.log('\n=========================\n');
      
      // Botアカウントで投稿
      if (BOT_POST_ENABLED) {
        await postToBot(generatedText, botClient);
      }
    } else {
      console.log('文章を生成できませんでした。');
    }
  } catch (error) {
    console.error('エラーが発生しました:', error);
  }
}

// モジュールとしてエクスポートする場合は関数をエクスポート
module.exports = {
  runMain
};

// ファイルが直接実行された場合はmain関数を実行
if (require.main === module) {
  runMain();
} 