/**
 * Encryption for the Google refresh token at rest.
 *
 * AES-256-GCM. The key is a base64-encoded 32 bytes in TOKEN_ENCRYPTION_KEY:
 *
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Losing the key means the stored token is unreadable and the user has to sign
 * in with Google again — inconvenient, not catastrophic.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

function key(): Buffer {
	if (!env.TOKEN_ENCRYPTION_KEY) {
		throw new Error('TOKEN_ENCRYPTION_KEY is not set.');
	}
	const decoded = Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64');
	if (decoded.length !== 32) {
		throw new Error('TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.');
	}
	return decoded;
}

/** Returns "iv.ciphertext.authTag", all base64. */
export function encrypt(plaintext: string): string {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGORITHM, key(), iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	return [iv, ciphertext, cipher.getAuthTag()].map((b) => b.toString('base64')).join('.');
}

export function decrypt(payload: string): string {
	const [ivPart, ciphertextPart, tagPart] = payload.split('.');
	if (!ivPart || !ciphertextPart || !tagPart) {
		throw new Error('Malformed encrypted payload.');
	}
	const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivPart, 'base64'));
	decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
	return Buffer.concat([
		decipher.update(Buffer.from(ciphertextPart, 'base64')),
		decipher.final()
	]).toString('utf8');
}
