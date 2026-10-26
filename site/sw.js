const C='cp-v3.3';
const SHELL=["./", "studio.html", "preview.html", "report.html", "css/studio.css", "favicon.svg", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "js/demo.js", "js/assistant.js", "js/extras.js", "js/va.js", "js/report.js", "js/studio/activity.js", "js/studio/agent.js", "js/studio/automations.js", "js/studio/build.js", "js/studio/compare.js", "js/studio/core.js", "js/studio/image.js", "js/studio/knowledge.js", "js/studio/llm.js", "js/studio/main.js", "js/studio/palette.js", "js/studio/prompts.js", "js/studio/research.js", "js/studio/settings.js", "js/studio/sync.js", "js/studio/tasks.js", "js/studio/zip.js"];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/'))return;
  e.respondWith(fetch(e.request).then(r=>{if(r.ok){const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp))}return r}).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(m=>m||caches.match('studio.html'))));
});
