# Real-browser E2E for CloudPulse Studio against the Worker simulator. Run: python loadtest/e2e_studio.py
import subprocess, time, json, os, sys, zipfile, io, re, base64, urllib.parse, urllib.request
from playwright.sync_api import sync_playwright
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env=dict(os.environ,PORT='8788'); srv=subprocess.Popen(['node',f'{ROOT}/loadtest/sim_worker.mjs',f'{ROOT}/site'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
for _ in range(50):
    try: urllib.request.urlopen('http://localhost:8788/api/health'); break
    except Exception: time.sleep(0.2)
B='http://localhost:8788/'; R=[]
def W(pg,expr,timeout=10000):
    # poll through CDP (page.evaluate); Playwright's wait_for_function needs eval, which the site's strict CSP correctly forbids
    end=time.time()+timeout/1000
    while time.time()<end:
        try:
            if pg.evaluate('!!('+expr+')'): return True
        except Exception: pass
        time.sleep(0.15)
    raise TimeoutError('condition not met: '+expr[:120])
def ok(n,c,x=''): R.append(bool(c)); print(('PASS ' if c else 'FAIL ')+n,x)
WIKI=lambda r: r.fulfill(status=200,content_type='application/json',headers={'access-control-allow-origin':'*'},body=json.dumps({'query':{'search':[{'title':'Test Page'}]}} if 'list=search' in r.request.url else {'query':{'pages':{'1':{'title':'Test Page','extract':'Wikipedia says this is a test page about testing.'}}}}))
try:
  with sync_playwright() as p:
    br=p.chromium.launch()
    def page(w=1280,h=800,extra=None):
        ctx=br.new_context(viewport={'width':w,'height':h},accept_downloads=True); pg=ctx.new_page(); pg.errs=[]; pg.csp=[]
        pg.on('pageerror',lambda e:pg.errs.append(str(e)))
        pg.on('console',lambda m:(pg.csp.append(m.text) if 'Content Security Policy' in m.text else (pg.errs.append('console:'+m.text) if m.type=='error' and 'Failed to load resource' not in m.text and 'ERR_' not in m.text else None)))
        pg.route('https://en.wikipedia.org/**',WIKI)
        pg.route(re.compile(r'https://(fonts\.|api\.github|avatars)'),lambda r:r.abort())
        if extra: extra(pg)
        return pg
    pg=page(); pg.dialogs=[]
    pg.on('dialog',lambda d:d.accept())
    pg.goto(B+'studio.html'); pg.wait_for_selector('html[data-ready="1"]'); pg.wait_for_timeout(300)
    ok('studio loads, 9 tools in nav',pg.locator('#nav a').count()==9, pg.title())
    ok('capability badges: server AI, research and images on',pg.locator('#cap-badges .cap.on').count()==3)
    ok('no JS errors / CSP violations on load',not pg.errs and not pg.csp,str(pg.errs[:2]+pg.csp[:2]))
    # ---------------- BUILD ----------------
    pg.fill('#b-prompt','a habit tracker with streaks'); pg.click('#b-gen'); pg.wait_for_selector('#b-frame',timeout=15000); pg.wait_for_timeout(900)
    fr=[f for f in pg.frames if f.url.endswith('preview.html')][0]
    ok('build: app renders in sandbox iframe',fr.inner_text('#h').startswith('Sim App: a habit tracker'),fr.inner_text('#h')[:40])
    fr.click('#b'); ok('build: generated script runs inside the sandbox',fr.inner_text('#out')=='script ran in sandbox')
    pg.wait_for_timeout(700); ok('sandbox: network access from generated app is blocked',fr.inner_text('#out')!='NETWORK LEAK')
    ls=fr.evaluate("(()=>{try{localStorage.getItem('x');return 'accessible'}catch(e){return 'blocked'}})()"); ok('sandbox: cannot touch the site storage (opaque origin)',ls=='blocked',ls)
    ck=fr.evaluate("(()=>{try{return typeof window.parent.document.title}catch(e){return 'blocked'}})()"); ok('sandbox: cannot read parent page',ck=='blocked',ck)
    hdr=urllib.request.urlopen(B+'preview.html').headers; ok('headers: preview.html has locked CSP and is frameable by same origin only',"connect-src 'none'" in hdr['content-security-policy'] and hdr['x-frame-options']=='SAMEORIGIN' and 'script-src \'self\'' not in hdr['content-security-policy'],hdr['content-security-policy'][:60])
    h2=urllib.request.urlopen(B+'studio.html').headers; ok('headers: studio.html keeps strict CSP + DENY framing',"script-src 'self'" in h2['content-security-policy'] and h2['x-frame-options']=='DENY')
    with pg.expect_download() as d: pg.click('#b-dl-html')
    ok('build: download .html',open(d.value.path()).read().lower().startswith('<!doctype html>'))
    with pg.expect_download() as d: pg.click('#b-dl-zip')
    z=zipfile.ZipFile(d.value.path()); ok('build: download .zip is a valid archive',z.testzip() is None and 'index.html' in z.namelist() and 'README.md' in z.namelist() and 'Sim App' in z.read('index.html').decode(),str(z.namelist()))
    pg.fill('#b-refine','make it purple'); pg.click('#b-refine-go'); W(pg,"document.querySelectorAll('#b-versions button').length==2",timeout=15000); ok('build: refine adds a version',True)
    pg.click('[data-tab="code"]'); pg.fill('#b-code','<!doctype html><title>Edited</title><h1 id="h">Hand edited</h1>'); pg.click('#b-run'); pg.wait_for_timeout(800)
    fr=[f for f in pg.frames if f.url.endswith('preview.html')][0]; ok('build: edit code and re-run preview',fr.inner_text('#h')=='Hand edited')
    pg.click('[data-tab="preview"]'); pg.click('[data-dev="mobile"]'); ok('build: device preview switches',pg.locator('#b-frame.mobile').count()==1)
    # ---------------- IMAGES ----------------
    pg.goto(B+'studio.html#image'); pg.wait_for_selector('html[data-ready="1"]')
    pg.fill('#i-prompt','a red fox'); pg.click('[onclick]' if False else '#i-improve'); W(pg,"document.querySelector('#i-prompt').value.includes('vivid')",timeout=10000); ok('image: improve prompt with AI',True)
    pg.click('#i-gen'); pg.wait_for_selector('#i-viewer img',timeout=15000); src=pg.get_attribute('#i-viewer img','src'); ok('image: AI image generated and shown',src.startswith('data:image/jpeg;base64,/9j/'),src[:30])
    ok('image: saved to gallery',pg.locator('#i-gallery .thumb').count()==1)
    pg.click('[data-itab="svg"]'); pg.fill('#s-prompt','a robot mascot'); pg.click('#s-gen'); W(pg,"document.querySelector('#i-viewer img') && document.querySelector('#i-viewer img').src.startsWith('data:image/svg')",timeout=15000)
    svg=urllib.parse.unquote(pg.get_attribute('#i-viewer img','src').split(',',1)[1])
    ok('svg: scripts, handlers, foreignObject and external links stripped',all(x not in svg.lower() for x in ['<script','onload','foreignobject','evil.example']) and '<circle' in svg,svg[:90])
    pg.click('[data-itab="edit"]'); pg.set_input_files('#e-file','/tmp/test_in.png'); pg.wait_for_selector('#e-tools:not([hidden])'); pg.wait_for_timeout(300)
    dims=lambda: pg.evaluate("[document.getElementById('e-canvas').width,document.getElementById('e-canvas').height]")
    ok('editor: loads local image',dims()==[200,100],str(dims()))
    pg.click('#e-rot'); ok('editor: rotate 90',dims()==[100,200],str(dims()))
    pg.select_option('#e-crop','1:1'); pg.click('#e-crop-go'); ok('editor: crop to 1:1',dims()==[100,100],str(dims()))
    pg.fill('#e-max','64'); pg.click('#e-resize-go'); ok('editor: resize (min 64px)',dims()==[64,64],str(dims()))
    pg.click('#e-undo'); ok('editor: undo',dims()==[100,100])
    pg.evaluate("(()=>{const e=document.getElementById('e-grayscale');e.value=100;e.dispatchEvent(new Event('input'))})()"); pg.click('#e-apply')
    gray=pg.evaluate("(()=>{const c=document.getElementById('e-canvas'),d=c.getContext('2d').getImageData(30,40,1,1).data;return [d[0],d[1],d[2]]})()"); ok('editor: grayscale filter baked into pixels',abs(gray[0]-gray[1])<3 and abs(gray[1]-gray[2])<3,str(gray))
    before=pg.evaluate("document.getElementById('e-canvas').toDataURL().length+document.getElementById('e-canvas').toDataURL().slice(-60)"); pg.fill('#e-text','HELLO'); pg.click('#e-text-go'); after=pg.evaluate("document.getElementById('e-canvas').toDataURL().length+document.getElementById('e-canvas').toDataURL().slice(-60)"); ok('editor: caption drawn on image',before!=after)
    with pg.expect_download() as d: pg.click('#e-export')
    from PIL import Image; im=Image.open(d.value.path()); ok('editor: export PNG is a valid image',im.format=='PNG' and im.size==(100,100),str(im.size))
    n0=pg.locator('#i-gallery .thumb').count(); pg.click('#e-save'); pg.wait_for_timeout(400); ok('editor: save to gallery',pg.locator('#i-gallery .thumb').count()==n0+1)
    pg.fill('#e-ai-prompt','watercolor'); pg.click('#e-ai-go'); pg.wait_for_timeout(1200); ok('editor: AI re-imagine call completes without error',not pg.errs,str(pg.errs[:1]))
    # ---------------- KNOWLEDGE ----------------
    pg.goto(B+'studio.html#knowledge'); pg.wait_for_selector('html[data-ready="1"]')
    pg.fill('#k-title','Pricing notes'); pg.fill('#k-text','The starter plan costs nine dollars per month and includes unlimited notes.'); pg.click('#k-add'); pg.wait_for_selector('#k-list .doc')
    ok('kb: add note',pg.locator('#k-list .doc').count()==1)
    pg.set_input_files('#k-file','/tmp/notes.txt'); W(pg,"document.querySelectorAll('#k-list .doc').length==2",timeout=5000); ok('kb: import text file',True)
    pg.fill('#k-search','starter plan'); pg.wait_for_timeout(300); ok('kb: BM25 search finds the note',pg.locator('#k-list .doc').count()>=1 and 'Pricing' in pg.inner_text('#k-list')); pg.fill('#k-search','')
    pg.locator('#k-list .doc').first.locator('[data-act="summarize"]').click(); W(pg,"document.querySelector('#k-list').innerText.includes('Simulated summary')",timeout=10000); ok('kb: AI summary and tags',('#alpha' in pg.inner_text('#k-list')))
    pg.fill('#k-q','how much is the starter plan'); pg.click('#k-ask'); W(pg,"document.querySelector('#k-answer').innerText.includes('Based on your notes')",timeout=10000); ok('kb: ask with citations',True)
    # ---------------- RESEARCH ----------------
    pg.goto(B+'studio.html#research'); pg.wait_for_selector('html[data-ready="1"]')
    pg.fill('#r-q','what is semantic caching'); pg.click('#r-run'); pg.wait_for_selector('#r-card',timeout=15000)
    links=pg.locator('#r-card .sources a'); ok('research (web): grounded brief, https-only deduplicated sources','Simulated web brief' in pg.inner_text('#r-card') and links.count()==1 and links.first.get_attribute('href')=='https://example.org/a' and links.first.get_attribute('rel')=='noopener noreferrer',str(links.count()))
    pg.click('#r-save'); pg.wait_for_timeout(400); pg.fill('#r-q','deep topic'); pg.check('#r-deep'); pg.click('#r-run'); W(pg,"document.querySelector('#r-card') && document.querySelector('#r-card').innerText.includes('Sub-questions')",timeout=30000); ok('research (deep): sub-questions then synthesized report',True)
    pg.uncheck('#r-deep'); pg.select_option('#r-mode','wiki'); pg.fill('#r-q','testing'); pg.click('#r-run'); W(pg,"document.querySelector('#r-card a') && document.querySelector('#r-card a').innerText.includes('Test Page')",timeout=15000); ok('research (Wikipedia): sources linked',pg.get_attribute('#r-card a','href').startswith('https://en.wikipedia.org/wiki/Test_Page'))
    pg.select_option('#r-mode','kb'); pg.fill('#r-q','starter plan price'); pg.click('#r-run'); W(pg,"document.querySelector('#r-card') && document.querySelector('#r-card').innerText.includes('Based on your notes')",timeout=15000); ok('research (my notes)',True)
    pg.click('#r-tasks'); pg.wait_for_timeout(800)
    # ---------------- TASKS ----------------
    pg.goto(B+'studio.html#tasks'); pg.wait_for_selector('html[data-ready="1"]')
    ok('tasks: "turn into tasks" created AI-planned tasks',pg.locator('#t-board .task').count()==3,str(pg.locator('#t-board .task').count()))
    yday=time.strftime('%Y-%m-%d',time.gmtime(time.time()-172800)); pg.fill('#t-title','Pay invoice'); pg.select_option('#t-pri','high'); pg.fill('#t-due',yday); pg.click('#t-add'); ok('tasks: add with priority and due date, overdue highlighted',pg.locator('.task.late').count()==1)
    card=pg.locator('.task',has_text='Pay invoice'); card.get_by_label('Move right').click(); ok('tasks: move with arrow',pg.locator('[data-col="doing"] .task',has_text='Pay invoice').count()==1)
    pg.locator('.task',has_text='Pay invoice').drag_to(pg.locator('[data-col="done"]')); pg.wait_for_timeout(300); ok('tasks: drag and drop to Done',pg.locator('[data-col="done"] .task',has_text='Pay invoice').count()==1)
    ok('tasks: progress bar',re.search(r'1/\d+ done',pg.inner_text('#t-bar')) is not None,pg.inner_text('#t-bar'))
    pg.fill('#t-goal','launch my product'); pg.click('#t-plan'); W(pg,"document.querySelectorAll('#t-board .task').length==7",timeout=10000); ok('tasks: AI plan from goal',True)
    pg.locator('.task',has_text='Pay invoice').get_by_label('Delete task').click(); ok('tasks: delete',pg.locator('.task',has_text='Pay invoice').count()==0)
    # ---------------- AUTOMATIONS ----------------
    pg.goto(B+'studio.html#automations'); pg.wait_for_selector('html[data-ready="1"]')
    pg.click('[data-preset="Celebrate finished tasks"]'); pg.click('[data-preset="Summarize every new document"]')
    pg.fill('#a-name','Echo tasks'); pg.select_option('#a-trigger','task:created'); pg.select_option('#a-action','create_task'); pg.fill('#a-text','Echo {title}'); pg.click('#a-add'); ok('automations: presets and custom rule added',pg.locator('#a-list .rule').count()==3)
    pg.goto(B+'studio.html#tasks'); pg.wait_for_selector('html[data-ready="1"]'); n=pg.locator('#t-board .task').count()
    pg.fill('#t-title','Seed'); pg.click('#t-add'); pg.wait_for_timeout(500)
    ok('automations: self-triggering rule fires once, no infinite loop',pg.locator('#t-board .task').count()==n+2 and pg.locator('.task',has_text='Echo Seed').count()==1 and pg.locator('.task',has_text='Echo Echo').count()==0,str(pg.locator('#t-board .task').count()))
    seed=lambda col: pg.locator(f'[data-col="{col}"] .task').filter(has=pg.locator('b',has_text=re.compile(r'^Seed$')))
    seed('todo').get_by_label('Move right').click(); seed('doing').get_by_label('Move right').click(); pg.wait_for_timeout(400)
    ok('automations: task moved to Done triggers notification',pg.locator('#toasts .toast',has_text='Done: Seed').count()>=1)
    pg.goto(B+'studio.html#knowledge'); pg.wait_for_selector('html[data-ready="1"]'); pg.fill('#k-title','Auto doc'); pg.fill('#k-text','Meeting minutes about the launch'); pg.click('#k-add')
    W(pg,"[...document.querySelectorAll('#k-list .doc')].some(d=>d.innerText.includes('Auto doc')&&d.innerText.includes('Simulated summary'))",timeout=10000); ok('automations: new document auto-summarized by AI',True)
    pg.goto(B+'studio.html#automations'); pg.wait_for_selector('html[data-ready="1"]'); ok('automations: run counts recorded',re.search(r'[1-9]\d* runs',pg.inner_text('#a-list')) is not None)
    # ---------------- AGENT ----------------
    pg.click('#open-agent'); pg.fill('#ag-in','Create a task and add a note about the launch'); pg.click('#ag-go'); W(pg,"document.querySelector('#ag-log').innerText.includes('I created a task and a note.')",timeout=20000)
    steps=pg.inner_text('#ag-log'); ok('agent: ran create_task then add_note then summarized',('create_task' in steps and 'add_note' in steps),steps[:120].replace('\n',' '))
    pg.keyboard.press('Escape'); pg.click('#ag-close'); pg.goto(B+'studio.html#tasks'); pg.wait_for_selector('html[data-ready="1"]'); ok('agent: its task exists on the board',pg.locator('.task').filter(has=pg.locator('b',has_text=re.compile(r'^Agent task$'))).count()==1)
    # ---------------- ACTIVITY ----------------
    pg.goto(B+'studio.html#activity'); pg.wait_for_selector('html[data-ready="1"]'); types={e.get_attribute('data-type') for e in pg.locator('.logrow').all()}
    ok('activity: timeline covers build, image, research, task, kb, automation, agent',{'build','image','research','task','kb','automation','agent'}<=types,str(types))
    pg.click('[data-f="agent"]'); ok('activity: filter',all(e.get_attribute('data-type')=='agent' for e in pg.locator('.logrow').all()))
    # ---------------- SETTINGS / VAULT ----------------
    pg.goto(B+'studio.html#settings'); pg.wait_for_selector('html[data-ready="1"]')
    pg.fill('#s-groq','gsk_my_secret_key_value_1234'); pg.click('#s-save'); W(pg,"document.querySelector('#s-status').innerText.includes('••••1234')",timeout=5000)
    stored=pg.evaluate("localStorage.getItem('cps:v:groq')"); ok('vault: key stored encrypted, plaintext never in storage',stored and 'gsk_my_secret' not in stored and 'iv' in stored and all('gsk_my_secret' not in (localStorage_v or '') for localStorage_v in pg.evaluate("Object.keys(localStorage).map(k=>localStorage.getItem(k))")))
    pg.click('#s-test'); W(pg,"document.querySelector('#s-result').innerText.includes('Connected')",timeout=10000); ok('settings: test connection via server',('server:groq' in pg.inner_text('#s-result')),pg.inner_text('#s-result'))
    pg.route('https://api.groq.com/**',lambda r:r.fulfill(status=200,content_type='application/json',headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'},body=json.dumps({'choices':[{'message':{'content':'byo ok'}}]})) if r.request.method!='OPTIONS' else r.fulfill(status=204,headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}))
    pg.select_option('#s-provider','byo'); pg.click('#s-test'); W(pg,"document.querySelector('#s-result').innerText.includes('Connected via groq')",timeout=10000); ok('settings: own key used when preferred (decrypted from vault)',True,pg.inner_text('#s-result'))
    with pg.expect_download() as d: pg.click('#s-export')
    bk=json.load(open(d.value.path())); ok('backup: export contains tasks, notes and images but no keys','cps:tasks' in bk['local'] and len(bk['kb'])>=3 and not any(k.startswith('cps:v:') for k in bk['local']) and 'gsk_my_secret' not in json.dumps(bk))
    pg.click('#s-clear'); W(pg,"document.querySelector('#s-status').innerText.includes('Groq key: not set')",timeout=5000); ok('vault: keys removed',pg.evaluate("localStorage.getItem('cps:v:groq')")is None)
    pg.click('#s-wipe'); pg.wait_for_timeout(1200); pg.wait_for_selector('html[data-ready="1"]'); pg.goto(B+'studio.html#tasks'); pg.wait_for_selector('html[data-ready="1"]'); ok('settings: delete everything wipes tasks and notes',pg.locator('#t-board .task').count()==0)
    ok('no unexpected JS errors across the whole session',not [e for e in pg.errs if 'image' not in e.lower()],str(pg.errs[:3]))
    real=[c for c in pg.csp if 'example.com' not in c]  # example.com = the generated test app deliberately trying to phone home; blocking it is the point
    ok('no CSP violations across the whole session (the sandbox blocking a generated app is expected)',not real and len(pg.csp)>=1,str(real[:3]))
    # ---------------- NO SERVER (static host) + own key ----------------
    def nosrv(p):
        p.route(B+'api/health',lambda r:r.fulfill(status=404,body='nf'))
        p.route('https://api.groq.com/**',lambda r:r.fulfill(status=200,content_type='application/json',headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'},body=json.dumps({'choices':[{'message':{'content':'<!doctype html><title>BYO</title><h1 id="h">Built with my key</h1>'}}]})) if r.request.method!='OPTIONS' else r.fulfill(status=204,headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}))
    p2=page(extra=nosrv); p2.goto(B+'studio.html'); p2.wait_for_selector('html[data-ready="1"]')
    ok('static-host mode: badges show server features off',p2.locator('#cap-badges .cap.off').count()==3)
    p2.fill('#b-prompt','a page without any key'); p2.click('#b-gen'); p2.wait_for_selector('#toasts .toast.error',timeout=8000); ok('static-host mode: clear message when no AI is connected','No AI is connected' in p2.inner_text('#toasts'))
    p2.goto(B+'studio.html#settings'); p2.wait_for_selector('html[data-ready="1"]'); p2.fill('#s-groq','gsk_byo_key_for_static_host_1'); p2.click('#s-save'); p2.wait_for_timeout(500)
    p2.goto(B+'studio.html#build'); p2.wait_for_selector('html[data-ready="1"]'); p2.fill('#b-prompt','a page with my own key'); p2.click('#b-gen'); p2.wait_for_selector('#b-frame',timeout=10000); p2.wait_for_timeout(700)
    f2=[f for f in p2.frames if f.url.endswith('preview.html')][0]; ok('static-host mode: builds work with the visitor\'s own encrypted key',f2.inner_text('#h')=='Built with my key')
    ok('static-host mode: image tab explains it needs Workers AI',p2.locator('#i-gen').is_disabled() if (p2.goto(B+'studio.html#image') or p2.wait_for_selector('html[data-ready="1"]') or True) else False)
    # ---------------- MOBILE ----------------
    pm=page(390,844); pm.goto(B+'studio.html'); pm.wait_for_selector('html[data-ready="1"]')
    for pid in ['build','image','research','compare','tasks','knowledge','automations','activity','settings']:
        pm.goto(B+f'studio.html#{pid}'); pm.wait_for_selector('html[data-ready="1"]'); pm.wait_for_timeout(100)
        ov=pm.evaluate("document.documentElement.scrollWidth>document.documentElement.clientWidth+1"); 
        if ov: ok(f'mobile: {pid} has no horizontal overflow',False)
    ok('mobile: no panel overflows horizontally',True)
    pm.click('#open-agent'); box=pm.evaluate("(()=>{const r=document.getElementById('agent').getBoundingClientRect();return [r.left,r.right,innerWidth]})()"); ok('mobile: agent drawer fits the screen',box[0]>=0 and box[1]<=box[2]+1,str(box))
    ok('mobile: no JS errors',not pm.errs,str(pm.errs[:2]))
    # ---------------- HOME PAGE LINKS ----------------
    ph=page(); ph.goto(B); ph.wait_for_timeout(900); ok('home: header CTA opens Studio',ph.get_attribute('.header .btn','href')=='studio.html')
    ph.keyboard.press('Control+k'); ph.keyboard.type('studio'); ph.wait_for_timeout(200); ok('home: command palette lists Open Studio','Open Studio' in ph.inner_text('.pal'))
    br.close()
finally:
    srv.terminate()
print('\nSUMMARY %d/%d passed'%(sum(R),len(R))); sys.exit(0 if all(R) else 1)
