import 'dotenv/config';
import generator from 'megalodon';
import type { MegalodonInterface } from 'megalodon';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatGroq } from '@langchain/groq';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import fs from 'node:fs';
import path from 'node:path';
import { GeneratedTextSchema } from './structure';

// 投稿取得元の環境変数の取得と検証
const SOURCE_BASE_URL = process.env.MASTODON_BASE_URL || '';
const SOURCE_ACCESS_TOKEN = process.env.MASTODON_ACCESS_TOKEN || '';
const SOURCE_USER_ID = process.env.MASTODON_USER_ID || '';
const SOURCE_USERNAME = process.env.MASTODON_USERNAME || '';

// 投稿先Botアカウントの環境変数
const BOT_BASE_URL = process.env.BOT_BASE_URL || '';
const BOT_ACCESS_TOKEN = process.env.BOT_ACCESS_TOKEN || '';
const BOT_POST_ENABLED = (process.env.BOT_POST_ENABLED || 'false').toLowerCase() === 'true';

// LLM プロバイダーの設定
const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
const FALLBACK_LLM_PROVIDER = process.env.FALLBACK_LLM_PROVIDER ? process.env.FALLBACK_LLM_PROVIDER.toLowerCase() : '';

// Gemini APIの環境変数
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// LM Studio APIの環境変数
const LM_STUDIO_BASE_URL = process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234/v1';
const LM_STUDIO_MODEL = process.env.LM_STUDIO_MODEL || 'local-model';
const LM_STUDIO_API_KEY = process.env.LM_STUDIO_API_KEY || 'lm-studio';

// Groq APIの環境変数
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

// Anthropic APIの環境変数
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
const ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || '';

// OpenAI APIの環境変数
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || '';

// 履歴の保持件数
const HISTORY_LIMIT = Number.parseInt(process.env.HISTORY_LIMIT || '5', 10);

// 2-pass LLM設定
const TWO_PASS_MODE = (process.env.TWO_PASS_MODE || 'false').toLowerCase() === 'true';
const TWO_PASS_LLM_PROVIDER = process.env.TWO_PASS_LLM_PROVIDER || '';

// Structured Outputs設定
const USE_STRUCTURED_OUTPUTS = (process.env.USE_STRUCTURED_OUTPUTS || 'false') === 'true';

// アカウントIDキャッシュファイルのパス
const CACHE_DIR = path.join(__dirname, 'cache');

function validateEnvVariables(): boolean {
  if (!SOURCE_BASE_URL || !SOURCE_ACCESS_TOKEN) {
    console.error('エラー: MASTODON_BASE_URLまたはMASTODON_ACCESS_TOKENが設定されていません。.envファイルを確認してください。');
    return false;
  }
  if (!SOURCE_USER_ID && !SOURCE_USERNAME) {
    console.error('エラー: MASTODON_USER_IDまたはMASTODON_USERNAMEのいずれかを設定してください。');
    return false;
  }
  
  if (LLM_PROVIDER === 'gemini' && !GEMINI_API_KEY) {
    console.error('エラー: Gemini プロバイダーを使用する場合、GEMINI_API_KEYが必要です。');
    return false;
  }
  
  if (LLM_PROVIDER === 'lmstudio' && !LM_STUDIO_BASE_URL) {
    console.error('エラー: LM Studio プロバイダーを使用する場合、LM_STUDIO_BASE_URLが必要です。');
    return false;
  }
  
  if (LLM_PROVIDER === 'groq' && !GROQ_API_KEY) {
    console.error('エラー: Groq プロバイダーを使用する場合、GROQ_API_KEYが必要です。');
    return false;
  }

  if (LLM_PROVIDER === 'anthropic' && !ANTHROPIC_API_KEY) {
    console.error('エラー: Anthropic プロバイダーを使用する場合、ANTHROPIC_API_KEYが必要です。');
    return false;
  }

  if (LLM_PROVIDER === 'openai' && !OPENAI_API_KEY) {
    console.error('エラー: OpenAI プロバイダーを使用する場合、OPENAI_API_KEYが必要です。');
    return false;
  }

  if (BOT_POST_ENABLED && (!BOT_BASE_URL || !BOT_ACCESS_TOKEN)) {
    console.error('エラー: 投稿機能を有効にするには、BOT_BASE_URLとBOT_ACCESS_TOKENが必要です。');
    return false;
  }
  
  return true;
}

