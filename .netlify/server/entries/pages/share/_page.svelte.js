import "clsx";
function _page($$renderer) {
  $$renderer.push(`<h1 class="text-xl font-semibold">Share to Capacity</h1> <p class="mt-2 text-sm text-neutral-600">Share a link, a note or an image from your phone and it lands in the inbox here.</p> <form method="POST" class="mt-4 max-w-lg space-y-3"><label class="block"><span class="text-xs text-neutral-500">Title</span> <input name="title" class="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"/></label> <label class="block"><span class="text-xs text-neutral-500">Note</span> <textarea name="text" rows="3" class="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"></textarea></label> <button class="rounded bg-neutral-900 px-3 py-2 text-sm text-white">Add to inbox</button></form>`);
}
export {
  _page as default
};
