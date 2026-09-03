import * as server from '../entries/pages/debug/calendar/_page.server.ts.js';

export const index = 5;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/debug/calendar/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/debug/calendar/+page.server.ts";
export const imports = ["_app/immutable/nodes/5.e-w1Omc_.js","_app/immutable/chunks/Bzak7iHL.js","_app/immutable/chunks/swOMozsQ.js","_app/immutable/chunks/BjL6ChNK.js","_app/immutable/chunks/DaknU7iY.js","_app/immutable/chunks/BRaz59ZX.js","_app/immutable/chunks/DmKxJd5z.js","_app/immutable/chunks/DEKSFtjx.js","_app/immutable/chunks/Jy5ymHbL.js","_app/immutable/chunks/rSxho23V.js","_app/immutable/chunks/B_40f77_.js","_app/immutable/chunks/D1SM8I_7.js"];
export const stylesheets = [];
export const fonts = [];
