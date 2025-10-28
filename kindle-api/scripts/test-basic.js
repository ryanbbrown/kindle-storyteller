import dotenv from "dotenv";
import { Kindle } from "../dist/esm/kindle.js";

// Load environment variables
dotenv.config();

async function testBasicExample() {
  try {
    console.log("Creating Kindle instance...");
    console.log("TLS Server:", process.env.TLS_SERVER_URL);
    console.log("Cookies present:", !!process.env.COOKIES);
    console.log("Device token:", process.env.DEVICE_TOKEN);

    const kindle = await Kindle.fromConfig({
      cookies: process.env.COOKIES,
      deviceToken: process.env.DEVICE_TOKEN,
      tlsServer: {
        url: process.env.TLS_SERVER_URL,
        apiKey: process.env.TLS_SERVER_API_KEY,
      },
    });

    console.log("\nSuccessfully created Kindle instance!");
    console.log(`\nFound ${kindle.defaultBooks.length} books:\n`);

    // Display the books
    for (const book of kindle.defaultBooks) {
      console.log(`Title: ${book.title}`);
      console.log(`Authors: ${book.authors.map(a => `${a.firstName} ${a.lastName}`).join(", ")}`);
      console.log(`ASIN: ${book.asin}`);
      console.log(`Origin: ${book.originType}`);
      console.log(`Web Reader: ${book.webReaderUrl}`);
      console.log("---");
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

testBasicExample();
