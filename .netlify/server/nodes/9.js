import * as server from '../entries/pages/share/_page.server.ts.js';

export const index = 9;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/share/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/share/+page.server.ts";
export const imports = ["_app/immutable/nodes/9.BTLmONlx.js","_app/immutable/chunks/Bzak7iHL.js","_app/immutable/chunks/swOMozsQ.js"];
export const stylesheets = [];
export const fonts = [];
