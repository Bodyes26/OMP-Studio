<script lang="ts">
	// Renderizza un testo semplice sostituendo le menzioni `@file` e `@"file con spazi"`
	// con `FileMentionChip` inline. Preserva il testo circostante e il comportamento di
	// clamping/ellipsis delle righe nelle anteprime (coda, pannello agente, popover).
	import { findFileMentions } from '$lib/agent/fileMentionSyntax';
	import FileMentionChip from '$lib/agent/components/FileMentionChip.svelte';

	let {
		text = '',
		onOpenFile
	}: {
		text: string;
		onOpenFile?: (path: string) => void;
	} = $props();

	type Segment =
		| { type: 'text'; value: string }
		| { type: 'mention'; path: string };

	const segments = $derived.by<Segment[]>(() => {
		if (!text) return [];
		const mentions = findFileMentions(text);
		if (mentions.length === 0) return [{ type: 'text', value: text }];

		const res: Segment[] = [];
		let last = 0;
		for (const m of mentions) {
			if (m.start > last) {
				res.push({ type: 'text', value: text.slice(last, m.start) });
			}
			res.push({ type: 'mention', path: m.path });
			last = m.end;
		}
		if (last < text.length) {
			res.push({ type: 'text', value: text.slice(last) });
		}
		return res;
	});
</script>

{#each segments as seg}{#if seg.type === 'text'}{seg.value}{:else}<FileMentionChip path={seg.path} onOpen={onOpenFile} />{/if}{/each}
