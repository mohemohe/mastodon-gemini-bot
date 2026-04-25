import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGateway } from '@ai-sdk/gateway';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import type { LanguageModel } from 'ai';

export type LLMProviderConfig = {
  model: LanguageModel;
  temperature?: number;
  providerOptions?: ProviderOptions;
};

export type LLMProviderFactory = () => LLMProviderConfig;

/**
 * 対応するLLMプロバイダーのレジストリ。
 * 新しいプロバイダーを追加するには、このオブジェクトに新しいエントリを追加するだけでよい。
 * 各ファクトリーは必要な環境変数を検証し、欠けていればエラーを投げる。
 */
export const providerRegistry: Record<string, LLMProviderFactory> = {
  gemini: () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('Gemini プロバイダーを使用する場合、GEMINI_API_KEYが必要です。');
    }
    const google = createGoogleGenerativeAI({ apiKey });
    return {
      model: google(process.env.GEMINI_MODEL || 'gemini-2.5-flash'),
      temperature: 0.7,
    };
  },

  groq: () => {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('Groq プロバイダーを使用する場合、GROQ_API_KEYが必要です。');
    }
    const groq = createGroq({ apiKey });
    return {
      model: groq(process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'),
      temperature: 0.7,
    };
  },

  openai: () => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI プロバイダーを使用する場合、OPENAI_API_KEYが必要です。');
    }
    const baseURL = process.env.OPENAI_BASE_URL;
    const openai = createOpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });
    const modelId = process.env.OPENAI_MODEL || 'gpt-4o';
    const useResponsesApi = (process.env.OPENAI_USE_RESPONSES_API || 'false').toLowerCase() === 'true';
    return {
      model: useResponsesApi ? openai.responses(modelId) : openai.chat(modelId),
      temperature: 0.7,
    };
  },

  anthropic: () => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('Anthropic プロバイダーを使用する場合、ANTHROPIC_API_KEYが必要です。');
    }
    const baseURL = process.env.ANTHROPIC_BASE_URL;
    const anthropic = createAnthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });
    return {
      model: anthropic(process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514'),
    };
  },

  bedrock: () => {
    const region = process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION;
    if (!region) {
      throw new Error('AWS Bedrock プロバイダーを使用する場合、AWS_BEDROCK_REGIONまたはAWS_REGIONが必要です。');
    }
    const accessKeyId = process.env.AWS_BEDROCK_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_BEDROCK_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
    const sessionToken = process.env.AWS_BEDROCK_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN;
    const baseURL = process.env.AWS_BEDROCK_BASE_URL;
    const bedrock = createAmazonBedrock({
      region,
      ...(accessKeyId ? { accessKeyId } : {}),
      ...(secretAccessKey ? { secretAccessKey } : {}),
      ...(sessionToken ? { sessionToken } : {}),
      ...(baseURL ? { baseURL } : {}),
    });
    return {
      model: bedrock(process.env.AWS_BEDROCK_MODEL || 'anthropic.claude-3-5-sonnet-20241022-v2:0'),
      temperature: 0.7,
    };
  },

  'vercel-gateway': () => {
    const apiKey = process.env.AI_GATEWAY_API_KEY;
    if (!apiKey) {
      throw new Error('Vercel AI Gateway プロバイダーを使用する場合、AI_GATEWAY_API_KEYが必要です。');
    }
    const baseURL = process.env.AI_GATEWAY_BASE_URL;
    const modelId = process.env.AI_GATEWAY_MODEL;
    if (!modelId) {
      throw new Error('Vercel AI Gateway プロバイダーを使用する場合、AI_GATEWAY_MODELが必要です。');
    }
    const gateway = createGateway({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });
    const onlyRaw = process.env.AI_GATEWAY_PROVIDER_OPTIONS_GATEWAY_ONLY;
    const only = onlyRaw
      ? onlyRaw.split(',').map(s => s.trim()).filter(s => s.length > 0)
      : [];
    const providerOptions: ProviderOptions | undefined = only.length > 0
      ? { gateway: { only } }
      : undefined;
    return {
      model: gateway(modelId),
      temperature: 0.7,
      ...(providerOptions ? { providerOptions } : {}),
    };
  },

  lmstudio: () => {
    const baseURL = process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234/v1';
    const lmstudio = createOpenAICompatible({
      name: 'lmstudio',
      baseURL,
      apiKey: process.env.LM_STUDIO_API_KEY || 'lm-studio',
    });
    return {
      model: lmstudio(process.env.LM_STUDIO_MODEL || 'local-model'),
      temperature: 0.7,
    };
  },
};

export function getSupportedProviders(): string[] {
  return Object.keys(providerRegistry);
}

export function createLLMProvider(provider: string): LLMProviderConfig {
  const factory = providerRegistry[provider.toLowerCase()];
  if (!factory) {
    throw new Error(
      `サポートされていないLLMプロバイダーです: ${provider}。対応プロバイダー: ${getSupportedProviders().join(', ')}`
    );
  }
  console.log(`${provider.toUpperCase()}モデルを初期化します...`);
  return factory();
}
