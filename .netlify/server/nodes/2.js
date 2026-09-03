import * as server from '../entries/pages/_page.server.ts.js';

export const index = 2;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/+page.server.ts";
export const imports = ["_app/immutable/nodes/2.CzIORLY2.js","_app/immutable/chunks/Bzak7iHL.js","_app/immutable/chunks/swOMozsQ.js","_app/immutable/chunks/BjL6ChNK.js","_app/immutable/chunks/DaknU7iY.js","_app/immutable/chunks/BRaz59ZX.js","_app/immutable/chunks/kCuydBEV.js","_app/immutable/chunks/D1SM8I_7.js","_app/immutable/chunks/B_40f77_.js","_app/immutable/chunks/C3_ko1Jj.js"];
export const stylesheets = [];
export const fonts = [];