function initSourceClient(): MegalodonInterface {
  return generator('mastodon', SOURCE_BASE_URL, SOURCE_ACCESS_TOKEN);
}

function initBotClient(): MegalodonInterface | null {
  if (BOT_POST_ENABLED) {
    const client = generator('mastodon', BOT_BASE_URL, BOT_ACCESS_TOKEN);
    console.log('Bot投稿機能が有効になっています');
    return client;
  }
  return null;
}

type Account = {
  id: string;
  acct: string;
  username: string;
};

type Status = {
  id: string;
  content: string;
  reblog?: unknown;
  replies_count?: number;
  visibility: string;
  url?: string;
};

function extractPublicStatusTexts(statuses: Status[]): string[] {
  return statuses
    .filter(status => !status.reblog)
    .filter(status => !status.replies_count)
    .filter(status => status.visibility === 'public' || status.visibility === 'unlisted')
    .map(status => status.content.replace(/<[^>]*>/g, ''))
    .filter(text => !text.startsWith('@'))
    .filter(text => text.trim().length > 0);
}

async function resolveAccountId(username: string, sourceClient: MegalodonInterface): Promise<string> {
  try {
    const cleanUsername = username.startsWith('@') ? username.substring(1) : username;
    console.log(`ユーザー名 '${cleanUsername}' からアカウントIDを取得します...`);
    const isRemoteUser = cleanUsername.includes('@');
    const searchQuery = isRemoteUser ? cleanUsername : `@${cleanUsername}`;
    const res = await sourceClient.search(searchQuery, { type: 'accounts', limit: 10 });
    const accounts: Account[] = res.data.accounts;
    if (accounts.length === 0) {
      throw new Error(`ユーザー名 '${cleanUsername}' に一致するアカウントが見つかりませんでした`);
    }
    const exactMatch = accounts.find(account => {
      const acct = account.acct.toLowerCase();
      const uname = account.username.toLowerCase();
      const cleanUsernameL = cleanUsername.toLowerCase();
      if (isRemoteUser) {
        return acct === cleanUsernameL;
      }
      if (acct.includes('@')) {
        return false;
      }
      return acct === cleanUsernameL || uname === cleanUsernameL;
    });
    if (exactMatch) {
      console.log(`ユーザー名 '${cleanUsername}' のアカウントIDは '${exactMatch.id}' です`);
      return exactMatch.id;
    }
    console.log(`注意: '${cleanUsername}' の完全一致が見つからなかったため、最も関連性の高い結果を使用します: ${accounts[0].acct} (ID: ${accounts[0].id})`);
    return accounts[0].id;
  } catch (error: unknown) {
    console.error('アカウントIDの解決中にエラーが発生しました:', error);
    throw new Error(`ユーザー名 '${username}' からアカウントIDを取得できませんでした`);
  }
}

async function postToBot(text: string, botClient: MegalodonInterface | null): Promise<unknown> {
  if (!BOT_POST_ENABLED || !botClient) {
    console.log('Bot投稿機能が無効になっているため、投稿はスキップされました');
    return null;
  }
  try {
    console.log('生成されたテキストをBotアカウントから投稿します...');
    const response = await botClient.postStatus(text, { visibility: 'public' });
    const data = response.data as { url?: string };
    console.log(`投稿が完了しました: ${data.url ?? ''}`);
    return data;
  } catch (error: unknown) {
    console.error('投稿中にエラーが発生しました:', error);
    return null;
  }
}

function ensureCacheDirectory(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    console.log(`キャッシュディレクトリを作成しました: ${CACHE_DIR}`);
  }
}

function loadStatusesFromCache(STATUSES_CACHE_FILE: string): { statuses: string[]; latest_id: string | null } {
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
  } catch (error: unknown) {
    console.error('キャッシュの読み込み中にエラーが発生しました:', error);
  }
  return { statuses: [], latest_id: null };
}

