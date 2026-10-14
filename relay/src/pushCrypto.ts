import type { webcrypto } from 'node:crypto';
type JsonWebKey = webcrypto.JsonWebKey;
/**
 * Crittografia payload Web Push secondo RFC 8291 (aes128gcm) ed RFC 8188.
 * Utilizza WebCrypto nativo per ECDH (P-256), HKDF (SHA-256) e AES-GCM (128-bit).
 */

const HEADER_SALT_LEN = 16;
const HEADER_RS_LEN = 4;
const HEADER_IDLEN_LEN = 1;
const HEADER_KEY_LEN = 65;
const HEADER_TOTAL_LEN = HEADER_SALT_LEN + HEADER_RS_LEN + HEADER_IDLEN_LEN + HEADER_KEY_LEN; // 86 byte
const DEFAULT_RECORD_SIZE = 4096;

export interface ReceiverPushKeys {
	p256dh: string; // Base64url chiave pubblica P-256 non compressa (65 byte)
	auth: string; // Base64url segreto di autenticazione (16 byte)
}

export interface ReceiverKeyPair extends ReceiverPushKeys {
	privateKey: string; // Base64url scalare privato P-256 (32 byte)
}


/**
 * Cifra un payload arbitrario (testo o buffer) per una sottoscrizione Web Push.
 * Restituisce il corpo HTTP binario conforme a RFC 8291.
 */
