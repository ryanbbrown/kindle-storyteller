import fs from "fs";
import { execSync } from "child_process";
import path from "path";

const ASIN = process.argv[2] || "B0CPWQZNQB";
const tarFile = `book-content-${ASIN}.tar`;
const extractDir = `book-content-${ASIN}`;

if (!fs.existsSync(tarFile)) {
  console.error(`Error: ${tarFile} not found`);
  console.error(`Usage: node extract-book-content.js [ASIN]`);
  process.exit(1);
}

console.log(`Extracting ${tarFile}...`);

// Create extraction directory
if (!fs.existsSync(extractDir)) {
  fs.mkdirSync(extractDir);
}

// Extract the TAR file
try {
  execSync(`tar -xf ${tarFile} -C ${extractDir}`);
  console.log(`Extracted to ${extractDir}/\n`);
} catch (error) {
  console.error("Error extracting TAR:", error.message);
  process.exit(1);
}

// Read and display the contents
console.log("=".repeat(80));
console.log("BOOK CONTENT ANALYSIS");
console.log("=".repeat(80));

// 1. Metadata
if (fs.existsSync(path.join(extractDir, "metadata.json"))) {
  console.log("\n📚 METADATA:");
  const metadata = JSON.parse(fs.readFileSync(path.join(extractDir, "metadata.json"), "utf8"));
  console.log(JSON.stringify(metadata, null, 2));
}

// 2. Manifest
if (fs.existsSync(path.join(extractDir, "manifest.json"))) {
  console.log("\n📋 MANIFEST:");
  const manifest = JSON.parse(fs.readFileSync(path.join(extractDir, "manifest.json"), "utf8"));
  console.log(JSON.stringify(manifest, null, 2));
}

// 3. Table of Contents
if (fs.existsSync(path.join(extractDir, "toc.json"))) {
  console.log("\n📖 TABLE OF CONTENTS:");
  const toc = JSON.parse(fs.readFileSync(path.join(extractDir, "toc.json"), "utf8"));
  console.log(JSON.stringify(toc, null, 2));
}

// 4. Tokens (actual text content)
console.log("\n📝 TEXT CONTENT:");
const tokenFiles = fs.readdirSync(extractDir).filter(f => f.startsWith("tokens_"));

if (tokenFiles.length === 0) {
  console.log("No token files found");
} else {
  console.log(`Found ${tokenFiles.length} token file(s)\n`);

  let allText = "";

  for (const tokenFile of tokenFiles.sort()) {
    console.log(`Reading ${tokenFile}...`);
    const tokens = JSON.parse(fs.readFileSync(path.join(extractDir, tokenFile), "utf8"));

    // Tokens are usually an array of text fragments
    if (Array.isArray(tokens)) {
      const text = tokens.map(t => {
        if (typeof t === "string") return t;
        if (t.text) return t.text;
        if (t.content) return t.content;
        if (t.value) return t.value;
        return "";
      }).join("");

      allText += text;
    } else if (typeof tokens === "object") {
      // Sometimes tokens are structured differently
      console.log("Token structure:", Object.keys(tokens));

      // Try to find text in common fields
      if (tokens.tokens && Array.isArray(tokens.tokens)) {
        const text = tokens.tokens.map(t => {
          if (typeof t === "string") return t;
          if (t.text) return t.text;
          return "";
        }).join("");
        allText += text;
      }
    }
  }

  if (allText.length > 0) {
    console.log("\n" + "=".repeat(80));
    console.log("EXTRACTED TEXT (First 2000 characters):");
    console.log("=".repeat(80));
    console.log(allText.substring(0, 2000));
    console.log("\n...");
    console.log(`\nTotal text length: ${allText.length} characters`);

    // Save full text to file
    const textFile = `book-text-${ASIN}.txt`;
    fs.writeFileSync(textFile, allText);
    console.log(`\nFull text saved to: ${textFile}`);
  } else {
    console.log("\nCould not extract readable text. Token structure might be different.");
    console.log("Here's a sample of the first token file:");
    if (tokenFiles.length > 0) {
      const sample = JSON.parse(fs.readFileSync(path.join(extractDir, tokenFiles[0]), "utf8"));
      console.log(JSON.stringify(sample, null, 2).substring(0, 1000));
    }
  }
}

// 5. Page Data
const pageDataFiles = fs.readdirSync(extractDir).filter(f => f.startsWith("page_data_"));
if (pageDataFiles.length > 0) {
  console.log(`\n📄 Found ${pageDataFiles.length} page data file(s)`);
}

// 6. Panels (layout info)
const panelFiles = fs.readdirSync(extractDir).filter(f => f.startsWith("panels_"));
if (panelFiles.length > 0) {
  console.log(`📐 Found ${panelFiles.length} panel file(s)`);
}

console.log("\n" + "=".repeat(80));
console.log(`All files extracted to: ${extractDir}/`);
console.log("=".repeat(80));
