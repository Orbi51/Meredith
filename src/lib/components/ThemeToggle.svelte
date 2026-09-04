<script lang="ts">
	/**
	 * Light / dark / system, in that cycle.
	 *
	 * "System" is the default and is stored as the ABSENCE of a preference, so
	 * a machine that switches to dark in the evening carries the app with it
	 * unless the user has explicitly said otherwise.
	 *
	 * The class itself is first applied by the inline script in app.html, before
	 * the page paints. This component only changes it afterwards.
	 */
	import { onMount } from 'svelte';

	type Theme = 'light' | 'dark' | 'system';

	let theme = $state<Theme>('system');

	function apply(next: Theme) {
		const dark =
			next === 'dark' ||
			(next === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
		document.documentElement.classList.toggle('dark', dark);

		try {
			if (next === 'system') localStorage.removeItem('theme');
			else localStorage.setItem('theme', next);
		} catch {
			/* storage blocked; the choice simply will not persist */
		}
	}

	onMount(() => {
		try {
			const stored = localStorage.getItem('theme');
			theme = stored === 'dark' || stored === 'light' ? stored : 'system';
		} catch {
			theme = 'system';
		}

		// Follow the system while no explicit choice has been made.
		const media = window.matchMedia('(prefers-color-scheme: dark)');
		const onChange = () => {
			if (theme === 'system') apply('system');
		};
		media.addEventListener('change', onChange);
		return () => media.removeEventListener('change', onChange);
	});

	function cycle() {
		theme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
		apply(theme);
	}

	const label = $derived(
		theme === 'system' ? 'follows your system' : theme === 'light' ? 'light' : 'dark'
	);
	const icon = $derived(theme === 'system' ? '◐' : theme === 'light' ? '☀' : '☾');
</script>

<button
	onclick={cycle}
	class="cursor-pointer rounded px-1.5 py-0.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
	title="Theme: {label}"
	aria-label="Theme: {label}. Click to change."
>
	{icon}
</button>
