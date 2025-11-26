/** Fetches Cartesia voices and saves them to data/cartesia-voices.json and data/cartesia-voices-full.json */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "../data");
const fullOutputPath = join(dataDir, "cartesia-voices-full.json");
const summaryOutputPath = join(dataDir, "cartesia-voices.json");

async function main() {
  const response = await fetch("https://api.cartesia.ai/voices?limit=1000", {
    method: "GET",
    headers: {
      "Cartesia-Version": "2024-06-10",
      Authorization: `Bearer ${process.env.CARTESIA_API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Cartesia API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();

  mkdirSync(dataDir, { recursive: true });

  // Save full response (without embedding field)
  const full = data.map(({ embedding, ...rest }: any) => rest);
  writeFileSync(fullOutputPath, JSON.stringify(full, null, 2));
  console.log(`Wrote ${full.length} voices to ${fullOutputPath}`);

  // Save summary (voiceId, name, description only)
  const summary = data.map((v: any) => ({
    voiceId: v.id,
    name: v.name,
    description: v.description || null,
  }));
  writeFileSync(summaryOutputPath, JSON.stringify(summary, null, 2));
  console.log(`Wrote ${summary.length} voices to ${summaryOutputPath}`);
}

main();
