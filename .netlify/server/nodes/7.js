import * as server from '../entries/pages/projects/_page.server.ts.js';

export const index = 7;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/projects/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/projects/+page.server.ts";
export const imports = ["_app/immutable/nodes/7.wZGSvSDt.js","_app/immutable/chunks/Bzak7iHL.js","_app/immutable/chunks/swOMozsQ.js","_app/immutable/chunks/BjL6ChNK.js","_app/immutable/chunks/DaknU7iY.js","_app/immutable/chunks/BRaz59ZX.js","_app/immutable/chunks/kCuydBEV.js","_app/immutable/chunks/CxHpbLqL.js","_app/immutable/chunks/B_40f77_.js","_app/immutable/chunks/DF77xYAh.js","_app/immutable/chunks/C3_ko1Jj.js"];
export const stylesheets = [];
export const fonts = [];
