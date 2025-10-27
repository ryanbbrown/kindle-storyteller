import dotenv from "dotenv";
import { Kindle } from "../dist/esm/kindle.js";

dotenv.config();

/**
 * Update the reading position for a Kindle book
 *
 * Usage:
 *   node scripts/update-reading-position.js [ASIN] [POSITION]
 *
 * Example:
 *   node scripts/update-reading-position.js B0CPWQZNQB 2791479
 *
 * Environment variables needed:
 *   - COOKIES (from browser)
 *   - DEVICE_TOKEN
 *   - ADP_SESSION_TOKEN (the x-adp-session-token from browser)
 *   - GUID (device GUID from browser request)
 *   - TLS_SERVER_URL
 *   - TLS_SERVER_API_KEY
 */

async function updateReadingPosition() {
  try {
    const asin = process.argv[2] || process.env.ASIN;
    const position = process.argv[3] || process.env.READING_POSITION;
    const guid = process.env.GUID;

    if (!asin) {
      console.error("Error: ASIN is required");
      console.error("Usage: node scripts/update-reading-position.js [ASIN] [POSITION]");
      process.exit(1);
    }

    if (!position) {
      console.error("Error: Reading position is required");
      console.error("Usage: node scripts/update-reading-position.js [ASIN] [POSITION]");
      process.exit(1);
    }

    if (!guid) {
      console.error("Error: GUID not found in .env");
      console.error("Copy the guid parameter from your browser request");
      console.error("Example: CR!GGPMRGJV5X6CK78QFDQ97R8M1HD9");
      process.exit(1);
    }

    console.log(`\nUpdating reading position for ASIN: ${asin}`);
    console.log(`Setting position to: ${position}\n`);

    // Create Kindle instance
    console.log("Authenticating with Amazon...");
    const kindle = await Kindle.fromConfig({
      cookies: process.env.COOKIES,
      deviceToken: process.env.DEVICE_TOKEN,
      tlsServer: {
        url: process.env.TLS_SERVER_URL,
        apiKey: process.env.TLS_SERVER_API_KEY,
      },
    });

    // Get the ADP session token that was automatically generated
    const adpSessionToken = kindle.client.getAdpSessionId();

    if (!adpSessionToken) {
      console.error("Error: Failed to obtain ADP session token from Amazon");
      console.error("Check your COOKIES and DEVICE_TOKEN are valid");
      process.exit(1);
    }

    console.log("✓ Successfully authenticated and obtained session token");

    // Generate a session ID (you could also pass this from env if needed)
    const kindleSessionId = crypto.randomUUID();

    // Get timezone offset in minutes
    const timezoneOffset = new Date().getTimezoneOffset();

    // Build the stillReading URL
    // Note: GUID contains '!' which should NOT be double-encoded
    const stillReadingUrl = `https://read.amazon.com/service/mobile/reader/stillReading?asin=${encodeURIComponent(asin)}&guid=${guid}&kindleSessionId=${kindleSessionId}&lastPageRead=${position}&positionType=YJBinary&localTimeOffset=${-timezoneOffset}&clientVersion=20000100`;

    console.log(`Making request to: ${stillReadingUrl}\n`);

    // Make the request with the ADP session token
    const response = await kindle.request(stillReadingUrl, {
      headers: {
        "x-adp-session-token": adpSessionToken,
        "referer": `https://read.amazon.com/?asin=${asin}`,
      },
    });

    console.log("Response status:", response.status);
    console.log("Response body:", response.body);

    if (response.status === 200) {
      console.log("\n✓ Successfully updated reading position!");
      console.log(`  Book: ${asin}`);
      console.log(`  Position: ${position}`);
      console.log("\nYour position should now be synced across all Kindle devices/apps.");
    } else {
      console.error("\n✗ Failed to update position");
      console.error("Status:", response.status);
      console.error("Body:", response.body);

      if (response.status === 401 || response.status === 403) {
        console.error("\nTip: Your ADP_SESSION_TOKEN may have expired.");
        console.error("Get a fresh token from your browser's DevTools → Network tab");
      }
    }

  } catch (error) {
    console.error("Error updating reading position:", error);
    process.exit(1);
  }
}

updateReadingPosition();
