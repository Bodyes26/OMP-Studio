<script module lang="ts">
	export type { ProviderHost } from '#lib/stores/quota.svelte.ts';
</script>

<script lang="ts">
	import QuotaModal from './QuotaModal.svelte';
	import type { ProviderHost } from '#lib/stores/quota.svelte.ts';
	import type { SettingsSection } from '#lib/stores/settings.svelte.ts';

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
		onOpenSettings?: (section?: SettingsSection) => void;
	}>();
</script>

<QuotaModal
	{open}
	{anchor}
	{onClose}
	{guiHosts}
	{onOpenSettings}
/>
