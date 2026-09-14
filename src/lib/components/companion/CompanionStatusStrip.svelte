<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';

	let {
		workingCount,
		attentionCount,
		queuedCount
	} = $props<{
		workingCount: number;
		attentionCount: number;
		queuedCount: number;
	}>();
</script>

<div class="status-strip" role="status">
	{m.companion_status_strip({
		working: workingCount,
		attention: attentionCount,
		queued: queuedCount
	})}
</div>
