require('dotenv').config();
const cron = require('node-cron');
const { runMain } = require('./index');

// 環境変数からスケジュール設定を取得
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0/20 * * * *'; // デフォルト: 毎時0分から20分ごと

// スケジュール式が有効か確認
if (!cron.validate(CRON_SCHEDULE)) {
  console.error(`エラー: 無効なcron式です: ${CRON_SCHEDULE}`);
  console.error('正しい形式で指定してください。例: "0/20 * * * *" (毎時0分から20分ごと)');
  process.exit(1);
}

console.log(`定期実行を開始します。スケジュール: ${CRON_SCHEDULE}`);

// cronジョブを登録
cron.schedule(CRON_SCHEDULE, async () => {
  console.log(`${new Date().toISOString()} - 定期実行を開始します`);
  
  try {
    await runMain();
    console.log(`${new Date().toISOString()} - 定期実行が完了しました`);
  } catch (error) {
    console.error(`${new Date().toISOString()} - 定期実行中にエラーが発生しました:`, error);
  }
});

// 即時実行（最初の1回）
(async () => {
  console.log(`${new Date().toISOString()} - 初回実行を開始します`);
  
  try {
    await runMain();
    console.log(`${new Date().toISOString()} - 初回実行が完了しました`);
  } catch (error) {
    console.error(`${new Date().toISOString()} - 初回実行中にエラーが発生しました:`, error);
  }
})(); 