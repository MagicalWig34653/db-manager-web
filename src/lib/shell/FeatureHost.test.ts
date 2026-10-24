// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/svelte';
import { expect, it } from 'vitest';
import FeatureHost from './FeatureHost.svelte';
import Throwing from './testing/Throwing.svelte';

it('contains a crashing feature component in an error panel', async () => {
  render(FeatureHost, {
    props: {
      component: Throwing,
      props: { connection: null, token: '', tab: 'x', onsql: () => {}, onwritephase: () => {} },
    },
  });
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Dieser Bereich ist abgestürzt.');
  expect(alert).toHaveTextContent('feature exploded');
});
