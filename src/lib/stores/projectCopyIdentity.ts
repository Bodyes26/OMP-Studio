/**
 * Identita' di una copia di progetto, pura e condivisa da barra e relay.
 *
 * La regola di fusione delle copie e' una sola (R-MI-12, R-MI-32, R-MI-44):
 * stesso `origin` GitHub — anche dopo una rinomina — oppure stesso primo
 * commit, ma quest'ultimo solo dopo una conferma esplicita dell'utente.
 * `projectOrder` la usa per le tessere in barra, la proiezione verso il relay
 * per `RemoteProject.identity` (R-REM-17): se divergessero, il telefono
 * fonderebbe progetti che il computer tiene distinti, o viceversa.
 *
 * Il modulo resta puro — niente store, niente Tauri — perche' la barra lo
 * ricalcola a ogni render: chi chiama passa lo stato git gia' in cache e le
 * risposte di `projectLinks`.
 */

import { identityOf, type RepositoryIdentity } from './projectIdentity.ts';

/** Cio' che serve per riconoscere una copia. */
export interface CopyIdentityInput {
	canonicalProjectPath?: string | null;
	/** Stato upstream gia' letto (`GithubStore.upstreamByPath`). */
	upstream?: { repoSlug?: string | null; rootCommit?: string | null } | null;
	/** Nome attuale dello slug su GitHub, se noto (`projectLinks.canonicalSlug`). */
	canonicalSlug?: string | null;
	/**
	 * In barra ci sono copie di macchine diverse: solo allora vale la pena
	 * unire la copia rimasta al nome di prima di una rinomina (R-MI-32).
	 */
	multiMachine?: boolean;
}

/**
 * Identita' della copia nella forma che conosce `groupByRepository`.
 * `rootConfirmed` resta `false`: le copie senza origin si uniscono solo con
 * una decisione esplicita, applicata da chi chiama.
 */
export function repositoryIdentityOf(input: CopyIdentityInput): RepositoryIdentity {
	const repoSlug = input.upstream?.repoSlug ?? null;
	const rootCommit = input.upstream?.rootCommit ?? null;
	return {
		repoSlug,
		rootCommit,
		canonicalSlug: repoSlug && input.multiMachine ? (input.canonicalSlug ?? null) : null,
		rootConfirmed: false
	};
}

/**
 * Chiave pubblicata al relay (`RemoteProject.identity`, R-REM-17):
 * `origin:<owner/repo>` in minuscolo, con il nome attuale dopo una rinomina;
 * `root:<primo commit>` solo per le copie senza origin che l'utente ha
 * confermato come lo stesso progetto (R-MI-44). `null` = la copia resta un
 * progetto a se', come in barra.
 */
export function publishedProjectIdentity(
	input: CopyIdentityInput & { confirmedRoot?: (root: string) => boolean }
): string | null {
	if (!input.canonicalProjectPath) return null;
	// `rootConfirmed: true` fa emergere il primo commit come candidato; la
	// conferma vera la decide `confirmedRoot`, cosi' la regola resta in un posto.
	const identity = identityOf({ ...repositoryIdentityOf(input), rootConfirmed: true });
	if (!identity) return null;
	if (identity.kind === 'root-commit') {
		return input.confirmedRoot?.(identity.value) ? `root:${identity.value}` : null;
	}
	return `origin:${identity.value}`;
}
