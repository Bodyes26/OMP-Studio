<!--
  GitStatusMark.svelte — Badge di stato Git semantico e accessibile (Design v2).

  Caratteristiche:
  - Mappa gli stati reali di Git con abbreviazione testuale e descrizione screen-reader completa
  - Nessuna invenzione su 'U' vs '?': entrambi rappresentano file non tracciati
  - Colori da token semantici (--success, --warn, --danger) o neutri (--ink-muted) per rename/copy
  - Accessibile con classe globale .sr-only e aria-hidden sul glifo visivo
-->
<script lang="ts">
	export type GitStatusCode = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?' | '!' | string;

	export interface GitStatusMarkProps {
		status: GitStatusCode;
		/** Descrizione per screen reader: una cartella dice cosa contiene, non cosa e'. */
		description?: string;
		class?: string;
		/** Pallino al posto della lettera: una cartella segnala che contiene modifiche, come in VS Code. */
		dot?: boolean;
	}

	let { status, description, class: customClass = '', dot = false }: GitStatusMarkProps = $props();

	const info = $derived.by(() => {
		const raw = (status || '').trim().toUpperCase();
		switch (raw) {
			case 'A':
				return {
					abbr: 'A',
					description: 'File aggiunto',
					color: 'var(--success)'
				};
			case 'M':
				return {
					abbr: 'M',
					description: 'File modificato',
					color: 'var(--warn)'
				};
			case 'D':
				return {
					abbr: 'D',
					description: 'File eliminato',
					color: 'var(--danger)'
				};
			case 'C':
				return {
					abbr: 'C',
					description: 'Conflitto o file copiato',
					color: 'var(--danger)'
				};
			case 'R':
				return {
					abbr: 'R',
					description: 'File rinominato',
					color: 'var(--ink-muted)'
				};
			case 'U':
			case '?':
			case '??':
				return {
					abbr: 'U',
					description: 'File non tracciato',
					color: 'var(--success)'
				};
			case '!':
				return {
					abbr: '!',
					description: 'File ignorato',
					color: 'var(--ink-faint)'
				};
			default:
				return {
					abbr: raw.slice(0, 1) || '?',
					description: `Stato Git non riconosciuto: ${raw || '?'}`,
					color: 'var(--warn)'
				};
		}
	});
</script>

<span
	class={['git-status-mark', `git-st-${info.abbr.toLowerCase()}`, customClass].filter(Boolean).join(' ')}
	style:color={info.color}
>
	<span class="sr-only">{description || info.description}</span>
	<span aria-hidden="true" class="git-abbr">{dot ? '•' : info.abbr}</span>
</span>

<style>
	.git-status-mark {
		font-family: var(--font-mono, monospace);
		font-size: var(--text-meta);
		font-weight: 700;
		min-width: 14px;
		display: inline-block;
		text-align: center;
		flex-shrink: 0;
		line-height: 1;
		vertical-align: middle;
	}

	.git-abbr {
		display: inline-block;
	}
</style>