function saveStatusesToCache(statuses: string[], latest_id: string, STATUSES_CACHE_FILE: string, LATEST_ID_CACHE_FILE: string): void {
  try {
    const data = JSON.stringify({
      statuses: statuses,
      latest_id: latest_id,
      updated_at: new Date().toISOString()
    }, null, 2);
    fs.writeFileSync(STATUSES_CACHE_FILE, data, 'utf8');
    console.log(`${statuses.length}件の投稿をキャッシュに保存しました`);
    fs.writeFileSync(LATEST_ID_CACHE_FILE, JSON.stringify({ latest_id: latest_id }, null, 2), 'utf8');
  } catch (error: unknown) {
    console.error('キャッシュの保存中にエラーが発生しました:', error);
  }
}

async function fetchLatestStatusId(accountId: string, sourceClient: MegalodonInterface): Promise<string | null> {
  try {
    const res = await sourceClient.getAccountStatuses(accountId, { limit: 1 });
    const statuses: Status[] = res.data;
    if (statuses.length > 0) {
      return statuses[0].id;
    }
    return null;
  } catch (error: unknown) {
    console.error('最新の投稿ID取得中にエラーが発生しました:', error);
    return null;
  }
}

async function fetchNewStatuses(accountId: string, since_id: string, sourceClient: MegalodonInterface): Promise<string[]> {
  console.log(`ID: ${since_id} より新しい投稿を取得します...`);
  let allNewStatuses: string[] = [];
  let maxId: string | null = null;
  const limit = 40;
  while (true) {
    try {
      const options: Record<string, unknown> = {
        limit: limit,
        since_id: since_id
      };
      if (maxId) {
        (options as Record<string, string>).max_id = maxId;
      }
      const res = await sourceClient.getAccountStatuses(accountId, options);
      const statuses: Status[] = res.data;
      if (statuses.length === 0) {
        break;
      }
      const statusTexts = extractPublicStatusTexts(statuses);
      allNewStatuses = allNewStatuses.concat(statusTexts);
      console.log(`${allNewStatuses.length}件の新しい投稿を取得しました`);
      maxId = statuses[statuses.length - 1].id;
    } catch (error: unknown) {
      console.error('投稿の取得中にエラーが発生しました:', error);
      break;
    }
  }
  return allNewStatuses;
}

async function fetchAccountStatuses(accountId: string, sourceClient: MegalodonInterface): Promise<string[]> {
  console.log('投稿の取得を開始します...');
  const STATUSES_CACHE_FILE = path.join(CACHE_DIR, `statuses_${accountId}.json`);
  const LATEST_ID_CACHE_FILE = path.join(CACHE_DIR, `latest_id_${accountId}.json`);
  ensureCacheDirectory();
  const cachedData = loadStatusesFromCache(STATUSES_CACHE_FILE);
  let allStatuses: string[] = cachedData.statuses;
  const cachedLatestId = cachedData.latest_id;
  const latestId = await fetchLatestStatusId(accountId, sourceClient);
  if (!latestId) {
    console.error('最新の投稿IDを取得できませんでした');
    if (allStatuses.length > 0) {
      console.log('キャッシュされた投稿を使用します');
      return allStatuses;
    }
    return [];
  }
  const maxStatuses = Number.parseInt(process.env.MAX_STATUSES || '3000', 10);
  if (allStatuses.length === 0 || cachedLatestId !== latestId) {
    if (allStatuses.length === 0) {
      console.log('キャッシュがないため、最初から投稿を取得します');
      let maxId: string | null = null;
      const limit = 40;
      while (allStatuses.length < maxStatuses) {
        try {
          const options: Record<string, unknown> = { limit: limit };
          if (maxId) {
            (options as Record<string, string>).max_id = maxId;
          }
          const res = await sourceClient.getAccountStatuses(accountId, options);
          const statuses: Status[] = res.data;
          if (statuses.length === 0) {
            console.log('これ以上の投稿はありません');
            break;
          }
          const statusTexts = extractPublicStatusTexts(statuses);
          allStatuses = allStatuses.concat(statusTexts);
          console.log(`${allStatuses.length}件の投稿を取得しました`);
          maxId = statuses[statuses.length - 1].id;
        } catch (error: unknown) {
          console.error('投稿の取得中にエラーが発生しました:', error);
          break;
        }
      }
    } else {
      console.log('新しい投稿が見つかりました。キャッシュを更新します');
      const newStatuses = await fetchNewStatuses(accountId, cachedLatestId as string, sourceClient);
      allStatuses = newStatuses.concat(allStatuses);
      console.log(`${newStatuses.length}件の新しい投稿を追加しました`);
    }
    if (allStatuses.length > maxStatuses) {
      allStatuses = allStatuses.slice(0, maxStatuses);
    }
    saveStatusesToCache(allStatuses, latestId as string, STATUSES_CACHE_FILE, LATEST_ID_CACHE_FILE);
  } else {
    console.log('新しい投稿はありません。キャッシュを使用します');
  }
  if (allStatuses.length > maxStatuses) {
    allStatuses = allStatuses.slice(0, maxStatuses);
  }
  console.log(`取得完了: 合計${allStatuses.length}件の投稿を使用します`);
  return allStatuses;
}

