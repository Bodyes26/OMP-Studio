#!/usr/bin/env node
/**
 * OMP Studio — Lock esclusivo per verifiche e pubblicazioni Nightly.
 *
 * Invarianti:
 * 1. Nessun intervallo con file vuoto: il payload viene pre-scritto in un file candidato
 *    univoco e collegato atomicamente a `.omp/cache/nightly.lock` tramite `fs.linkSync`.
 * 2. Stale recovery coordinato: prima di manipolare un lock potenzialmente obsoleto si
 *    acquisisce un lock di recupero dedicato (`nightly-recovery.lock`) per evitare contese tra competitor.
 * 3. Nessuna scadenza per processi vivi: se il PID è attivo (`isProcessAlive === true`), il lock
 *    non viene MAI rubato, a prescindere dal tempo trascorso. Liveness sconosciuta => fail-closed (vivo).
 * 4. Rilascio rigoroso con token: la rimozione del lock avviene SOLO se il token registrato coincide.
 */

import { randomUUID } from 'node:crypto';
import {
	existsSync,
	linkSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_ACQUIRE_TIMEOUT_MS = 5000;
const DEFAULT_RETRY_INTERVAL_MS = 150;

/** Registro dei lock attivi nel processo corrente per pulizia all'uscita */
const activeLocks = new Set();

process.on('exit', () => {
	for (const handle of activeLocks) {
		try {
			releaseNightlyLock(handle);
		} catch {}
	}
});

/**
 * Verifica se un PID è ancora in esecuzione sul sistema operativo locale.
 * Ritorna false solo in caso di certezza assoluta (ESRCH: processo non esistente).
 * Se i permessi impediscono la verifica (EPERM) o lo stato è incerto, ritorna true (fail-closed).
 *
 * @param {number} pid
 * @returns {boolean}
 */
export function isProcessAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return true;
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		if (err && typeof err === 'object') {
			if (err.code === 'ESRCH') return false; // Processo inesistente
			if (err.code === 'EPERM') return true;  // Processo vivo (altro utente)
		}
		return true; // Conservativo: se c'è un errore imprevisto, considera il processo vivo
	}
}

/**
 * Risolve il percorso standard del file di lock.
 * @param {string} root
 * @returns {string}
 */
export function getLockFilePath(root) {
	return join(root, '.omp', 'cache', 'nightly.lock');
}

/**
 * Risolve il percorso standard del file di recovery lock.
 * @param {string} root
 * @returns {string}
 */
function getRecoveryLockFilePath(root) {
	return join(root, '.omp', 'cache', 'nightly-recovery.lock');
}

/**
 * Tenta di creare atomicamente un file tramite pre-scrittura del candidato e linkSync.
 *
 * @param {string} targetPath Percorso finale del file
 * @param {object} payload Oggetto JSON da memorizzare
 * @returns {boolean} true se creato con successo, false se il file di destinazione esiste già
 */
function tryAtomicLink(targetPath, payload) {
	const dir = dirname(targetPath);
	mkdirSync(dir, { recursive: true });

	const candidatePath = join(dir, `candidate.${randomUUID()}.tmp`);
	writeFileSync(candidatePath, JSON.stringify(payload, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });

	try {
		linkSync(candidatePath, targetPath);
		return true;
	} catch (err) {
		if (err?.code === 'EEXIST') {
			return false;
		}
		throw err;
	} finally {
		try {
			unlinkSync(candidatePath);
		} catch {}
	}
}

/**
 * Tenta di acquisire il recovery lock per coordinare la rimozione sicura di un lock stale.
 *
 * @param {string} root
 * @returns {{ token: string, path: string } | null} Handle del recovery lock o null se conteso
 */
function tryAcquireRecoveryLock(root) {
	const recoveryPath = getRecoveryLockFilePath(root);
	const token = randomUUID();
	const acquired = tryAtomicLink(recoveryPath, {
		token,
		pid: process.pid,
		createdAt: Date.now()
	});

	if (acquired) {
		return { token, path: recoveryPath };
	}

	// Anche il recupero ha un proprietario. Non usare read+unlink per rubare
	// un recovery lock morto: due processi potrebbero cancellare quello nuovo.
	try {
		const data = JSON.parse(readFileSync(recoveryPath, 'utf8'));
		if (data?.pid && !isProcessAlive(data.pid)) {
			throw new Error(`Recupero Nightly interrotto (PID ${data.pid} morto). Verificare che nessuna verifica sia attiva prima di rimuovere ${recoveryPath}.`);
		}
	} catch (error) {
		if (error.message.startsWith('Recupero Nightly interrotto')) throw error;
	}

	return null;
}

/**
 * Rilascia il recovery lock.
 * @param {{ token: string, path: string }} recoveryHandle
 */
