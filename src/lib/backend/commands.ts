/**
 * Catalogo dei comandi del backend Rust con ambito e permesso (Gate R49, R-MI-06, R-MI-09).
 *
 * La fonte e' `commands.json`, letto anche dal backend Rust (`link/catalog.rs`)
 * per decidere quali chiamate di un'altra istanza eseguire: finestra e backend
 * condividono la stessa classificazione.
 *
 * Ambito, cioe' cosa succede quando la finestra chiede il comando per un
 * progetto che vive su un'altra macchina:
 * - `routed`: gira su quella macchina cosi' com'e', argomenti e risultato
 *   viaggiano nel collegamento;
 * - `stream`: apre un flusso (chat, terminale) che il collegamento trasporta
 *   con il suo `Channel` (`link_open_rpc`, `link_open_pty`);
 * - `adapt`: appartiene alla macchina del progetto ma resta della finestra
 *   o dello scheduler che la possiede (automazioni, ponte delle corsie);
 * - `local`: appartiene alla macchina e alla finestra di chi guarda.
 *
 * Permesso richiesto all'istanza che chiama (ambiti di R-MI-09, F16):
 * `read` sempre concesso, `agents`, `files`, `terminal` revocabili.
 */
import catalogue from './commands.json' with { type: 'json' };

export type CommandScope = 'routed' | 'stream' | 'adapt' | 'local';
type CommandPermission = 'read' | 'agents' | 'files' | 'terminal' | 'local';

export type BackendCommand = keyof typeof catalogue;

type CommandEntry = readonly [CommandScope, CommandPermission];
const source: Record<BackendCommand, readonly string[]> = catalogue;

function assertCatalogue(value: Record<BackendCommand, readonly string[]>): asserts value is Record<BackendCommand, CommandEntry> {
	const scopes: Record<string, true> = { routed: true, stream: true, adapt: true, local: true };
	const permissions: Record<string, true> = { read: true, agents: true, files: true, terminal: true, local: true };
	for (const [command, entry] of Object.entries(value)) {
		if (entry.length !== 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'string' ||
			!Object.hasOwn(scopes, entry[0]) || !Object.hasOwn(permissions, entry[1])) {
			throw new Error(`Invalid backend command catalogue entry: ${command}`);
		}
	}
}
assertCatalogue(source);
const entries: Record<BackendCommand, CommandEntry> = source;

export function commandScope(command: BackendCommand): CommandScope {
	return entries[command][0];
}