function getHistoryFilePath(accountId: string): string {
  return path.join(CACHE_DIR, `history_${accountId}.json`);
}

function ensureHistoryFile(accountId: string): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  const historyFile = getHistoryFilePath(accountId);
  if (!fs.existsSync(historyFile)) {
    fs.writeFileSync(historyFile, JSON.stringify({ history: [] }, null, 2));
  }
}

function loadHistory(accountId: string): { text: string; timestamp: string }[] {
  try {
    const historyFile = getHistoryFilePath(accountId);
    const data = fs.readFileSync(historyFile, 'utf8');
    return JSON.parse(data || '{}').history || [];
  } catch (error: unknown) {
    console.error('履歴の読み込み中にエラーが発生しました:', error);
    return [];
  }
}

function saveHistory(text: string, accountId: string): void {
  try {
    const history = loadHistory(accountId);
    history.unshift({
      text: text,
      timestamp: new Date().toISOString()
    });
    const trimmedHistory = history.slice(0, HISTORY_LIMIT);
    const historyFile = getHistoryFilePath(accountId);
    fs.writeFileSync(historyFile, JSON.stringify({ history: trimmedHistory }, null, 2));
  } catch (error: unknown) {
    console.error('履歴の保存中にエラーが発生しました:', error);
  }
}

function getSystemPrompt(): string {
  const promptPath = path.join(__dirname, '.systemprompt');
  if (!fs.existsSync(promptPath)) {
    return process.env.SYSTEM_PROMPT || '';
  }
  const prompt = fs.readFileSync(promptPath, 'utf8');
  return prompt;
}

function getSystemPrompt2(): string {
  const promptPath = path.join(__dirname, '.systemprompt2');
  if (!fs.existsSync(promptPath)) {
    return '';
  }
  const prompt = fs.readFileSync(promptPath, 'utf8');
  return prompt;
}

function getFormattedDateTime(): string {
  const now = new Date();
  return now.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).replace(/\//g, '/').replace(/,/g, '');
}

function createLLMModel(provider: string = LLM_PROVIDER): BaseChatModel {
  switch (provider) {
    case 'gemini':
      console.log('Geminiモデルを初期化します...');
      return new ChatGoogleGenerativeAI({
        model: GEMINI_MODEL,
        apiKey: GEMINI_API_KEY,
        temperature: 0.7
      });
    case 'lmstudio':
      console.log('LM Studioモデルを初期化します...');
      return new ChatOpenAI({
        model: LM_STUDIO_MODEL,
        openAIApiKey: LM_STUDIO_API_KEY,
        configuration: {
          baseURL: LM_STUDIO_BASE_URL
        },
        temperature: 0.7
      });
    case 'groq':
      console.log('Groqモデルを初期化します...');
      return new ChatGroq({
        model: GROQ_MODEL,
        apiKey: GROQ_API_KEY,
        temperature: 0.7
      });
    case 'anthropic':
      console.log('Anthropicモデルを初期化します...');
      return new ChatAnthropic({
        model: ANTHROPIC_MODEL,
        apiKey: ANTHROPIC_API_KEY,
        ...(ANTHROPIC_BASE_URL && { configuration: { baseURL: ANTHROPIC_BASE_URL } }),
      });
    case 'openai':
      console.log('OpenAIモデルを初期化します...');
      return new ChatOpenAI({
        model: OPENAI_MODEL,
        openAIApiKey: OPENAI_API_KEY,
        ...(OPENAI_BASE_URL && { configuration: { baseURL: OPENAI_BASE_URL } }),
        temperature: 0.7
      });
    default:
      throw new Error(`サポートされていないLLMプロバイダーです: ${provider}`);
  }
}

