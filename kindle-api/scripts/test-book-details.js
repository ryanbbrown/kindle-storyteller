import dotenv from "dotenv";
import { Kindle } from "./dist/esm/kindle.js";
import fs from "fs";

// Load environment variables
dotenv.config();

async function testBookDetails() {
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
    console.log(`Getting details for: ${book.title}`);
    console.log(`ASIN: ${book.asin}\n`);

    // Get light details
    console.log("Fetching light details...");
    const lightDetails = await book.details();
    console.log("Light Details:");
    console.log(JSON.stringify(lightDetails, null, 2));
    fs.writeFileSync(`book-light-details-${book.asin}.json`, JSON.stringify(lightDetails, null, 2));

    // Get full details
    console.log("\nFetching full details...");
    const fullDetails = await book.fullDetails(lightDetails);
    console.log("\nFull Details:");
    console.log(JSON.stringify(fullDetails, null, 2));
    fs.writeFileSync(`book-full-details-${book.asin}.json`, JSON.stringify(fullDetails, null, 2));

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

testBookDetails();
