<!--
  ProcessStepper.svelte — Intelligent UI: Visualizzatore a fasi / passi operativi per piani e checklist.
-->
<script lang="ts">
	import { IconCheck, IconChevronDown } from '../../icons';

	export interface StepItem {
		id?: string | number;
		title: string;
		status?: 'done' | 'current' | 'pending';
		description?: string;
	}

	let {
		steps = [],
		currentStep = 0
	}: {
		steps: StepItem[];
		currentStep?: number;
	} = $props();

	let expandedSteps = $state<Record<number, boolean>>({});

	function toggleStep(idx: number) {
		expandedSteps[idx] = !expandedSteps[idx];
	}
</script>

<div class="stepper-card">
	<div class="stepper-list">
		{#each steps as step, idx (idx)}
			{@const status = step.status || (idx < currentStep ? 'done' : idx === currentStep ? 'current' : 'pending')}
			{@const isExpanded = expandedSteps[idx] ?? (status === 'current')}

			<div class="step-item step-{status}">
				<div class="step-line" class:hide={idx === steps.length - 1}></div>

				<div class="step-indicator">
					{#if status === 'done'}
						<IconCheck />
					{:else}
						<span>{idx + 1}</span>
					{/if}
				</div>

				<div class="step-main">
					<div
						class="step-header"
						role="button"
						tabindex="0"
						onclick={() => step.description && toggleStep(idx)}
						onkeydown={(e) => e.key === 'Enter' && step.description && toggleStep(idx)}
					>
						<span class="step-title">{step.title}</span>
						{#if step.description}
							<span class="expand-arrow" class:rotated={isExpanded}>
								<IconChevronDown />
							</span>
						{/if}
					</div>

					{#if step.description && isExpanded}
						<div class="step-desc">
							{step.description}
						</div>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	.stepper-card {
		margin: var(--space-3) 0;
		padding: var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		background: var(--bg-base);
		/* Container query per layout e target di tocco su colonna chat stretta */
		container-type: inline-size;
	}

	.stepper-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.step-item {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		position: relative;
	}

	.step-line {
		position: absolute;
		left: 12px;
		top: 26px;
		bottom: -12px;
		width: 2px;
		background: var(--line);
		z-index: 0;
	}

	.step-line.hide {
		display: none;
	}

	.step-indicator {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		display: inline-grid;
		place-items: center;
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
		z-index: 1;
		--icon-size: 13px;
		border: 2px solid var(--line);
		background: var(--bg-raised);
		color: var(--ink-muted);
		transition: all var(--dur-fast) var(--ease-out);
	}

	/* Stati */
	.step-done .step-indicator {
		background: var(--success);
		border-color: var(--success);
		color: #ffffff;
	}
	.step-done .step-line {
		background: var(--success);
	}

	.step-current .step-indicator {
		background: var(--brand);
		border-color: var(--brand);
		color: #ffffff;
		box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.2);
	}

	.step-pending .step-indicator {
		opacity: 0.6;
	}

	.step-main {
		flex: 1;
		min-width: 0;
		padding-top: 3px;
	}

	.step-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		cursor: pointer;
	}

	.step-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	.step-pending .step-title {
		color: var(--ink-muted);
		font-weight: 500;
	}

	.expand-arrow {
		display: inline-grid;
		place-items: center;
		--icon-size: 13px;
		color: var(--ink-faint);
		transition: transform var(--dur-fast) var(--ease-out);
	}

	.expand-arrow.rotated {
		transform: rotate(180deg);
	}

	.step-desc {
		margin-top: 4px;
		font-size: var(--text-body);
		color: var(--ink-muted);
		line-height: 1.45;
		padding: 6px 10px;
		background: var(--bg-raised);
		border-radius: var(--radius-sm);
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	/* Su schermi touch o colonne chat strette target di tocco >=44px */
	@media (pointer: coarse) {
		.step-header {
			min-height: 44px;
		}

		.step-indicator {
			margin-top: 9px;
		}

		.step-line {
			top: 35px;
		}
	}

	@container (max-width: 480px) {
		.stepper-card {
			padding: 10px;
		}

		.step-item {
			gap: var(--space-2);
		}

		.step-header {
			min-height: 44px;
		}

		.step-indicator {
			margin-top: 9px;
		}

		.step-line {
			top: 35px;
		}
	}
</style>
