<script module lang="ts">
	export type { ProviderHost } from '$lib/stores/quota.svelte';
</script>

<script lang="ts">
	import QuotaModal from './QuotaModal.svelte';
	import type { ProviderHost } from '$lib/stores/quota.svelte';

	let {
		open = false,
		onClose,
		guiHosts = [],
		onOpenSettings
	} = $props<{
		open?: boolean;
		onClose?: () => void;
		guiHosts?: ProviderHost[];
		onOpenSettings?: (section?: string) => void;
	}>();
</script>

<QuotaModal
	{open}
	{onClose}
	{guiHosts}
	{onOpenSettings}
/>
