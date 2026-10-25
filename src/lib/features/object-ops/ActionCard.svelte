<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { CircleCheck, TriangleAlert } from '@lucide/svelte';
  import { toConnection } from '$lib/api';
  import CapabilityNotice from '$lib/components/shared/CapabilityNotice.svelte';
  import ConfirmDestructiveDialog from '$lib/components/shared/ConfirmDestructiveDialog.svelte';
  import PlanPreview from '$lib/components/shared/PlanPreview.svelte';
  import { Button } from '$lib/components/ui/button';
  import { t } from '$lib/i18n';
  import type { WritePhase } from '$lib/rows';
  import type { ConnectionDraft } from '$lib/workbench';
  import {
    ACTIONS,
    effectText,
    kindText,
    reasonText,
    type Action,
    type ApiDriver,
    type ObjectOpCapability,
    type ObjectOpResult,
  } from './model';
  import { Operation } from './operation.svelte';

  let {
    action,
    capability,
    connection,
    token,
    fields,
    valid = true,
    scope = '',
    onwritephase,
    onfinished,
    form,
  }: {
    action: Action;
    capability: ObjectOpCapability | undefined;
    connection: ConnectionDraft | null;
    token: string;
    /** Structured request fields (without connection/confirm); evaluated when the plan is loaded. */
    fields: () => Record<string, unknown>;
    valid?: boolean;
    /** Changes when the target object changes; plan and result are discarded then. */
    scope?: string;
    onwritephase?: (phase: WritePhase) => void;
    onfinished?: (result: ObjectOpResult | null, unknown: boolean) => void;
    form?: Snippet<[boolean]>;
  } = $props();

  const kind = untrack(() => action);
  const op = new Operation({
    action: kind,
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

  const plan = $derived(op.plan);
  const supported = $derived(capability?.support !== 'unsupported');
  const needsAck = $derived(!!plan?.confirmation.current_database);
  const ackOk = $derived(!needsAck || op.acknowledgeCurrent);
  const editing = $derived(op.phase === 'idle' || op.phase === 'planning');
  const targetLabel = $derived(plan ? JSON.stringify(plan.confirmation.target_name) : '');

  function execute() {
    dialogOpen = false;
    void op.execute(plan?.confirmation.target_name);
  }
  const resultKey = $derived(
    !op.result
      ? ''
      : op.result.outcome === 'completed'
        ? 'object-ops.outcomeCompleted'
        : op.result.outcome === 'rejected'
          ? 'object-ops.outcomeRejected'
          : 'object-ops.outcomeUnknown',
  );
  const cell = (value: unknown) =>
    value === null || value === undefined ? t('object-ops.unknownValue') : String(value);
</script>

<section
  class="op-card"
  aria-label={t(ACTIONS[kind].titleKey)}
  data-testid={`op-${kind}`}
  data-phase={op.phase}
>
  <h3>{t(ACTIONS[kind].titleKey)}</h3>
  {#if !supported}
    <CapabilityNotice title={t('object-ops.unsupportedTitle')} reason={capability?.reason ?? ''} />
  {:else}
    {#if capability?.support === 'limited'}
      <p class="note" data-testid="limited-note">
        <strong>{t('object-ops.limited')}</strong>
        {capability.reason}
      </p>
    {/if}

    {#if editing}
      <form
        onsubmit={(event) => {
          event.preventDefault();
          if (valid) void op.loadPlan(fields());
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
          <Button type="submit" disabled={!valid || op.phase === 'planning'}
            >{op.phase === 'planning' ? t('object-ops.planning') : t('object-ops.showPlan')}</Button
          >
        </div>
      </form>
    {:else if plan}
      <div class="plan" data-testid={`plan-${kind}`}>
        <PlanPreview
          statements={plan.statements}
          warnings={plan.warnings}
          planSha256={plan.plan_sha256}
        />
        <p class="note">
          {t('object-ops.target')}: <code>{JSON.stringify(plan.target.name)}</code>
          {#if plan.target.schema}({t('object-ops.schema')}
            <code>{JSON.stringify(plan.target.schema)}</code>){/if}
        </p>
        <p class="note">
          {plan.ddl_transactional === 'yes'
            ? t('object-ops.transactionalYes')
            : t('object-ops.transactionalNo')}
        </p>
        {#if plan.affected_objects.length}
          <div data-testid="affected">
            <strong>{t('object-ops.affected')}</strong>
            <ul>
              {#each plan.affected_objects as name, index (index)}<li>
                  <code>{name}</code>
                </li>{/each}
            </ul>
          </div>
        {/if}
        {#if plan.dependencies.length}
          <div class="table-scroll" data-testid="dependencies">
            <strong>{t('object-ops.dependencies')}</strong>
            <table>
              <thead>
                <tr>
                  <th>{t('object-ops.depKind')}</th>
                  <th>{t('object-ops.depObject')}</th>
                  <th>{t('object-ops.depEffect')}</th>
                  <th>{t('object-ops.depCertainty')}</th>
                </tr>
              </thead>
              <tbody>
                {#each plan.dependencies as dep, index (index)}
                  <tr>
                    <td>{kindText(dep.kind)}</td>
                    <td
                      >{dep.schema ? `${dep.schema}.` : ''}{dep.name}{dep.constraint
                        ? ` (${dep.constraint})`
                        : ''}</td
                    >
                    <td>{effectText(dep.effect)}</td>
                    <td
                      >{dep.certainty === 'exact'
                        ? t('object-ops.certaintyExact')
                        : t('object-ops.certaintyTextual')}</td
                    >
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
        {#if plan.dependencies_truncated}<p class="note">{t('object-ops.truncated')}</p>{/if}

        {#if op.phase === 'planned'}
          {#if needsAck}
            <label class="check">
              <input type="checkbox" bind:checked={op.acknowledgeCurrent} />
              {t('object-ops.ackCurrent')}
            </label>
          {/if}
          {#if plan.confirmation.destructive}
            <p class="note">{t('object-ops.typeHint', { name: targetLabel })}</p>
            <div class="actions">
              <Button variant="outline" onclick={() => op.discardPlan()}
                >{t('object-ops.editInputs')}</Button
              >
              <Button variant="destructive" disabled={!ackOk} onclick={() => (dialogOpen = true)}
                >{t('object-ops.execute')}</Button
              >
            </div>
            <ConfirmDestructiveDialog
              bind:open={dialogOpen}
              title={t(ACTIONS[kind].titleKey)}
              description={t('object-ops.destructiveDescription')}
              targetName={plan.confirmation.target_name}
              confirmLabel={t('object-ops.execute')}
              onconfirm={execute}
            />
          {:else}
            <label class="check">
              <input id="{uid}-ok" type="checkbox" bind:checked={confirmed} />
              {t('object-ops.confirmCheck', { action: t(ACTIONS[kind].titleKey) })}
            </label>
            <div class="actions">
              <Button variant="outline" onclick={() => op.discardPlan()}
                >{t('object-ops.editInputs')}</Button
              >
              <Button disabled={!confirmed || !ackOk} onclick={execute}
                >{t('object-ops.execute')}</Button
              >
            </div>
          {/if}
        {:else if op.phase === 'executing'}
          <p role="status">{t('object-ops.executing')}</p>
        {:else}
          {#if op.result}
            <div
              class="feedback {op.result.outcome === 'completed'
                ? 'success-feedback'
                : 'error-feedback'}"
              role={op.result.outcome === 'completed' ? 'status' : 'alert'}
              data-testid={`result-${kind}`}
              data-outcome={op.result.outcome}
            >
              {#if op.result.outcome === 'completed'}<CircleCheck size={18} />{:else}<TriangleAlert
                  size={18}
                />{/if}
              <div>
                <strong>{t(resultKey)}</strong>
                {#if op.result.outcome === 'rejected'}
                  <p>{reasonText(op.result.reason)} {t('object-ops.nothingChanged')}</p>
                {:else if op.result.outcome === 'outcome_unknown'}
                  <p>{t('object-ops.errUnknown')}</p>
                {/if}
                <p class="note">
                  {t('object-ops.statements', {
                    done: op.result.statements_executed,
                    total: op.result.statements_total,
                  })} · {op.result.atomic ? t('object-ops.atomic') : t('object-ops.notAtomic')}
                </p>
                {#if op.result.observation}
                  {@const o = op.result.observation}
                  <ul data-testid="observation">
                    <li>{t('object-ops.obsState')}: {o.state}</li>
                    {#if o.target_exists !== null}<li>
                        {t('object-ops.obsTarget')}: {o.target_exists
                          ? t('object-ops.yes')
                          : t('object-ops.no')}
                      </li>{/if}
                    {#if o.source_exists !== null}<li>
                        {t('object-ops.obsSource')}: {o.source_exists
                          ? t('object-ops.yes')
                          : t('object-ops.no')}
                      </li>{/if}
                    {#if o.rows !== null}<li>{t('object-ops.obsRows')}: {cell(o.rows)}</li>{/if}
                    {#if o.source_rows !== null}<li>
                        {t('object-ops.obsSourceRows')}: {cell(o.source_rows)}
                      </li>{/if}
                    {#if o.auto_increment !== null}<li>
                        {t('object-ops.obsAutoIncrement')}: {cell(o.auto_increment)}
                      </li>{/if}
                    {#if o.collation !== null}<li>
                        {t('object-ops.obsCollation')}: {o.collation}
                      </li>{/if}
                    {#if o.options}<li>
                        {t('object-ops.obsOptions')}: {cell(o.options.engine)} · {cell(
                          o.options.collation,
                        )} · {cell(o.options.auto_increment)}
                      </li>{/if}
                  </ul>
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
                  >{op.unknown
                    ? t('object-ops.outcomeUnknown')
                    : t('object-ops.notExecuted')}</strong
                >
                <p>{op.error}</p>
              </div>
            </div>
          {/if}
          <p class="note">{t('object-ops.locked')}</p>
          <div class="actions">
            <Button variant="outline" onclick={() => op.reset()}>{t('object-ops.newPlan')}</Button>
          </div>
        {/if}
      </div>
    {/if}
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
  }
  code {
    overflow-wrap: anywhere;
  }
</style>
