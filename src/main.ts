// SPDX-License-Identifier: AGPL-3.0-only
import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import './lib/features/settings/theme.css';
import { initializePreferences } from './lib/features/settings/preferences.svelte';
initializePreferences();
mount(App, { target: document.getElementById('app')! });
