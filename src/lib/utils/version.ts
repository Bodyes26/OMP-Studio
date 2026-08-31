/**
 * Utility per la formattazione e la normalizzazione delle versioni di OMP Studio.
 */

export interface FormatVersionOptions {
	prefix?: boolean;
	compact?: boolean;
}

/**
 * Formatta una stringa di versione per la visualizzazione compatta e leggibile nell'interfaccia.
 * Se la versione e' una nightly con un build ID lungo (es. 0.1.1-nightly.1787753960479 o 0.1.1-nightly.1740838123),
 * abbrevia il build ID o restituisce una forma compatta per evitare overflow orizzontale.
 */
export function formatVersion(
	version: string | null | undefined,
	options?: FormatVersionOptions
): string {
	if (!version) return '';
	const clean = version.trim().replace(/^v/i, '');
	if (!clean) return '';

	const nightlyMatch = clean.match(/^(\d+\.\d+\.\d+)-nightly\.(\d+)$/);
	if (nightlyMatch) {
		const [, semver, buildId] = nightlyMatch;
		if (options?.compact) {
			const display = `${semver}-nightly`;
			return options?.prefix ? `v${display}` : display;
		}
		const shortId = buildId.length > 6 ? buildId.slice(-6) : buildId;
		const display = `${semver}-nightly.${shortId}`;
		return options?.prefix ? `v${display}` : display;
	}

	return options?.prefix ? `v${clean}` : clean;
}
