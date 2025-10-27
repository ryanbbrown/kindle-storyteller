import dotenv from "dotenv";
import { Kindle } from "./dist/esm/kindle.js";
import fs from "fs";

// Load environment variables
dotenv.config();

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
      revision: "4019dcc4", // You might need to get this dynamically
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
    console.log(`URL: ${rendererUrl}\n`);

    // Use the public request method to access the renderer endpoint
    const response = await kindle.request(rendererUrl);

    console.log("Response received!");
    console.log(`Status: ${response.status}`);
    console.log(`Headers:`, response.headers);
    console.log(`Body length: ${response.body?.length || 0} bytes\n`);

    // Check if it's binary content (TAR file)
    if (response.headers["content-type"]?.includes("application") ||
        response.headers["content-type"]?.includes("octet-stream")) {
      const filename = `book-content-${book.asin}.tar`;

      // The body might be base64 encoded or raw binary
      // We need to handle it appropriately
      console.log("Detected binary content (likely TAR file)");
      console.log(`Attempting to save to: ${filename}`);

      // If the response body is a string (base64), decode it
      let buffer;
      if (typeof response.body === "string") {
        // Try to parse as base64 if it looks like base64
        try {
          buffer = Buffer.from(response.body, "base64");
        } catch (e) {
          // If not base64, treat as raw binary string
          buffer = Buffer.from(response.body, "binary");
        }
      } else {
        buffer = response.body;
      }

      fs.writeFileSync(filename, buffer);
      console.log(`Saved binary content to ${filename}`);
    } else {
      console.log("Response body preview:");
      console.log(response.body?.substring(0, 500));

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
