export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set(["icon-192.png","icon-512.png","icon-maskable-512.png","manifest.webmanifest","service-worker.js"]),
	mimeTypes: {".png":"image/png",".webmanifest":"application/manifest+json"},
	_: {
		client: {start:"_app/immutable/entry/start.DoWRbuOY.js",app:"_app/immutable/entry/app.q_UGgiCR.js",imports:["_app/immutable/entry/start.DoWRbuOY.js","_app/immutable/chunks/rSxho23V.js","_app/immutable/chunks/Jy5ymHbL.js","_app/immutable/chunks/swOMozsQ.js","_app/immutable/chunks/BjL6ChNK.js","_app/immutable/chunks/DEKSFtjx.js","_app/immutable/entry/app.q_UGgiCR.js","_app/immutable/chunks/swOMozsQ.js","_app/immutable/chunks/BjL6ChNK.js","_app/immutable/chunks/Bzak7iHL.js","_app/immutable/chunks/Jy5ymHbL.js","_app/immutable/chunks/DaknU7iY.js","_app/immutable/chunks/BE0Vi7-2.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js')),
			__memo(() => import('./nodes/3.js')),
			__memo(() => import('./nodes/4.js')),
			__memo(() => import('./nodes/5.js')),
			__memo(() => import('./nodes/6.js')),
			__memo(() => import('./nodes/7.js')),
			__memo(() => import('./nodes/8.js')),
			__memo(() => import('./nodes/9.js')),
			__memo(() => import('./nodes/10.js')),
			__memo(() => import('./nodes/11.js')),
			__memo(() => import('./nodes/12.js')),
			__memo(() => import('./nodes/13.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			},
			{
				id: "/add",
				pattern: /^\/add\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 3 },
				endpoint: null
			},
			{
				id: "/api/capture",
				pattern: /^\/api\/capture\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/capture/_server.ts.js'))
			},
			{
				id: "/api/cron/daily",
				pattern: /^\/api\/cron\/daily\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/cron/daily/_server.ts.js'))
			},
			{
				id: "/api/push/subscribe",
				pattern: /^\/api\/push\/subscribe\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/push/subscribe/_server.ts.js'))
			},
			{
				id: "/debug",
				pattern: /^\/debug\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 4 },
				endpoint: null
			},
			{
				id: "/debug/calendar",
				pattern: /^\/debug\/calendar\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 5 },
				endpoint: null
			},
			{
				id: "/plan",
				pattern: /^\/plan\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 6 },
				endpoint: null
			},
			{
				id: "/projects",
				pattern: /^\/projects\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 7 },
				endpoint: null
			},
			{
				id: "/settings",
				pattern: /^\/settings\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 8 },
				endpoint: null
			},
			{
				id: "/share",
				pattern: /^\/share\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 9 },
				endpoint: null
			},
			{
				id: "/signin",
				pattern: /^\/signin\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 10 },
				endpoint: null
			},
			{
				id: "/signout",
				pattern: /^\/signout\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 11 },
				endpoint: null
			},
			{
				id: "/tasks",
				pattern: /^\/tasks\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 12 },
				endpoint: null
			},
			{
				id: "/week",
				pattern: /^\/week\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 13 },
				endpoint: null
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();
