<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { CircleCheck, TriangleAlert } from '@lucide/svelte';
  import { toConnection } from '$lib/api';
  import ConfirmDestructiveDialog from '$lib/components/shared/ConfirmDestructiveDialog.svelte';
  import PlanPreview from '$lib/components/shared/PlanPreview.svelte';
  import { Button } from '$lib/components/ui/button';
  import { t } from '$lib/i18n';
  import type { WritePhase } from '$lib/rows';
  import { getShellContext } from '$lib/shell/context';
  import type { ConnectionDraft } from '$lib/workbench';
  import {
    affectedLabel,
    reasonText,
    statusText,
    tableLabel,
    type Kind,
    type PrefixStructureResult,
    type StructureAnyResult,
  } from './model';
  import { StructureOperation } from './operation.svelte';

  let {
    kind,
    action,
    title,
    connection,
    token,
    fields,
    valid = true,
    scope = '',
    testId,
    onwritephase,
    onfinished,
    form,
  }: {
    kind: Kind;
    action: string;
    title: string;
    connection: ConnectionDraft | null;
    token: string;
    /** Structured request fields (without connection/action/confirm); evaluated when the plan is loaded. */
    fields: () => Record<string, unknown>;
    valid?: boolean;
    /** Changes when the target changes; plan and result are discarded then. */
    scope?: string;
    testId: string;
    onwritephase?: (phase: WritePhase) => void;
    onfinished?: (result: StructureAnyResult | null, unknown: boolean) => void;
    form?: Snippet<[boolean]>;
  } = $props();

  const shell = getShellContext();
  const kindOfOp = untrack(() => kind);
  const actionOfOp = untrack(() => action);
  const op = new StructureOperation({
    kind: kindOfOp,
    action: actionOfOp,
    context: () => ({ connection: connection ? toConnection(connection) : null, token }),
    onphase: (phase) => onwritephase?.(phase),
    onfinished: (result, unknown) => onfinished?.(result, unknown),
  });
  const uid = $props.id();
  let dialogOpen = $state(false);
  let confirmed = $state(false);

  $effect(() => {
    connection;
    token;
    scope;
    untrack(() => {
      op.reset();
      confirmed = false;
      dialogOpen = false;
    });
  });

  // Another write (or this one) is in flight: no second plan or execution can be started.
  const writing = $derived(!!shell?.session.writeInFlight);
  const plan = $derived(op.plan);
  const editing = $derived(op.phase === 'idle' || op.phase === 'planning');
  const targetLabel = $derived(plan ? JSON.stringify(plan.confirmation.target_name) : '');
  const tables = $derived(
    op.result && 'tables' in op.result ? (op.result as PrefixStructureResult).tables : [],
  );

  function execute() {
    dialogOpen = false;
    if (shell?.session.writeInFlight) return;
    void op.execute(plan?.confirmation.target_name);
  }
  const resultKey = $derived(
    !op.result
      ? ''
      : op.result.outcome === 'completed'
        ? 'partitions.outcomeCompleted'
        : op.result.outcome === 'rejected'
          ? 'partitions.outcomeRejected'
          : 'partitions.outcomeUnknown',
  );
</script>

