import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { PAIRING_ALPHABET, PAIRING_CODE_LENGTH } from './protocol.ts';

/**
 * Confronto in tempo costante. Gli hash pareggiano le lunghezze, cosi' la durata
 * del confronto non rivela nemmeno quanto e' lungo il segreto.
 */
export function tokensMatch(given: string, expected: string): boolean {
	const a = createHash('sha256').update(given).digest();
	const b = createHash('sha256').update(expected).digest();
	return timingSafeEqual(a, b);
}

/** Calcola l'impronta SHA-256 esadecimale di un segreto o codice. */
export function hashSecret(secret: string): string {
	return createHash('sha256').update(secret).digest('hex');
}

/** Genera un segreto crittografico casuale di 32 byte esadecimale. */
export function generateSecret(): string {
	return randomBytes(32).toString('hex');
}

/** Genera un codice di abbinamento casuale di 8 caratteri dall'alfabeto Crockford. */
export function generatePairingCode(): string {
	let code = '';
	for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
		code += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
	}
	return code;
}
