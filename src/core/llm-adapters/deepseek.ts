import type { ModelCapabilities, ProviderId } from '@shared/types'
import { modelSupportsVision } from '@shared/attachments'
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
      // v2.9.0: DeepSeek's text models have no vision endpoint. This is read as
      // the runtime authority by `AgentService`, so an attached image is sent as
      // a text-only note ("this model cannot see images") instead of a data URL
      // the API would reject.
      vision: modelSupportsVision('deepseek', model),
      jsonMode: true,
      contextWindow: 64_000,
      maxOutputTokens: isReasoner ? 32_768 : 8_192
    }
  }
}
