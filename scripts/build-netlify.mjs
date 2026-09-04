/** Build for Netlify. Kept because the port works; it is simply not what we run. */
import { spawnSync } from 'node:child_process';
const r = spawnSync('npx', ['vite', 'build'], {
	stdio: 'inherit',
	shell: true,
	env: { ...process.env, ADAPTER: 'netlify' }
});
process.exit(r.status ?? 1);
