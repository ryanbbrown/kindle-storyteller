import fs from "fs";
import path from "path";

const ASIN = process.argv[2] || "B0CPWQZNQB";
const extractDir = `book-content-${ASIN}`;

if (!fs.existsSync(extractDir)) {
  console.error(`Error: ${extractDir}/ not found. Run extract-book-content.js first.`);
  process.exit(1);
}

console.log("Reading book content...\n");

// Read the glyphs file which contains the text strings
const glyphsPath = path.join(extractDir, "glyphs.json");
if (!fs.existsSync(glyphsPath)) {
  console.error("glyphs.json not found");
  process.exit(1);
}

const glyphs = JSON.parse(fs.readFileSync(glyphsPath, "utf8"));
console.log("Glyphs structure:", Object.keys(glyphs));

// Read tokens to get the order and positioning
const tokensPath = path.join(extractDir, "tokens_0_5.json");
const tokens = JSON.parse(fs.readFileSync(tokensPath, "utf8"));

console.log("\nToken structure (first item):");
console.log(JSON.stringify(tokens[0], null, 2).substring(0, 500));

// The glyphs file likely has a mapping of IDs to text
// Let's explore its structure
if (Array.isArray(glyphs)) {
  console.log(`\nGlyphs is an array with ${glyphs.length} items`);
  console.log("First glyph:", JSON.stringify(glyphs[0], null, 2).substring(0, 200));
} else if (typeof glyphs === "object") {
  console.log("\nGlyphs is an object with keys:", Object.keys(glyphs).slice(0, 10));
  const firstKey = Object.keys(glyphs)[0];
  console.log(`First glyph (${firstKey}):`, JSON.stringify(glyphs[firstKey], null, 2).substring(0, 200));
}

// Try to reconstruct the text
// Kindle uses position IDs to reference glyphs
let reconstructedText = "";

function extractTextFromTokens(tokenArray, glyphData) {
  let text = "";

  for (const page of tokenArray) {
    if (page.children) {
      for (const line of page.children) {
        if (line.words) {
          for (const word of line.words) {
            // Position IDs reference the glyph/text
            const startPos = word.startPositionId;
            const endPos = word.endPositionId;

            // Try to extract text from glyphs using position ID
            if (Array.isArray(glyphData)) {
              // If glyphs is an array, position might be an index
              const glyphText = glyphData.slice(startPos, endPos + 1)
                .map(g => g.text || g.content || g.value || g)
                .join("");
              text += glyphText;
            } else if (typeof glyphData === "object") {
              // If glyphs is an object, we need to find the right mapping
              for (let pos = startPos; pos <= endPos; pos++) {
                const glyph = glyphData[pos] || glyphData[pos.toString()];
                if (glyph) {
                  text += (typeof glyph === "string" ? glyph : (glyph.text || glyph.content || ""));
                }
              }
            }
          }
          text += " "; // Space between words
        }
        text += "\n"; // New line after each line
      }
      text += "\n"; // Extra line between pages/sections
    }
  }

  return text;
}

console.log("\n" + "=".repeat(80));
console.log("ATTEMPTING TEXT RECONSTRUCTION");
console.log("=".repeat(80));

reconstructedText = extractTextFromTokens(tokens, glyphs);

if (reconstructedText.trim().length > 0) {
  console.log("\nReconstructed text (first 2000 characters):");
  console.log(reconstructedText.substring(0, 2000));
  console.log("\n...");

  const outputFile = `book-text-${ASIN}.txt`;
  fs.writeFileSync(outputFile, reconstructedText);
  console.log(`\nFull text saved to: ${outputFile}`);
  console.log(`Total length: ${reconstructedText.length} characters`);
} else {
  console.log("\nCould not reconstruct text. Let's examine the data more closely.");
  console.log("\nGlyphs sample (first 20 items):");

  if (Array.isArray(glyphs)) {
    console.log(JSON.stringify(glyphs.slice(0, 20), null, 2));
  } else {
    const keys = Object.keys(glyphs).slice(0, 20);
    const sample = {};
    keys.forEach(k => sample[k] = glyphs[k]);
    console.log(JSON.stringify(sample, null, 2));
  }

  console.log("\nTokens sample (first word):");
  if (tokens[0]?.children?.[0]?.words?.[0]) {
    console.log(JSON.stringify(tokens[0].children[0].words[0], null, 2));
  }
}
