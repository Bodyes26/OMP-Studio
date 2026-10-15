<!--
  CategoryIcon.svelte — Icona rappresentativa per ciascuna categoria di tool.
-->
<script lang="ts">
	import type { RemoteToolCategory } from '../../../../src/protocol.ts';
	import {
		IconFile,
		IconSearch,
		IconTerminal,
		IconPencil,
		IconGlobe,
		IconSparkles,
		IconSubagents,
		IconQueue,
		IconAsk,
		IconPlay
	} from '../../icons.ts';

	let {
		category,
		class: className = ''
	}: {
		category: RemoteToolCategory;
		class?: string;
	} = $props();
</script>

{#if category === 'read'}
	<span class="icon-wrap {className}"><IconFile /></span>
{:else if category === 'search'}
	<span class="icon-wrap {className}"><IconSearch /></span>
{:else if category === 'run'}
	<span class="icon-wrap {className}"><IconTerminal /></span>
{:else if category === 'edit'}
	<span class="icon-wrap {className}"><IconPencil /></span>
{:else if category === 'web'}
	<span class="icon-wrap {className}"><IconGlobe /></span>
{:else if category === 'think'}
	<span class="icon-wrap {className}"><IconSparkles /></span>
{:else if category === 'task'}
	<span class="icon-wrap {className}"><IconSubagents /></span>
{:else if category === 'todo'}
	<span class="icon-wrap {className}"><IconQueue /></span>
{:else if category === 'ask'}
	<span class="icon-wrap {className}"><IconAsk /></span>
{:else}
	<span class="icon-wrap {className}"><IconPlay /></span>
{/if}

<style>
	.icon-wrap {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		--icon-size: 14px;
	}
</style>
