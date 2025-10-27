import dotenv from "dotenv";
import { Kindle } from "./dist/esm/kindle.js";
import fs from "fs";

// Load environment variables
dotenv.config();

// You need to provide the x-amz-rendering-token from your browser
// Copy it from the network tab request headers
const RENDERING_TOKEN = process.env.RENDERING_TOKEN || process.argv[2];

if (!RENDERING_TOKEN) {
  console.error("ERROR: Please provide the x-amz-rendering-token");
  console.error("\nUsage:");
  console.error("  node test-renderer-with-token.js <token>");
  console.error("  OR set RENDERING_TOKEN in .env file");
  console.error("\nHow to get the token:");
  console.error("  1. Open https://read.amazon.com/?asin=<your-asin> in your browser");
  console.error("  2. Open DevTools > Network tab");
  console.error("  3. Find the /renderer/render request");
  console.error("  4. Copy the value of the 'x-amz-rendering-token' header");
  process.exit(1);
}

async function testRendererEndpoint() {
  try {
    console.log("Creating Kindle instance...");

    const kindle = await Kindle.fromConfig({
      cookies: process.env.COOKIES,
      deviceToken: process.env.DEVICE_TOKEN,
      tlsServer: {
        url: process.env.TLS_SERVER_URL,
        apiKey: process.env.TLS_SERVER_API_KEY,
      },
    });

    console.log("Successfully created Kindle instance!\n");

    // Get the first book (Wind and Truth)
    const book = kindle.defaultBooks[0];
    console.log(`Fetching content for: ${book.title}`);
    console.log(`ASIN: ${book.asin}\n`);

    // Build the renderer URL with parameters based on your browser URL
    const rendererParams = new URLSearchParams({
      version: "3.0",
      asin: book.asin,
      contentType: "FullBook",
      revision: "4019dcc4",
      fontFamily: "Bookerly",
      fontSize: "8.91",
      lineHeight: "1.4",
      dpi: "160",
      height: "784",
      width: "886",
      marginBottom: "0",
      marginLeft: "9",
      marginRight: "9",
      marginTop: "0",
      maxNumberColumns: "2",
      theme: "dark",
      locationMap: "false",
      packageType: "TAR",
      encryptionVersion: "NONE",
      numPage: "-6",
      skipPageCount: "-6",
      startingPosition: "2792593",
      bundleImages: "false",
    });

    const rendererUrl = `https://read.amazon.com/renderer/render?${rendererParams.toString()}`;

    console.log("Making request to renderer endpoint...");
    console.log(`URL: ${rendererUrl}`);
    console.log(`Using rendering token: ${RENDERING_TOKEN.substring(0, 50)}...\n`);

    // Make the request with the rendering token header
    const response = await kindle.request(rendererUrl, {
      headers: {
        "x-amz-rendering-token": RENDERING_TOKEN,
      },
    });

    console.log("Response received!");
    console.log(`Status: ${response.status}`);
    console.log(`Content-Type:`, response.headers["Content-Type"] || response.headers["content-type"]);
    console.log(`Body length: ${response.body?.length || 0} bytes\n`);

    if (response.status !== 200) {
      console.error("Error response:");
      console.error(response.body);
      fs.writeFileSync(`error-response-${book.asin}.txt`, response.body || "");
      process.exit(1);
    }

    // Check if it's binary content (TAR file)
    const contentType = response.headers["Content-Type"]?.[0] || response.headers["content-type"]?.[0] || "";

    if (contentType.includes("application") || contentType.includes("octet-stream") || contentType.includes("tar")) {
      const filename = `book-content-${book.asin}.tar`;

      console.log("Detected binary content (TAR file)");
      console.log(`Saving to: ${filename}`);

      // The response body might be base64 encoded
      let buffer;
      if (typeof response.body === "string") {
        // Try to detect if it's base64
        if (/^[A-Za-z0-9+/]+=*$/.test(response.body.substring(0, 100))) {
          console.log("Decoding from base64...");
          buffer = Buffer.from(response.body, "base64");
        } else {
          // Treat as raw binary
          buffer = Buffer.from(response.body, "binary");
        }
      } else {
        buffer = response.body;
      }

      fs.writeFileSync(filename, buffer);
      console.log(`Successfully saved ${buffer.length} bytes to ${filename}`);

      // Try to list tar contents
      console.log("\nAttempting to list TAR contents...");
      const { execSync } = await import("child_process");
      try {
        const contents = execSync(`tar -tzf ${filename}`).toString();
        console.log("TAR contents:");
        console.log(contents);
      } catch (e) {
        console.log("Could not list TAR contents (file might not be a valid TAR)");
      }
    } else {
      console.log("Response body preview:");
      console.log(response.body?.substring(0, 1000));

      // Save to file
      const filename = `book-content-${book.asin}.txt`;
      fs.writeFileSync(filename, response.body || "");
      console.log(`\nSaved full response to ${filename}`);
    }

  } catch (error) {
    console.error("Error:", error);

    // Print more detailed error info if available
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response body:", error.response.body);
    }

    process.exit(1);
  }
}

testRendererEndpoint();
