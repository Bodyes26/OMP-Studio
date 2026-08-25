<script lang="ts">
	// Ultimo frammento di testo dello streaming: i caratteri appena comparsi
	// salgono di opacita' man mano che la testa di lettura si allontana.
	//
	// L'opacita' e' calcolata dalla distanza dalla testa, non da una @keyframes:
	// il markdown viene riparsato piu' volte al secondo e un'animazione CSS
	// ripartirebbe da zero a ogni riparsing. Solo gli ultimi `window` caratteri
	// diventano <span>: il resto resta un unico nodo di testo.
	import type { StreamFade } from '../markdown';

	let { text = '', fade }: { text?: string; fade: StreamFade } = $props();

	const parts = $derived.by(() => {
		const win = Math.max(1, Math.ceil(fade.window));
		let cut = Math.max(0, text.length - win);
		// Non spezzare una coppia surrogata: il taglio scivola indietro di uno.
		if (cut > 0) {
			const code = text.charCodeAt(cut);
			if (code >= 0xdc00 && code <= 0xdfff) cut -= 1;
		}
		return { head: text.slice(0, cut), tail: Array.from(text.slice(cut)) };
	});

	// Distanza dalla testa in caratteri: 1 per l'ultimo comparso. L'opacita' e'
	// quantizzata al 5% per non riscrivere l'attributo a ogni frame.
	function opacity(index: number, length: number): number {
		const distance = fade.over + (length - index);
		if (distance >= fade.window) return 1;
		return Math.max(0, Math.round((distance / fade.window) * 20) / 20);
	}
</script>

{parts.head}{#each parts.tail as ch, i}<span style="opacity:{opacity(i, parts.tail.length)}">{ch}</span>{/each}
