/**
 * Auth.js's SvelteKit adapter expects the app to own the sign-in POST target;
 * the form in the layout posts here and this hands off to Auth.js, which
 * redirects to Google.
 */
import { signIn } from '../../hooks.server';
import type { Actions } from './$types';

export const actions: Actions = { default: signIn };
