<script lang="ts">
	interface Props {
		size?: number;
		class?: string;
	}
	let { size = 16, class: className = '' }: Props = $props();
</script>

<svg
	viewBox="0 0 24 24"
	width={size}
	height={size}
	fill="none"
	stroke="currentColor"
	stroke-width="1.6"
	stroke-linecap="round"
	stroke-linejoin="round"
	class="icon-automation {className}"
	aria-hidden="true"
>
	<!-- Terminal window: prompt A cron/terminal icon -->
	<rect x="2.5" y="3.5" width="18" height="14" rx="2" />
	<path d="m6 7 3 3-3 3M11 13h2" />
	<!-- Clock overlay in bottom right corner with background cutout -->
	<circle cx="17" cy="17" r="5" fill="var(--bg-base)" />
	<path d="M17 14v3l2 1" />
</svg>

<style>
	.icon-automation {
		flex-shrink: 0;
		vertical-align: middle;
	}
</style>
