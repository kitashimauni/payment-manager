import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;

/**
 * The browser-only Local First app must also work without PostgreSQL. Do not
 * create a client until a database URL is supplied by the server runtime.
 */
export const sql = databaseUrl ? postgres(databaseUrl, { max: 1 }) : undefined;
export const db = sql ? drizzle(sql, { schema }) : undefined;