export async function encryptPushPayload(
	payload: string | Uint8Array,
	receiver: ReceiverPushKeys,
	options?: {
		salt?: Uint8Array;
		senderKeyPair?: { publicKey: Uint8Array; privateKeyJwk: JsonWebKey };
	}
): Promise<Buffer> {
	const uaPublic = typeof receiver.p256dh === 'string'
		? Buffer.from(receiver.p256dh.replace(/\s+/g, ''), 'base64url')
		: Buffer.from(receiver.p256dh);
	const authSecret = typeof receiver.auth === 'string'
		? Buffer.from(receiver.auth.replace(/\s+/g, ''), 'base64url')
		: Buffer.from(receiver.auth);

	if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) {
		throw new Error(`Chiave pubblica ricevitore non valida: attesi 65 byte con prefisso 0x04, ricevuti ${uaPublic.length}`);
	}
	if (authSecret.length !== 16) {
		throw new Error(`Segreto auth ricevitore non valido: attesi 16 byte, ricevuti ${authSecret.length}`);
	}

	const plaintextBuf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : Buffer.from(payload);
	if (plaintextBuf.length > DEFAULT_RECORD_SIZE - HEADER_TOTAL_LEN - 1 - 16) {
		throw new Error(`Payload troppo grande per singolo record Web Push (max ~3993 byte, ricevuti ${plaintextBuf.length})`);
	}

	// 1. Chiave effimera del mittente (o fornita per test deterministici)
	let asPublic: Buffer;
	let asPrivSubtle: CryptoKey;

	if (options?.senderKeyPair) {
		asPublic = Buffer.from(options.senderKeyPair.publicKey);
		asPrivSubtle = await crypto.subtle.importKey(
			'jwk',
			options.senderKeyPair.privateKeyJwk,
			{ name: 'ECDH', namedCurve: 'P-256' },
			false,
			['deriveBits']
		);
	} else {
		const senderEc = await crypto.subtle.generateKey(
			{ name: 'ECDH', namedCurve: 'P-256' },
			true,
			['deriveBits']
		);
		asPublic = Buffer.from(await crypto.subtle.exportKey('raw', senderEc.publicKey));
		asPrivSubtle = senderEc.privateKey;
	}

	// 2. Salt di 16 byte (casuale o passato per test)
	const salt = options?.salt ? Buffer.from(options.salt) : Buffer.from(crypto.getRandomValues(new Uint8Array(16)));
	if (salt.length !== 16) {
		throw new Error('Salt deve essere di 16 byte');
	}

	// 3. ECDH: ecdh_secret = ECDH(as_private, ua_public)
	const uaPubSubtle = await crypto.subtle.importKey(
		'raw',
		uaPublic,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		[]
	);
	const ecdhSecret = Buffer.from(
		await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPubSubtle }, asPrivSubtle, 256)
	);

	// 4. PRK_key = HMAC-SHA-256(auth_secret, ecdh_secret)
	const hmacKeyAuth = await crypto.subtle.importKey(
		'raw',
		authSecret,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const prkKey = Buffer.from(await crypto.subtle.sign('HMAC', hmacKeyAuth, ecdhSecret));

	// 5. key_info = "WebPush: info\0" || ua_public || as_public
	const keyInfo = Buffer.concat([
		Buffer.from('WebPush: info\0', 'utf8'),
		uaPublic,
		asPublic
	]);

	// 6. IKM = HMAC-SHA-256(PRK_key, key_info || 0x01)
	const hmacKeyPrk = await crypto.subtle.importKey(
		'raw',
		prkKey,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const ikm = Buffer.from(
		await crypto.subtle.sign('HMAC', hmacKeyPrk, Buffer.concat([keyInfo, Buffer.from([1])]))
	);

	// 7. PRK = HMAC-SHA-256(salt, IKM)
	const hmacKeySalt = await crypto.subtle.importKey(
		'raw',
		salt,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const prk = Buffer.from(await crypto.subtle.sign('HMAC', hmacKeySalt, ikm));

	// 8. CEK = HMAC-SHA-256(PRK, "Content-Encoding: aes128gcm\0" || 0x01)[0..15]
	const hmacKeyPrk2 = await crypto.subtle.importKey(
		'raw',
		prk,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const cekFull = Buffer.from(
		await crypto.subtle.sign(
			'HMAC',
			hmacKeyPrk2,
			Buffer.from('Content-Encoding: aes128gcm\0\x01', 'utf8')
		)
	);
	const cek = cekFull.subarray(0, 16);

	// 9. NONCE = HMAC-SHA-256(PRK, "Content-Encoding: nonce\0" || 0x01)[0..11]
	const nonceFull = Buffer.from(
		await crypto.subtle.sign(
			'HMAC',
			hmacKeyPrk2,
			Buffer.from('Content-Encoding: nonce\0\x01', 'utf8')
		)
	);
	const nonce = nonceFull.subarray(0, 12);

	// 10. Padding: delimiter 0x02 alla fine del record
	const plaintextWithPadding = Buffer.concat([plaintextBuf, Buffer.from([0x02])]);

	// 11. Cifratura AES-GCM
	const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
	const ciphertext = Buffer.from(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, plaintextWithPadding)
	);

	// 12. Intestazione RFC 8188: salt (16) || rs (4) || idlen (1) || as_public (65)
	const header = Buffer.alloc(HEADER_TOTAL_LEN);
	salt.copy(header, 0);
	header.writeUInt32BE(DEFAULT_RECORD_SIZE, 16);
	header.writeUInt8(65, 20);
	asPublic.copy(header, 21);

	return Buffer.concat([header, ciphertext]);
}

/**
 * Decifra un payload Web Push secondo RFC 8291 utilizzando le credenziali del ricevitore.
 * Utile per test end-to-end e verifica correttezza crittografica.
 */
export async function decryptPushPayload(
	body: Uint8Array,
	receiver: ReceiverKeyPair
): Promise<Buffer> {
	const bodyBuf = Buffer.from(body);
	if (bodyBuf.length < HEADER_TOTAL_LEN + 1 + 16) {
		throw new Error('Messaggio cifrato troppo corto per contenere intestazione e tag');
	}

	const salt = bodyBuf.subarray(0, 16);
	const rs = bodyBuf.readUInt32BE(16);
	const idlen = bodyBuf.readUInt8(20);
	if (idlen !== 65) {
		throw new Error(`idlen atteso 65, trovato ${idlen}`);
	}
	const asPublic = bodyBuf.subarray(21, 21 + idlen);
	const ciphertext = bodyBuf.subarray(21 + idlen);

	const uaPublic = typeof receiver.p256dh === 'string'
		? Buffer.from(receiver.p256dh.replace(/\s+/g, ''), 'base64url')
		: Buffer.from(receiver.p256dh);
	const authSecret = typeof receiver.auth === 'string'
		? Buffer.from(receiver.auth.replace(/\s+/g, ''), 'base64url')
		: Buffer.from(receiver.auth);
	const uaPrivate = typeof receiver.privateKey === 'string'
		? Buffer.from(receiver.privateKey.replace(/\s+/g, ''), 'base64url')
		: Buffer.from(receiver.privateKey);

	// Ricostruisce chiave privata JWK
	const uaPrivJwk: JsonWebKey = {
		kty: 'EC',
		crv: 'P-256',
		x: Buffer.from(uaPublic.subarray(1, 33)).toString('base64url'),
		y: Buffer.from(uaPublic.subarray(33, 65)).toString('base64url'),
		d: uaPrivate.toString('base64url')
	};

	const uaPrivSubtle = await crypto.subtle.importKey(
		'jwk',
		uaPrivJwk,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		['deriveBits']
	);

	const asPubSubtle = await crypto.subtle.importKey(
		'raw',
		asPublic,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		[]
	);

	// ECDH
	const ecdhSecret = Buffer.from(
		await crypto.subtle.deriveBits({ name: 'ECDH', public: asPubSubtle }, uaPrivSubtle, 256)
	);

	// PRK_key = HMAC-SHA-256(auth_secret, ecdh_secret)
	const hmacKeyAuth = await crypto.subtle.importKey(
		'raw',
		authSecret,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const prkKey = Buffer.from(await crypto.subtle.sign('HMAC', hmacKeyAuth, ecdhSecret));

	// key_info = "WebPush: info\0" || ua_public || as_public
	const keyInfo = Buffer.concat([
		Buffer.from('WebPush: info\0', 'utf8'),
		uaPublic,
		asPublic
	]);

	// IKM
	const hmacKeyPrk = await crypto.subtle.importKey(
		'raw',
		prkKey,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const ikm = Buffer.from(
		await crypto.subtle.sign('HMAC', hmacKeyPrk, Buffer.concat([keyInfo, Buffer.from([1])]))
	);

	// PRK
	const hmacKeySalt = await crypto.subtle.importKey(
		'raw',
		salt,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const prk = Buffer.from(await crypto.subtle.sign('HMAC', hmacKeySalt, ikm));

	// CEK & NONCE
	const hmacKeyPrk2 = await crypto.subtle.importKey(
		'raw',
		prk,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const cekFull = Buffer.from(
		await crypto.subtle.sign(
			'HMAC',
			hmacKeyPrk2,
			Buffer.from('Content-Encoding: aes128gcm\0\x01', 'utf8')
		)
	);
	const cek = cekFull.subarray(0, 16);

	const nonceFull = Buffer.from(
		await crypto.subtle.sign(
			'HMAC',
			hmacKeyPrk2,
			Buffer.from('Content-Encoding: nonce\0\x01', 'utf8')
		)
	);
	const nonce = nonceFull.subarray(0, 12);

	// Decifra
	const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']);
	const decryptedWithPadding = Buffer.from(
		await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, ciphertext)
	);

	// Verifica e rimuove delimitatore (0x02 per l'ultimo record)
	const lastByte = decryptedWithPadding[decryptedWithPadding.length - 1];
	if (lastByte !== 0x02) {
		throw new Error(`Delimitatore di padding non valido: atteso 0x02, trovato ${lastByte}`);
	}

	return decryptedWithPadding.subarray(0, decryptedWithPadding.length - 1);
}