function releaseRecoveryLock(recoveryHandle) {
	try {
		if (existsSync(recoveryHandle.path)) {
			const raw = readFileSync(recoveryHandle.path, 'utf8');
			const data = JSON.parse(raw);
			if (data?.token === recoveryHandle.token) {
				unlinkSync(recoveryHandle.path);
			}
		}
	} catch {}
}

/**
 * Tenta di acquisire il lock esclusivo per la radice specificata.
 *
 * @param {string} root Cartella radice del workspace
 * @param {object} [options]
 * @param {number} [options.timeoutMs] Tempo massimo di attesa in ms (default 5000)
 * @param {number} [options.retryIntervalMs] Intervallo tra i tentativi in ms (default 150)
 * @param {AbortSignal} [options.signal] Segnale di interruzione
 * @returns {Promise<{ token: string, lockPath: string, root: string, released: boolean }>}
 */
export async function acquireNightlyLock(root, options = {}) {
	const timeoutMs = options.timeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
	const retryIntervalMs = options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
	const signal = options.signal;

	const lockPath = getLockFilePath(root);
	const startTime = Date.now();
	const myToken = randomUUID();

	while (true) {
		if (signal?.aborted) {
			const err = new Error('Acquisizione lock Nightly interrotta da segnale');
			err.name = 'AbortError';
			throw err;
		}

		// 1. Tentativo di creazione atomica istantanea con payload pre-scritto via linkSync
		const acquired = tryAtomicLink(lockPath, {
			token: myToken,
			pid: process.pid,
			createdAt: Date.now(),
			acquiredAt: new Date().toISOString()
		});

		if (acquired) {
			const handle = {
				token: myToken,
				lockPath,
				root,
				released: false
			};
			activeLocks.add(handle);
			return handle;
		}

		// 2. Lock già presente: lettura delle informazioni del detentore
		let existing = null;
		try {
			const raw = readFileSync(lockPath, 'utf8');
			existing = JSON.parse(raw);
		} catch {
			// Il file potrebbe essere in lettura o appena rimosso
		}

		// 3. Verifica liveness: solo se il PID è certificato come NON ESISTENTE (ESRCH)
		// si avvia il protocollo di recupero coordinato. Se è vivo o non certificabile, non si ruba mai.
		if (existing?.pid && !isProcessAlive(existing.pid)) {
			const recoveryHandle = tryAcquireRecoveryLock(root);
			if (recoveryHandle) {
				try {
					// Sotto recovery lock, riverifica lo stato del lock primario
					if (existsSync(lockPath)) {
						try {
							const currentRaw = readFileSync(lockPath, 'utf8');
							const currentData = JSON.parse(currentRaw);
							if (currentData?.pid && !isProcessAlive(currentData.pid)) {
								unlinkSync(lockPath);
							}
						} catch {
							// Stato non leggibile: non equivale a proprietario morto.
						}
					}
				} finally {
					releaseRecoveryLock(recoveryHandle);
				}
				// Dopo la pulizia coordinata, ritenta immediatamente l'acquisizione
				continue;
			}
		}

		// 4. Lock valido detenuto da un processo attivo (o recovery conteso)
		const elapsed = Date.now() - startTime;
		if (elapsed >= timeoutMs) {
			const holderInfo = existing?.pid
				? `PID: ${existing.pid}${existing.createdAt ? `, avviato: ${new Date(existing.createdAt).toISOString()}` : ''}`
				: 'processo sconosciuto';
			throw new Error(
				`Lock Nightly già acquisito da un'altra operazione in corso (${holderInfo}). ` +
				`Attesi ${elapsed}ms senza rilascio.`
			);
		}

		const waitTime = Math.min(retryIntervalMs, timeoutMs - elapsed);
		await new Promise((resolvePromise) => setTimeout(resolvePromise, waitTime));
	}
}

/**
 * Rilascia il lock specificato solo se il file contiene ancora il token corrispondente.
 *
 * @param {{ token: string, lockPath: string, released?: boolean }} handle
 * @returns {boolean} true se rilasciato con successo, false altrimenti
 */
export function releaseNightlyLock(handle) {
	if (!handle || handle.released) return false;
	handle.released = true;
	activeLocks.delete(handle);

	try {
		if (!existsSync(handle.lockPath)) {
			return true;
		}

		let current = null;
		try {
			current = JSON.parse(readFileSync(handle.lockPath, 'utf8'));
		} catch {}

		if (current?.token === handle.token) {
			unlinkSync(handle.lockPath);
			return true;
		}
		return false;
	} catch {
		return false;
	}
}

/**
 * Esegue una callback asincrona sotto protezione del lock Nightly.
 *
 * @template T
 * @param {string} root Radice del workspace
 * @param {(handle: { token: string, lockPath: string }) => Promise<T>} callback
 * @param {object} [options] Opzioni per acquireNightlyLock
 * @returns {Promise<T>}
 */
export async function withNightlyLock(root, callback, options = {}) {
	const handle = await acquireNightlyLock(root, options);
	try {
		return await callback(handle);
	} finally {
		releaseNightlyLock(handle);
	}
}
