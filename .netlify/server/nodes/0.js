import * as server from '../entries/pages/_layout.server.ts.js';

export const index = 0;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_layout.svelte.js')).default;
export { server };
export const server_id = "src/routes/+layout.server.ts";
export const imports = ["_app/immutable/nodes/0.D7Q53Ffx.js","_app/immutable/chunks/Bzak7iHL.js","_app/immutable/chunks/Jy5ymHbL.js","_app/immutable/chunks/swOMozsQ.js","_app/immutable/chunks/BjL6ChNK.js","_app/immutable/chunks/DaknU7iY.js","_app/immutable/chunks/BRaz59ZX.js","_app/immutable/chunks/kCuydBEV.js","_app/immutable/chunks/D1SM8I_7.js","_app/immutable/chunks/B_40f77_.js","_app/immutable/chunks/BE0Vi7-2.js","_app/immutable/chunks/CHDGG7Xf.js","_app/immutable/chunks/DEKSFtjx.js"];
export const stylesheets = ["_app/immutable/assets/0.DJrH6oS4.css"];
export const fonts = [];
