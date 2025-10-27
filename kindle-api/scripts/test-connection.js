import dotenv from "dotenv";
import { HttpClient } from "../dist/esm/kindle.js";

dotenv.config();

async function testConnection() {
  try {
    console.log("Testing connection to Amazon Kindle...\n");

    // Parse cookies
    const cookies = process.env.COOKIES;
    const cookieObj = cookies.split(";").reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split("=");
      if (key && value) {
        acc[key] = value;
      }
      return acc;
    }, {});

    console.log("Cookies found:", Object.keys(cookieObj).join(", "));

    const client = new HttpClient(cookieObj, {
      url: process.env.TLS_SERVER_URL,
      apiKey: process.env.TLS_SERVER_API_KEY,
    });

    // Try to fetch books
    console.log("\nAttempting to fetch books...");
    const url =
      "https://read.amazon.com/kindle-library/search?query=&libraryType=BOOKS&sortType=recency&querySize=50";

    const response = await client.request(url);
    console.log("\nResponse status:", response.status);
    console.log("Response body length:", response.body?.length || 0);
    console.log("Response body preview:", response.body?.substring(0, 200));

    if (response.status !== 200) {
      console.error("\n❌ Authentication failed!");
      console.error("Your cookies may have expired.");
      console.error("Please update them from https://read.amazon.com");
      process.exit(1);
    }

    // Try to get device token
    console.log("\n\nAttempting to get device token...");
    const params = new URLSearchParams({
      serialNumber: process.env.DEVICE_TOKEN,
      deviceType: process.env.DEVICE_TOKEN,
    });
    const deviceTokenUrl = `https://read.amazon.com/service/web/register/getDeviceToken?${params.toString()}`;

    const deviceResponse = await client.request(deviceTokenUrl);
    console.log("\nDevice token response status:", deviceResponse.status);
    console.log("Device token response body:", deviceResponse.body);

    if (deviceResponse.status === 200 && deviceResponse.body) {
      const deviceInfo = JSON.parse(deviceResponse.body);
      console.log("\n✓ Successfully obtained ADP session token!");
      console.log("Token preview:", deviceInfo.deviceSessionToken?.substring(0, 50) + "...");
    }

  } catch (error) {
    console.error("\n❌ Error:", error.message);
    console.error("\nFull error:", error);
    process.exit(1);
  }
}

testConnection();
