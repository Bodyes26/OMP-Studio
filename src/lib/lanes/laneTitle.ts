/**
 * Titolo provvisorio `Worktree N` (creazione manuale da HEAD).
 * Al primo prompt diventa la prima riga, troncata: il branch Git `omp/lane-<id>`
 * non cambia. Un titolo gia' scelto (task o rinomina) non viene sovrascritto.
 */
export function synthesizeProvisionalLaneTitle(
	currentTitle: string,
	promptText: string
): string | null {
	if (!/^Worktree\s+\d+$/i.test(currentTitle)) return null;
	const firstLine = promptText.split(/\r?\n/).find((line) => line.trim())?.trim();
	if (!firstLine) return null;
	return firstLine.length > 36 ? `${firstLine.slice(0, 35)}…` : firstLine;
}
