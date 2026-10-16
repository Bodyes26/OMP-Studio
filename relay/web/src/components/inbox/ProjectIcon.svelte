<!--
  ProjectIcon.svelte — Icona quadrata compatta con iniziale del progetto.
-->
<script lang="ts">
	import type { RemoteProject } from '../../../../src/protocol.ts';

	let {
		project,
		size = 'md',
		class: extraClass = ''
	}: {
		project?: { name: string; hue?: number } | null;
		size?: 'sm' | 'md' | 'lg';
		class?: string;
	} = $props();

	const initial = $derived(
		(project?.name || '').trim().charAt(0).toUpperCase() || 'P'
	);

	const hue = $derived(
		project?.hue ?? 210
	);
</script>

<span
	class="project-icon size-{size} {extraClass}"
	style:background-color="hsl({hue}, 65%, 45%)"
	aria-hidden="true"
>
	{initial}
</span>

<style>
	.project-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		text-transform: uppercase;
		color: #ffffff;
		border-radius: var(--radius-sm);
		flex-shrink: 0;
		user-select: none;
		line-height: 1;
	}

	.size-sm {
		width: 18px;
		height: 18px;
		font-size: 10px;
	}

	.size-md {
		width: 24px;
		height: 24px;
		font-size: 12px;
	}

	.size-lg {
		width: 32px;
		height: 32px;
		font-size: 15px;
		border-radius: var(--radius-md);
	}
</style>
