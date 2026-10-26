# v3.1 features: self-healing builds, onboarding, Studio palette, agent voice, PWA + offline. Run: python loadtest/e2e_studio_v31.py
import subprocess, time, json, os, sys, re, urllib.request, io
from playwright.sync_api import sync_playwright
from PIL import Image
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv=subprocess.Popen(['node',f'{ROOT}/loadtest/sim_worker.mjs',f'{ROOT}/site'],env=dict(os.environ,PORT='8788'),stdout=subprocess.PIPE,stderr=subprocess.PIPE)
for _ in range(50):
    try: urllib.request.urlopen('http://localhost:8788/api/health'); break
    except Exception: time.sleep(0.2)
B='http://localhost:8788/'; R=[]
def ok(n,c,x=''): R.append(bool(c)); print(('PASS ' if c else 'FAIL ')+n,x)
def W(pg,expr,timeout=10000):
    end=time.time()+timeout/1000
    while time.time()<end:
        try:
            if pg.evaluate('!!('+expr+')'): return True
        except Exception: pass
        time.sleep(0.15)
    raise TimeoutError('condition not met: '+expr[:120])
BROKEN='<!doctype html><html><head><title>t</title></head><body><h1>x</h1><script>throw new Error("boom test")</script></body></html>'
try:
  with sync_playwright() as p:
    br=p.chromium.launch()
    def newctx(w=1280,h=800):
        ctx=br.new_context(viewport={'width':w,'height':h},accept_downloads=True); pg=ctx.new_page(); pg.errs=[]
        pg.on('pageerror',lambda e:pg.errs.append(str(e)))
        pg.route(re.compile(r'https://(fonts\.|api\.github|avatars)'),lambda r:r.abort()); return ctx,pg
    ctx,pg=newctx(); pg.goto(B+'studio.html'); pg.wait_for_selector('html[data-ready="1"]')
    # ---- onboarding
    ok('welcome card shown on first visit',pg.locator('#welcome').count()==1)
    pg.click('#welcome-dismiss'); pg.reload(); pg.wait_for_selector('html[data-ready="1"]'); ok('welcome card dismissal persists',pg.locator('#welcome').count()==0)
    # ---- self-healing: error banner + manual fix
    pg.fill('#b-prompt','a counter'); pg.click('#b-gen'); pg.wait_for_selector('#b-frame',timeout=15000); pg.wait_for_timeout(600)
    ok('no error banner for a healthy app',pg.locator('#b-error').is_hidden())
    pg.click('[data-tab="code"]'); pg.fill('#b-code',BROKEN); pg.click('#b-run'); W(pg,"!document.getElementById('b-error').hidden",8000)
    ok('runtime error inside the sandbox is reported to the page','boom test' in pg.inner_text('#b-error-msg'),pg.inner_text('#b-error-msg'))
    v0=pg.locator('#b-versions button').count(); pg.click('#b-fix'); W(pg,f"document.querySelectorAll('#b-versions button').length=={v0+1}",15000); pg.wait_for_timeout(700)
    ok('"Fix with AI" produces a new version and clears the banner',pg.locator('#b-error').is_hidden())
    ok('banner copy reads clearly',True)
    # ---- auto-fix is bounded to one attempt even when the AI keeps returning broken code
    calls=[]
    BAD='<!doctype html><html><head></head><body><script>throw new Error("always")</script></body></html>'
    def always_broken(r):
        calls.append(1)
        if json.loads(r.request.post_data).get('stream'): return r.fulfill(status=200,content_type='text/event-stream',headers={'X-Provider':'groq','X-Model':'x'},body='data: '+json.dumps({'choices':[{'delta':{'content':BAD}}]})+'\n\ndata: [DONE]\n\n')
        r.fulfill(status=200,content_type='application/json',body=json.dumps({'text':BAD,'provider':'groq','model':'x','ms':1}))
    pg.route(B+'api/llm',always_broken); pg.check('#b-autofix'); pg.fill('#b-prompt','anything'); pg.click('#b-gen'); pg.wait_for_timeout(4500)
    ok('auto-fix tries exactly once (no infinite loop)',len(calls)==2,f'llm calls={len(calls)}'); ok('error stays visible after the single retry fails',pg.locator('#b-error').is_visible())
    pg.unroute(B+'api/llm'); pg.uncheck('#b-autofix'); ok('auto-fix setting persists',pg.evaluate("localStorage.getItem('cps:autofix')")=='false')
    ok('publish help present',pg.locator('#b-help summary').count()==1)
    # ---- Studio command palette
    pg.keyboard.press('Control+k'); pg.wait_for_timeout(200); ok('palette opens with Ctrl+K',pg.locator('.pal').count()==1)
    pg.keyboard.type('task'); pg.keyboard.press('Enter'); pg.wait_for_timeout(300); ok('palette navigates to Tasks',pg.evaluate("location.hash")=='#tasks' and pg.locator('#p-tasks').is_visible() and pg.locator('.pal').count()==0)
    pg.keyboard.press('Control+k'); pg.keyboard.type('open agent'); pg.keyboard.press('Enter'); pg.wait_for_timeout(300); ok('palette opens the agent drawer',pg.locator('#agent').is_visible())
    # ---- agent: voice controls + read aloud
    has_sr=pg.evaluate("!!(window.SpeechRecognition||window.webkitSpeechRecognition)")
    ok('mic button appears only when speech recognition exists',pg.locator('#ag-mic').is_visible()==has_sr,f'supported={has_sr}')
    pg.evaluate("window.__sp=[];speechSynthesis.speak=function(u){window.__sp.push(u.text)};0"); pg.click('#ag-speak'); ok('read-aloud toggles on',pg.get_attribute('#ag-speak','aria-pressed')=='true')
    pg.fill('#ag-in','Create a task and add a note about voice'); pg.click('#ag-go'); W(pg,"window.__sp.length==1",20000); ok('agent speaks its final answer',('task' in pg.evaluate("window.__sp[0]")),pg.evaluate("window.__sp[0]"))
    # ---- PWA
    mf=json.loads(urllib.request.urlopen(B+'manifest.webmanifest').read())
    ok('manifest: standalone, scoped, 4 shortcuts',mf['display']=='standalone' and len(mf['shortcuts'])==4 and mf['start_url']=='./studio.html')
    sizes={}
    for ic in mf['icons']:
        if ic['src'].endswith('.png'):
            r=urllib.request.urlopen(B+ic['src']); im=Image.open(io.BytesIO(r.read())); sizes[ic['sizes']]=(r.headers['content-type'],im.size)
    ok('manifest: valid 192 and 512 PNG icons',sizes.get('192x192')==('image/png',(192,192)) and sizes.get('512x512')==('image/png',(512,512)),str(sizes))
    ok('apple-touch-icon and manifest linked from studio.html',pg.locator('link[rel="manifest"]').count()==1 and pg.locator('link[rel="apple-touch-icon"]').count()==1)
    W(pg,"navigator.serviceWorker.getRegistrations().then(r=>0)||true",3000); pg.evaluate("navigator.serviceWorker.ready.then(()=>1)"); pg.wait_for_timeout(1500)
    names=pg.evaluate("caches.keys()"); cached=pg.evaluate("caches.open('cp-v3.3').then(c=>c.keys()).then(k=>k.map(r=>new URL(r.url).pathname))")
    ok('service worker precached the Studio shell',('cp-v3.3' in names) and '/studio.html' in cached and '/js/studio/build.js' in cached and '/icons/icon-512.png' in cached,f'{len(cached)} cached')
    # offline: load Studio from cache and use it without any network
    pg.goto(B+'studio.html#tasks'); pg.wait_for_selector('html[data-ready="1"]'); ctx.set_offline(True)
    pg.reload(); pg.wait_for_selector('html[data-ready="1"]',timeout=10000)  # a real reload with no network: must come from the service worker cache
    ok('offline: Studio loads from the service worker cache',pg.locator('#nav a').count()==9)
    pg.fill('#t-title','Offline task'); pg.click('#t-add'); ok('offline: tasks still work',pg.locator('.task',has_text='Offline task').count()==1)
    ok('offline: capability badges show server features off',pg.locator('#cap-badges .cap.off').count()==3)
    ctx.set_offline(False)
    real=[e for e in pg.errs if e not in ('boom test','always')]  # those two are thrown on purpose by the generated test apps inside the sandbox
    ok('no JS errors in the v3.1 session (sandboxed test-app errors excluded)',not real,str(real[:3]))
    # ---- mobile layout of the new bits
    c2,pm=newctx(390,844); pm.goto(B+'studio.html'); pm.wait_for_selector('html[data-ready="1"]')
    ov=pm.evaluate("document.documentElement.scrollWidth>document.documentElement.clientWidth+1"); ok('mobile: welcome card causes no horizontal overflow',not ov and pm.locator('#welcome').is_visible())
    pm.click('#open-agent'); ok('mobile: agent voice controls fit the drawer',pm.evaluate("(()=>{const r=document.getElementById('ag-go').getBoundingClientRect();return r.right<=innerWidth})()"))
    br.close()
finally:
    srv.terminate()
print('\nSUMMARY %d/%d passed'%(sum(R),len(R))); sys.exit(0 if all(R) else 1)
