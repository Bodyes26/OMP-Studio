/**
 * Lettura dei permessi Tauri (ACL) per i test, senza parser TOML esterni.
 *
 * L'esistenza di `src-tauri/permissions/` attiva l'ACL sui comandi nativi:
 * ogni comando registrato in `generate_handler!` che non compaia in un permesso
 * incluso da una capability viene rifiutato a runtime con "command <nome> not
 * allowed by ACL". Questi helper leggono i file veri, cosi' i test possono
 * verificare il contratto invece del testo del TOML.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Permessi e set dichiarati in una cartella di permessi.
 * `permissions` mappa identificatore -> comandi consentiti;
 * `sets` mappa identificatore del set -> identificatori inclusi.
 */
export function readPermissionSets(permissionsDir) {
	const permissions = new Map();
	const sets = new Map();

	for (const file of readdirSync(permissionsDir).filter((f) => f.endsWith('.toml'))) {
		const text = readFileSync(join(permissionsDir, file), 'utf8');
		// Ogni blocco inizia con [[permission]] o [[set]] e finisce al blocco successivo.
		const blocks = text.split(/^\[\[(permission|set)\]\]$/m);
		for (let i = 1; i < blocks.length; i += 2) {
			const kind = blocks[i];
			const body = blocks[i + 1] ?? '';
			const identifier = body.match(/^identifier\s*=\s*"([^"]+)"/m)?.[1];
			if (!identifier) throw new Error(`blocco [[${kind}]] senza identifier in ${file}`);
			const list = body.match(
				kind === 'permission' ? /commands\.allow\s*=\s*\[([\s\S]*?)\]/ : /permissions\s*=\s*\[([\s\S]*?)\]/
			);
			const items = (list?.[1] ?? '')
				.split(',')
				.map((v) => v.trim().replace(/^"|"$/g, ''))
				.filter(Boolean);
			if (kind === 'permission') permissions.set(identifier, items);
			else sets.set(identifier, items);
		}
	}

	return { permissions, sets };
}

/**
 * Comandi effettivamente consentiti da una capability: espande i riferimenti a
 * set e permessi e ignora le voci con namespace (`core:default`), che portano
 * permessi di Tauri e non comandi dell'app.
 */
export function expandCapabilityPermissions({ permissions, sets }, capabilityPath) {
	const capability = JSON.parse(readFileSync(capabilityPath, 'utf8'));
	const allowed = new Set();
	const pending = capability.permissions.filter((p) => !p.includes(':'));

	while (pending.length > 0) {
		const reference = pending.pop();
		const commands = permissions.get(reference);
		if (commands) {
			for (const command of commands) allowed.add(command);
			continue;
		}
		const set = sets.get(reference);
		if (!set) {
			throw new Error(
				`la capability ${capabilityPath} referenzia '${reference}', che non esiste nei permessi`
			);
		}
		pending.push(...set);
	}

	return allowed;
}