<section class="op-card" aria-label={title} data-testid={testId} data-phase={op.phase}>
  <h3>{title}</h3>
  {#if editing}
    <form
      onsubmit={(event) => {
        event.preventDefault();
        if (valid && !writing) void op.loadPlan(fields());
      }}
    >
      {@render form?.(op.phase === 'planning')}
      {#if op.error}
        <div class="feedback error-feedback" role="alert" data-testid="op-error">
          <TriangleAlert size={18} />
          <p>{op.error}</p>
        </div>
      {/if}
      <div class="actions">
        <Button type="submit" disabled={!valid || writing || op.phase === 'planning'}
          >{op.phase === 'planning' ? t('partitions.planning') : t('partitions.showPlan')}</Button
        >
      </div>
    </form>
  {:else if plan}
    <div class="plan" data-testid="plan">
      <PlanPreview
        statements={plan.statements}
        warnings={plan.warnings}
        planSha256={plan.plan_sha256}
      />
      {#if plan.affected_objects.length}
        <div data-testid="affected">
          <strong>{t('partitions.affected')}</strong>
          <ul>
            {#each plan.affected_objects as name, index (index)}<li>
                <code>{affectedLabel(name)}</code>
              </li>{/each}
          </ul>
        </div>
      {/if}

      {#if op.phase === 'planned'}
        {#if plan.confirmation.destructive}
          <p class="note">{t('partitions.typeHint', { name: targetLabel })}</p>
          <div class="actions">
            <Button variant="outline" onclick={() => op.discardPlan()}
              >{t('partitions.editInputs')}</Button
            >
            <Button variant="destructive" disabled={writing} onclick={() => (dialogOpen = true)}
              >{t('partitions.execute')}</Button
            >
          </div>
          <ConfirmDestructiveDialog
            bind:open={dialogOpen}
            {title}
            description={t('partitions.destructiveDescription')}
            targetName={plan.confirmation.target_name}
            confirmLabel={t('partitions.execute')}
            onconfirm={execute}
          />
        {:else}
          <label class="check">
            <input id="{uid}-ok" type="checkbox" bind:checked={confirmed} />
            {t('partitions.confirmCheck', { action: title })}
          </label>
          <div class="actions">
            <Button variant="outline" onclick={() => op.discardPlan()}
              >{t('partitions.editInputs')}</Button
            >
            <Button disabled={!confirmed || writing} onclick={execute}
              >{t('partitions.execute')}</Button
            >
          </div>
        {/if}
      {:else if op.phase === 'executing'}
        <p role="status">{t('partitions.executing')}</p>
      {:else}
        {#if op.result}
          <div
            class="feedback {op.result.outcome === 'completed'
              ? 'success-feedback'
              : 'error-feedback'}"
            role={op.result.outcome === 'completed' ? 'status' : 'alert'}
            data-testid="result"
            data-outcome={op.result.outcome}
          >
            {#if op.result.outcome === 'completed'}<CircleCheck size={18} />{:else}<TriangleAlert
                size={18}
              />{/if}
            <div>
              <strong>{t(resultKey)}</strong>
              {#if op.result.outcome === 'rejected'}
                <p>{reasonText(op.result.reason)} {t('partitions.nothingChanged')}</p>
              {:else if op.result.outcome === 'outcome_unknown'}
                <p data-testid="unknown-hint">{t('partitions.errUnknown')}</p>
              {/if}
              <p class="note">
                {t('partitions.statements', {
                  done: op.result.statements_executed,
                  total: op.result.statements_total,
                })} · {op.result.atomic ? t('partitions.atomic') : t('partitions.notAtomic')}
              </p>
              {#if tables.length}
                <div class="table-scroll" data-testid="table-results">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('partitions.colTable')}</th>
                        <th>{t('partitions.colStatus')}</th>
                        <th>{t('partitions.colStatements')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each tables as row, index (index)}
                        <tr data-status={row.status}>
                          <td>{tableLabel(row.table)}</td>
                          <td>{statusText(row.status)}</td>
                          <td>{row.statements_executed} / {row.statements_total}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
            </div>
          </div>
        {:else}
          <div
            class="feedback error-feedback"
            role="alert"
            data-testid={op.unknown ? 'op-unknown' : 'op-error'}
          >
            <TriangleAlert size={18} />
            <div>
              <strong
                >{op.unknown ? t('partitions.outcomeUnknown') : t('partitions.notExecuted')}</strong
              >
              <p>{op.error}</p>
            </div>
          </div>
        {/if}
        <p class="note">{t('partitions.locked')}</p>
        <div class="actions">
          <Button variant="outline" onclick={() => op.reset()}>{t('partitions.newPlan')}</Button>
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .op-card {
    display: grid;
    gap: 0.625rem;
    min-width: 0;
    padding: 0.875rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }
  h3,
  p {
    margin: 0;
  }
  form,
  .plan {
    display: grid;
    gap: 0.625rem;
    min-width: 0;
  }
  .note {
    color: var(--color-muted-foreground);
    font-size: 0.8125rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.875rem;
  }
  ul {
    margin: 0.25rem 0 0;
    padding-left: 1.25rem;
  }
  .table-scroll {
    overflow-x: auto;
    margin-top: 0.5rem;
  }
  table {
    border-collapse: collapse;
    font-size: 0.8125rem;
  }
  th,
  td {
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--color-border);
    text-align: left;
    overflow-wrap: anywhere;
  }
  code {
    overflow-wrap: anywhere;
  }
</style>
