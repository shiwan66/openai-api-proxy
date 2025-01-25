import { IChat } from './base'
import { GoogleGenerativeAI } from '@google/generative-ai'
import GoogleAI from '@google/generative-ai'
import OpenAI from 'openai'

export function google(env: Record<string, string>): IChat {
  function createClient(req: OpenAI.ChatCompletionCreateParams) {
    const genAI = new GoogleGenerativeAI(env.GOOGLE_GEN_AI_API_KEY)
    if (req.response_format && req.response_format.type !== 'json_schema') {
      throw new Error(
        'Unsupported response format, only json_schema is supported',
      )
    }
    const model = genAI.getGenerativeModel({
      model: req.model,
      generationConfig: {
        temperature: req.temperature!,
        maxOutputTokens: req.max_tokens!,
        responseSchema:
          req.response_format?.type === 'json_schema'
            ? req.response_format.json_schema
            : undefined,
        topP: req.top_p!,
      },
    })
    return model
  }
  function parseRequest(
    req: OpenAI.ChatCompletionCreateParams,
  ): GoogleAI.GenerateContentRequest {
    const systemInstruction = () => {
      const system = req.messages.find((m) => m.role === 'system')?.content
      if (!system) {
        return undefined
      }
      return typeof system === 'string'
        ? system
        : system.map((s) => s.text).join('')
    }
    return {
      systemInstruction: systemInstruction(),
      contents: req.messages.map(
        (m) =>
          ({
            role: m.role,
            parts: [{ text: m.content }],
          } as GoogleAI.Content),
      ),
      tools: req.tools?.map(
        (tool) =>
          ({
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters,
          } as GoogleAI.Tool),
      ),
    }
  }
  function parseResponse(
    response: GoogleAI.EnhancedGenerateContentResponse,
    req: OpenAI.ChatCompletionCreateParams,
  ): OpenAI.ChatCompletion {
    return {
      id: 'chatcmpl-' + crypto.randomUUID(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: req.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: response.text(),
            refusal: null,
          },
          logprobs: null,
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: response.usageMetadata!.promptTokenCount,
        completion_tokens: response.usageMetadata!.candidatesTokenCount,
        total_tokens: response.usageMetadata!.totalTokenCount,
      },
    }
  }
  return {
    name: 'google',
    supportModels: [
      'gemini-1.0-pro',
      'gemini-1.5-pro',
      'gemini-1.5-pro-exp-0801',
      'gemini-1.5-flash',
      'gemini-1.5-flash-latest',
      'gemini-2.0-flash-exp',
      'gemini-2.0-flash-exp-latest',
      'gemini-2.0-flash-thinking-exp',
      'gemini-2.0-flash-thinking-exp-latest',
      'gemma-2-2b-it',
      'gemma-2-9b-it',
      'gemma-2-27b-it',
    ],
    requiredEnv: ['GOOGLE_GEN_AI_API_KEY'],
    async invoke(req) {
      const { response } = await createClient(req).generateContent(
        parseRequest(req),
      )
      return parseResponse(response, req)
    },
    async *stream(req) {
      const client = createClient(req)
      const stream = await client.generateContentStream(parseRequest(req))
      const id = 'chatcmpl-' + crypto.randomUUID()
      let last: GoogleAI.EnhancedGenerateContentResponse | undefined
      const fields = () => ({
        id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: req.model,
      })
      for await (const chunk of stream.stream) {
        last = chunk
        yield {
          ...fields(),
          choices: [
            {
              index: 0,
              delta: {
                content: chunk.text(),
              },
              finish_reason: null,
            },
          ],
        } as OpenAI.ChatCompletionChunk
      }
      if (!last) {
        throw new Error('No response from google')
      }

      if (req.stream_options?.include_usage) {
        yield {
          ...fields(),
          choices: [],
          usage: {
            prompt_tokens: last.usageMetadata!.promptTokenCount,
            completion_tokens: last.usageMetadata!.candidatesTokenCount,
            total_tokens: last.usageMetadata!.totalTokenCount,
          },
        } as OpenAI.ChatCompletionChunk
      } else {
        yield {
          ...fields(),
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'stop',
            },
          ],
        } as OpenAI.ChatCompletionChunk
      }
    },
  }
}
