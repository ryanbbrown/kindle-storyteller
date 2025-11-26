/** Fetches all default ElevenLabs voices and saves them to data/elevenlabs-voices.json */
import "dotenv/config";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = join(__dirname, "../data/elevenlabs-voices.json");

async function main() {
  const client = new ElevenLabsClient();
  const response = await client.voices.search({ voiceTypes: ["default"], pageSize: 100 });

  const voices = (response.voices || []).map((v) => ({
    voiceId: v.voiceId,
    name: v.name,
    description: v.description || null,
  }));

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(voices, null, 2));
  console.log(`Wrote ${voices.length} voices to ${outputPath}`);
}

main();
