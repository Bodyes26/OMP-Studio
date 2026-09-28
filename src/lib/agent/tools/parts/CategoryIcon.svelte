<script lang="ts">
	/**
	 * Icona rappresentativa per categoria di tool (Gate R32 - C10).
	 */
	import type { ToolCategory } from '../categories';
	import {
		IconFile,
		IconSearch,
		IconTerminal,
		IconPencil,
		IconGlobe,
		IconSparkles,
		IconSubagents,
		IconQueue,
		IconRoleDefault,
		IconPlay
	} from '$lib/icons';

	let {
		category,
		class: className = ''
	}: {
		category: ToolCategory;
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
	<span class="icon-wrap {className}"><IconRoleDefault /></span>
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
