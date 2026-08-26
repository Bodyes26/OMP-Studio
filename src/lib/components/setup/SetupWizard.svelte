<script lang="ts">
	/**
	 * SetupWizard wrapper per retrocompatibilità con percorsi esistenti.
	 * Delega l'implementazione a SetupModal con supporto fail-safe e alert banner.
	 */
	import SetupModal, { type Step } from '$lib/components/SetupModal.svelte';

	let {
		open = false,
		startAt = 'wizard',
		onClose
	} = $props<{ open?: boolean; startAt?: Step; onClose?: () => void }>();
</script>

<SetupModal {open} {startAt} {onClose} />
