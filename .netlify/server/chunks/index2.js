import "./state.svelte.js";
import "clsx";
import "@sveltejs/kit/internal";
import "./url.js";
import "./utils2.js";
import "@sveltejs/kit/internal/server";
import "./root.js";
import "./exports.js";
import { g as getContext } from "./index.js";
function context() {
  return getContext("__request__");
}
const page$1 = {
  get error() {
    return context().page.error;
  },
  get status() {
    return context().page.status;
  },
  get url() {
    return context().page.url;
  }
};
const page = page$1;
export {
  page as p
};
