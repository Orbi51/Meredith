import adapter from '@sveltejs/adapter-netlify';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// Netlify Functions (Node), not edge: the app uses a TCP Postgres driver
		// and googleapis, neither of which runs on the edge runtime.
		adapter: adapter()
	}
};

export default config;
