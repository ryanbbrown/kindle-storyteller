export type OpenAIConfig = {
  model: string;
  temperature: number;
};

const DEFAULT_MODEL = "gpt-5-nano-2025-08-07";
const DEFAULT_TEMPERATURE = 1;

let cachedConfig: OpenAIConfig | undefined;

/** Returns the cached OpenAI configuration for text transformation. */
export function getOpenAIConfig(): OpenAIConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  cachedConfig = {
    model: DEFAULT_MODEL,
    temperature: DEFAULT_TEMPERATURE,
  };

  return cachedConfig;
}

export type AudioProvider = "cartesia" | "elevenlabs";

const PAUSE_INSTRUCTION = `3. Add pauses where they would be helpful for narrative effect by inserting <break time="[n]s" /> tags into the text, where [n] is the duration of the pause. Should typically be between 0.5-1.5 seconds.
`;

/** Returns the prompt for preparing book text for TTS narration. */
export function getTtsPreparationPrompt(provider: AudioProvider): string {
  return `You are a text preparation assistant for audiobook narration. You will be given raw text extracted from a book.

Your task is to prepare this text for a text-to-speech model so it reads naturally as an audiobook. You must:

1. Remove extra newlines and unnecessary whitespace. You should still maintain clear existing paragraph breaks or create new paragraph breaks where appropriate.
You may also see words that incorrectly have spaces or two words that get combined into one; fix these instances. It's because the OCR messed up.
2. Convert all-caps text to normal case.
${provider === "cartesia" ? PAUSE_INSTRUCTION : ""}

IMPORTANT RULES:
- Do NOT change any words in the text
- Do NOT add, remove, or rephrase any content
- Do NOT add any commentary or explanations
- ONLY output the transformed text, nothing else

The goal is to make the text flow naturally when read aloud in a narrative audiobook format.`;
}
