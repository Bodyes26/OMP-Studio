// Setup ambiente di test Bun per Svelte 5 runes headless.
export {};

const g = globalThis as unknown as Record<string, unknown>;
if (typeof g.$state === 'undefined') {
	g.$state = <T>(v: T): T => v;
}
if (typeof g.$derived === 'undefined') {
	g.$derived = <T>(v: T): T => v;
}
