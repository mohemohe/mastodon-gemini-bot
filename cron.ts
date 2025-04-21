import 'dotenv/config';
import cron from 'node-cron';
import { runMain } from './index';

const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0,20,40 * * * *';

if (!cron.validate(CRON_SCHEDULE)) {
  console.error(`エラー: 無効なcron式です: ${CRON_SCHEDULE}`);
  console.error('正しい形式で指定してください。例: "0,20,40 * * * *" (毎時0分から20分ごと)');
  process.exit(1);
}

console.log(`定期実行を開始します。スケジュール: ${CRON_SCHEDULE}`);

cron.schedule(CRON_SCHEDULE, async () => {
  console.log(`${new Date().toISOString()} - 定期実行を開始します`);
  try {
    await runMain();
    console.log(`${new Date().toISOString()} - 定期実行が完了しました`);
  } catch (error) {
    console.error(`${new Date().toISOString()} - 定期実行中にエラーが発生しました:`, error);
  }
});

console.log(`${new Date().toISOString()} - 定期実行を待機します`); 