async function generateSecondPassText(firstPassText: string): Promise<string | null> {
  const MAX_RETRIES = 10;
  let retryCount = 0;
  let currentProvider = TWO_PASS_LLM_PROVIDER || LLM_PROVIDER;

  const systemPrompt2 = getSystemPrompt2();
  if (!systemPrompt2) {
    console.log('2pass目のシステムプロンプトが見つかりません。1pass目の結果を使用します。');
    return firstPassText;
  }

  while (retryCount < MAX_RETRIES) {
    try {
      console.log(`2pass目: ${currentProvider.toUpperCase()}を使用して1pass目の出力文をさらに処理します...`);
      const model = createLLMModel(currentProvider);

      let generatedText: string;
      if (USE_STRUCTURED_OUTPUTS) {
        console.log('Structured Outputsを使用して生成します...');
        const structuredModel = model.withStructuredOutput(GeneratedTextSchema);
        const result = await structuredModel.invoke([{role:'system', content: systemPrompt2 }, { role: 'user', content: firstPassText }]);
        generatedText = result.generated_text.trim();
      } else {
        const result = await model.invoke([{role:'system', content: systemPrompt2 }, { role: 'user', content: firstPassText }]);
        generatedText = result.content.toString().trim();
      }

      generatedText = generatedText.replace(/[\r\n]+$/, '');
      return generatedText;
    } catch (error: unknown) {
      // Gemini特有のRECITATIONエラーとその他のエラーを区別
      const isRecitationError = error instanceof Error &&
        error.message &&
        error.message.includes('RECITATION');

      if (isRecitationError && retryCount < MAX_RETRIES - 1) {
        retryCount++;
        console.log(`2pass目: RECITATIONエラーが発生しました。リトライします (${retryCount}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      if (retryCount < MAX_RETRIES - 1) {
        retryCount++;
        console.log(`2pass目: 文章生成中にエラーが発生しました。リトライします (${retryCount}/${MAX_RETRIES}):`, error);
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      console.error('2pass目: 文章生成中にエラーが発生しました:', error);

      // 最大リトライ回数に達した場合、フォールバックプロバイダーを試す
      if (FALLBACK_LLM_PROVIDER && currentProvider !== FALLBACK_LLM_PROVIDER) {
        console.log(`\n最大リトライ回数に達しました。フォールバックプロバイダー ${FALLBACK_LLM_PROVIDER.toUpperCase()} に切り替えます...\n`);
        currentProvider = FALLBACK_LLM_PROVIDER;
        retryCount = 0;
        continue;
      }

      return firstPassText; // エラー時は1pass目の結果を返す
    }
  }
  console.error(`2pass目: 最大リトライ回数(${MAX_RETRIES}回)に達しました`);
  return firstPassText; // エラー時は1pass目の結果を返す
}

async function generateTextWithLLM(statuses: string[], accountId: string): Promise<string | null> {
  const MAX_RETRIES = 10;
  let retryCount = 0;
  let currentProvider = LLM_PROVIDER;
  ensureHistoryFile(accountId);

  // 1pass目の処理
  let firstPassText: string | null = null;
  while (retryCount < MAX_RETRIES) {
    try {
      console.log(`1pass目: ${currentProvider.toUpperCase()}を使用して文章を生成します...`);
      const statusesText = JSON.stringify(statuses);
      const model = createLLMModel(currentProvider);
      const prompt = `\n#前提情報\n今日は${getFormattedDateTime()}です。\n\n${getSystemPrompt()}\n\n#参考投稿（JSON形式）:\n${statusesText}\n`;

      console.log(prompt);

      if (USE_STRUCTURED_OUTPUTS) {
        console.log('Structured Outputsを使用して生成します...');
        const structuredModel = model.withStructuredOutput(GeneratedTextSchema);
        const result = await structuredModel.invoke([{ role: 'user', content: prompt }]);
        firstPassText = result.generated_text.trim();
      } else {
        const result = await model.invoke([{ role: 'user', content: prompt }]);
        firstPassText = result.content.toString().trim();
      }

      firstPassText = firstPassText.replace(/[\r\n]+$/, '');
      if (TWO_PASS_MODE) {
        console.log('\n===== 生成された文章(1-pass) =====');
        console.log(firstPassText);
        console.log('===================================\n');
      }
      break;
    } catch (error: unknown) {
      if (retryCount < MAX_RETRIES - 1) {
        retryCount++;
        console.log(`1pass目: 文章生成中にエラーが発生しました。リトライします (${retryCount}/${MAX_RETRIES}):`, error);
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      console.error('1pass目: 文章生成中にエラーが発生しました:', error);

      // 最大リトライ回数に達した場合、フォールバックプロバイダーを試す
      if (FALLBACK_LLM_PROVIDER && currentProvider !== FALLBACK_LLM_PROVIDER) {
        console.log(`\n最大リトライ回数に達しました。フォールバックプロバイダー ${FALLBACK_LLM_PROVIDER.toUpperCase()} に切り替えます...\n`);
        currentProvider = FALLBACK_LLM_PROVIDER;
        retryCount = 0;
        continue;
      }

      return null;
    }
  }

  if (!firstPassText) {
    console.error(`1pass目: 最大リトライ回数(${MAX_RETRIES}回)に達しました`);
    return null;
  }
  
  // 2pass目の処理（有効な場合）
  let finalText = firstPassText;
  if (TWO_PASS_MODE) {
    const secondPassText = await generateSecondPassText(firstPassText);
    if (secondPassText) {
      finalText = secondPassText;
    }
  }
  
  saveHistory(finalText, accountId);
  finalText = `${finalText} #bot`;
  return finalText;
}

function getRandomSample<T>(array: T[], n: number): T[] {
  if (n >= array.length) {
    return array;
  }
  const shuffled = array.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

export async function runMain(): Promise<void> {
  try {
    if (!validateEnvVariables()) {
      process.exit(1);
    }
    const sourceClient = initSourceClient();
    const botClient = initBotClient();
    let accountId: string;
    if (SOURCE_USER_ID) {
      console.log(`MASTODON_USER_IDが指定されています。アカウントID '${SOURCE_USER_ID}' を使用します`);
      accountId = SOURCE_USER_ID;
    } else {
      accountId = await resolveAccountId(SOURCE_USERNAME, sourceClient);
    }
    const statuses = await fetchAccountStatuses(accountId, sourceClient);
    if (statuses.length === 0) {
      console.log('投稿が見つかりませんでした。プログラムを終了します。');
      return;
    }
    const RANDOM_SAMPLE_SIZE = Number.parseInt(process.env.RANDOM_SAMPLE_SIZE || '500', 10);
    const sampleSize = Math.min(statuses.length, RANDOM_SAMPLE_SIZE);
    const randomStatuses = getRandomSample(statuses, sampleSize);
    console.log(`${statuses.length}件の投稿からランダムに${randomStatuses.length}件を抽出しました`);
    const generatedText = await generateTextWithLLM(randomStatuses, accountId);
    if (generatedText) {
      console.log('\n===== 最終結果 =====');
      console.log(generatedText);
      console.log('====================\n');
      if (BOT_POST_ENABLED) {
        await postToBot(generatedText, botClient);
      }
    } else {
      console.log('文章を生成できませんでした。');
    }
  } catch (error: unknown) {
    console.error('エラーが発生しました:', error);
  }
}

if (require.main === module) {
  runMain();
} 