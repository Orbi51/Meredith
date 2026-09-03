/**
 * The database client. Server-only: importing this from a component would ship
 * the connection string to the browser, and SvelteKit stops that by convention
 * (`$lib/server`) — do not defeat it.
 *
 * The connection is created on first use rather than at import time, so that
 * the parts of the app that need no database (the scheduler debug page, the
 * tests) still run before DATABASE_URL is configured.
 */

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

let instance: PostgresJsDatabase<typeof schema> | null = null;

export function getDb(): PostgresJsDatabase<typeof schema> {
	if (!instance) {
		if (!env.DATABASE_URL) {
			throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
		}
		instance = drizzle(postgres(env.DATABASE_URL, { max: 5 }), { schema });
	}
	return instance;
}

/**
 * Convenience proxy so callers can write `db.select()...` without threading a
 * getter through every module, while the connection stays lazy.
 */
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
	get(_target, property) {
		const real = getDb();
		const value = Reflect.get(real, property);
		// Methods must keep their `this`, or drizzle's query builder breaks.
		return typeof value === 'function' ? value.bind(real) : value;
	}
});

export { schema };
