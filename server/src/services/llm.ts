/**
 * LLM service for text transformation using OpenAI API.
 */
import { log } from "../logger.js";
import { getOpenAIConfig, getTtsPreparationPrompt, type AudioProvider } from "../config/llm.js";

type OpenAIChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenAIChatResponse = {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
};

/** Transforms book text for better TTS narration using OpenAI. */
export async function transformTextForTTS(text: string, provider: AudioProvider): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable");
  }

  const config = getOpenAIConfig();
  const prompt = getTtsPreparationPrompt(provider);

  const messages: OpenAIChatMessage[] = [
    { role: "system", content: prompt },
    { role: "user", content: text },
  ];

  log.debug({ model: config.model, inputLength: text.length }, "Calling OpenAI for TTS text transformation");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: config.temperature,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    log.error({ status: response.status, error: errorText }, "OpenAI API error");
    throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as OpenAIChatResponse;
  const content = data.choices[0]?.message?.content;

  if (!content) {
    log.error("No content returned from OpenAI API");
    throw new Error("No content returned from OpenAI API");
  }

  log.debug({ outputLength: content.length }, "OpenAI text transformation complete");
  return content;
}
