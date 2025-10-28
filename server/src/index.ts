import { env } from "./env.js";
import { buildApp } from "./app.js";

async function main() {
  const app = await buildApp();

  try {
    const address = await app.listen({
      port: env.port,
      host: env.host,
    });

    app.log.info(`Server running at ${address}`);
  } catch (error) {
    app.log.error(error, "Failed to start server");
    process.exitCode = 1;
  }
}

void main();
