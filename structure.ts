import { z } from 'zod';

/**
 * Structured Outputs用のスキーマ定義
 * LLMが生成する投稿文の構造を定義
 */
export const GeneratedTextSchema = z.object({
  generated_text: z.string().describe('生成された投稿文。余計な説明文や前置きは含めず、投稿文のみを出力してください。'),
  source_words: z.string().describe('生成文に使用したキーワードやフレーズ。カンマ区切りで複数指定可能。'),
});

export type GeneratedText = z.infer<typeof GeneratedTextSchema>;
