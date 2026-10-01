<script module lang="ts">
	export type { ProviderHost } from '$lib/stores/quota.svelte';
</script>

<script lang="ts">
	import QuotaModal from './QuotaModal.svelte';
	import type { ProviderHost } from '$lib/stores/quota.svelte';

	let {
		open = false,
		anchor = null,
		onClose,
		guiHosts = [],
		onOpenSettings
	} = $props<{
		open?: boolean;
		anchor?: HTMLElement | null;
		onClose?: () => void;
		guiHosts?: ProviderHost[];
		onOpenSettings?: (section?: string) => void;
	}>();
</script>

<QuotaModal
	{open}
	{anchor}
	{onClose}
	{guiHosts}
	{onOpenSettings}
/>
