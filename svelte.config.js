import adapterNode from '@sveltejs/adapter-node';
import adapterNetlify from '@sveltejs/adapter-netlify';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/*
 * The real deployment is a long-running process on the user's own machine, so
 * adapter-node is the default. The Netlify build stays available behind
 * ADAPTER=netlify in case hosting is ever wanted again.
 */
const useNetlify = process.env.ADAPTER === 'netlify';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: { adapter: useNetlify ? adapterNetlify() : adapterNode() }
};

export default config;
