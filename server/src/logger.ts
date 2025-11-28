import pino from "pino";
import { env } from "./config/env.js";

/** Shared application logger instance. */
export const log = pino({ level: env.logLevel });
