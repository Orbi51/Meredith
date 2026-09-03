declare global {
	namespace App {
		interface Locals {
			/** Set by hooks once the signed-in user has been resolved to a row. */
			userId?: string | null;
		}
	}
}

export {};
