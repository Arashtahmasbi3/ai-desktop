import type { ModelCapabilities, ProviderId } from '@shared/types'
import { OpenAIAdapter } from './openai'

/**
 * DeepSeek exposes an OpenAI-compatible API, so this adapter only overrides
 * the base URL, provider id and model capabilities.
 */
export class DeepSeekAdapter extends OpenAIAdapter {
  override readonly provider: ProviderId = 'deepseek'
  override readonly defaultBaseUrl: string = 'https://api.deepseek.com/v1'

  override getCapabilities(model: string): ModelCapabilities {
    const isReasoner = /reasoner/.test(model)
    return {
      streaming: true,
      toolCalling: true,
      vision: false,
      jsonMode: true,
      contextWindow: 64_000,
      maxOutputTokens: isReasoner ? 32_768 : 8_192
    }
  }
}
