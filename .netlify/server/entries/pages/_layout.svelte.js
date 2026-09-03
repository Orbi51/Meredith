import { a as ensure_array_like, b as attr_class, c as attr, e as escape_html } from "../../chunks/index.js";
import { p as page } from "../../chunks/index2.js";
function _layout($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data, children } = $$props;
    const links = [
      ["/", "Today"],
      ["/week", "Week"],
      ["/plan", "Plan"],
      ["/tasks", "Tasks"],
      ["/projects", "Projects"],
      ["/settings", "Settings"]
    ];
    $$renderer2.push(`<div class="mx-auto max-w-6xl p-4"><nav class="mb-4 flex items-center gap-4 text-sm text-neutral-600"><!--[-->`);
    const each_array = ensure_array_like(links);
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let [href, label] = each_array[$$index];
      $$renderer2.push(`<a${attr_class(`hover:text-neutral-900 ${page.url.pathname === href ? "font-medium text-neutral-900" : ""}`)}${attr("href", href)}>${escape_html(label)}</a>`);
    }
    $$renderer2.push(`<!--]--> <span class="ml-auto flex items-center gap-3">`);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (data.session?.user) {
      $$renderer2.push(`<!--[0--><span class="hidden text-xs text-neutral-400 sm:inline">${escape_html(data.session.user.email)}</span> <form method="POST" action="/signout"><button class="cursor-pointer underline hover:text-neutral-900">Sign out</button></form>`);
    } else {
      $$renderer2.push(`<!--[-1--><form method="POST" action="/signin"><input type="hidden" name="providerId" value="google"/> <button class="cursor-pointer underline hover:text-neutral-900">Sign in with Google</button></form>`);
    }
    $$renderer2.push(`<!--]--></span></nav> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (data.session?.user) {
      $$renderer2.push(`<!--[0--><form method="GET" action="/add" class="mb-2 flex gap-2"><input name="text" placeholder="storyboard rev2 Studio X ~6h friday   ·   or  Project - task - 6h - friday   (Ctrl+K)" class="w-full rounded border border-neutral-300 px-3 py-2 text-sm"/> <button class="rounded bg-neutral-900 px-3 py-2 text-sm whitespace-nowrap text-white">Capture</button></form> `);
      {
        $$renderer2.push(`<!--[-1--><div class="mb-4"></div>`);
      }
      $$renderer2.push(`<!--]-->`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    children($$renderer2);
    $$renderer2.push(`<!----></div>`);
  });
}
export {
  _layout as default
};
