# v3.3: streaming, share links, E2E-encrypted sync, accessibility and performance audits.   python loadtest/e2e_studio_v33.py
import subprocess, time, json, os, sys, re, urllib.request, hmac, hashlib, base64, gzip
from playwright.sync_api import sync_playwright
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def boot(port,**extra):
    p=subprocess.Popen(['node',f'{ROOT}/loadtest/sim_worker.mjs',f'{ROOT}/site'],env=dict(os.environ,PORT=str(port),SIM_STREAM_DELAY='40',**extra),stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    for _ in range(60):
        try: urllib.request.urlopen(f'http://localhost:{port}/api/health'); return p
        except Exception: time.sleep(0.2)
    raise SystemExit('sim did not start')
srv=boot(8788); srv2=boot(8795,SIM_NO_DO='1')
B='http://localhost:8788/'; B2='http://localhost:8795/'; R=[]
def ok(n,c,x=''): R.append(bool(c)); print(('PASS ' if c else 'FAIL ')+n,x)
def W(pg,expr,timeout=10000):
    end=time.time()+timeout/1000
    while time.time()<end:
        try:
            if pg.evaluate('!!('+expr+')'): return True
        except Exception: pass
        time.sleep(0.12)
    raise TimeoutError('condition not met: '+expr[:120])
HK=lambda raw,info: hmac.new(hmac.new(b'cloudpulse-sync-v1',raw,hashlib.sha256).digest(),info.encode()+b'\x01',hashlib.sha256).digest()
def derive(code):
    raw=base64.b32decode(re.sub('[^A-Z2-7]','',code.upper())); return HK(raw,'id')[:16].hex(), base64.urlsafe_b64encode(HK(raw,'auth')).decode().rstrip('='), HK(raw,'enc')
A11Y="""(()=>{const bad=[];const vis=e=>!e.closest('[hidden]')&&e.getClientRects().length;
document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=option]').forEach(e=>{if(!vis(e)&&!e.matches('input[type=file]'))return;
 const name=(e.getAttribute('aria-label')||'').trim()||(e.getAttribute('aria-labelledby')?'x':'')||(e.labels&&e.labels.length?'x':'')||(e.closest('label')?'x':'')||(e.tagName==='INPUT'||e.tagName==='SELECT'||e.tagName==='TEXTAREA'?'':(e.textContent||'').trim())||(e.getAttribute('title')||'').trim();
 if(!name)bad.push(e.outerHTML.slice(0,90))});
document.querySelectorAll('img').forEach(i=>{if(vis(i)&&!i.hasAttribute('alt'))bad.push('img no alt: '+i.outerHTML.slice(0,60))});
if(!document.documentElement.lang)bad.push('html lang');if(!document.title)bad.push('title');if(!document.querySelector('main'))bad.push('main landmark');return bad})()"""
try:
  with sync_playwright() as p:
    br=p.chromium.launch()
    def ctxpage(base=B,w=1280,h=800):
        ctx=br.new_context(viewport={'width':w,'height':h},accept_downloads=True); pg=ctx.new_page(); pg.errs=[]; pg.msgs=[]
        pg.on('pageerror',lambda e:pg.errs.append(str(e)))
        pg.on('console',lambda m:pg.msgs.append(m.text) if 'Content Security Policy' in m.text else None)
        pg.on('dialog',lambda d:d.accept()); pg.route(re.compile(r'https://(fonts\.|api\.github|avatars)'),lambda r:r.abort()); return ctx,pg
    ctxA,A=ctxpage(); A.goto(B+'studio.html#build'); A.wait_for_selector('html[data-ready="1"]'); A.evaluate("localStorage.setItem('cps:seen','true');0")
    ok('build: 11 templates available',A.locator('#p-build .chip-s').filter(has_text=re.compile('Invoice|Kanban|Pricing|Link in bio|Markdown|Landing|Dashboard|Todo|Calculator|Quiz|Portfolio')).count()>=11)
    # ---------- streaming ----------
    A.fill('#b-prompt','a habit tracker'); A.click('#b-gen'); samples=[]; t0=time.time()
    while time.time()-t0<15:
        st=A.evaluate("(()=>{const l=document.getElementById('b-live');return [l&&!l.hidden,l?l.textContent.length:0,document.getElementById('b-status').textContent,!!document.getElementById('b-frame')]})()")
        samples.append(st)
        if st[3]: break
        time.sleep(0.05)
    live=[s for s in samples if s[0] and s[1]>0]; lens=sorted({s[1] for s in live})
    ok('streaming: code appears live while generating (several growing snapshots)',len(lens)>=3 and any('Writing code' in s[2] for s in live),f'{len(lens)} snapshots, {lens[:6]}')
    A.wait_for_selector('#b-frame'); A.wait_for_timeout(500); ok('streaming: live view hides and the finished app renders in the sandbox',A.locator('#b-live').is_hidden() and [f for f in A.frames if f.url.endswith('preview.html')][0].inner_text('#h').startswith('Sim App'))
    # ---------- publish ----------
    A.click('#b-publish'); A.wait_for_selector('.pubrow',timeout=10000); url=A.get_attribute('.pubrow .pub-link','href')
    ok('publish: link created and listed',re.match(r'^http://localhost:8788/a/[a-z2-7]{10}$',url) is not None,url)
    ctxV,V=ctxpage(); resp=V.goto(url); V.wait_for_timeout(500); h=resp.headers
    ok('published page: renders the app and runs its script',V.inner_text('#h').startswith('Sim App') and (V.click('#b') or True) and V.inner_text('#out')=='script ran in sandbox')
    ok('published page: carries attribution and a report link','Made with CloudPulse Studio' in V.content() and 'report.html?id=' in V.content())
    ok('published page: sandbox CSP, noindex',h['content-security-policy'].startswith('sandbox allow-scripts') and 'noindex' in h['x-robots-tag'])
    ls=V.evaluate("(()=>{try{localStorage.getItem('x');return 'accessible'}catch(e){return 'blocked'}})()"); ok('published page: cannot read your Studio storage (opaque origin)',ls=='blocked',ls)
    net=V.evaluate("fetch('/api/health').then(()=> 'LEAK').catch(()=> 'blocked')"); ok('published page: cannot call your API or the network',net=='blocked',net)
    V.goto(B+'report.html?id='+url.rsplit('/',1)[1]); V.click('#go'); W(V,"document.getElementById('msg').innerText.includes('Thank you')",5000); ok('report page: records a report',True)
    A.click('.pubrow [data-act="unpublish"]'); W(A,"document.querySelectorAll('.pubrow').length==0",8000); ok('unpublish: row removed',True)
    ok('unpublish: link now returns 404',V.goto(url).status==404)
    A.click('[data-tab="code"]'); A.fill('#b-code','<!doctype html><html><body><form><input type="password"></form><p>padding padding padding padding</p></body></html>'); A.click('#b-run'); A.click('#b-publish'); W(A,"document.querySelector('#toasts').innerText.includes('password')",6000); ok('publish: password-field apps are refused',True)
    A.fill('#b-code','<!doctype html><html><body><p>a report target app with enough text to publish</p></body></html>'); A.click('#b-run'); A.click('#b-publish'); A.wait_for_selector('.pubrow'); url2=A.get_attribute('.pubrow .pub-link','href'); rid2=url2.rsplit('/',1)[1]
    for _ in range(3): urllib.request.urlopen(urllib.request.Request(B+'api/report',data=json.dumps({'id':rid2}).encode(),headers={'content-type':'application/json','sec-fetch-site':'same-origin'}))
    ok('moderation: three reports take an app offline',V.goto(url2).status==404)
    # ---------- sync (two devices) ----------
    A.goto(B+'studio.html#tasks'); A.wait_for_selector('html[data-ready="1"]'); A.fill('#t-title','Sync task alpha'); A.click('#t-add')
    A.goto(B+'studio.html#knowledge'); A.wait_for_selector('html[data-ready="1"]'); A.fill('#k-title','Secret plan'); A.fill('#k-text','The launch codename is bluebird-7'); A.click('#k-add'); A.wait_for_selector('#k-list .doc')
    A.goto(B+'studio.html#settings'); A.wait_for_selector('html[data-ready="1"]'); A.click('#sy-create'); A.wait_for_selector('#sy-code-box:not([hidden])',timeout=10000)
    code=A.inner_text('#sy-code'); ok('sync: recovery code is 8 groups of 4 base32 characters',re.match(r'^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$',code) is not None,code)
    W(A,"document.getElementById('sy-status').innerText.includes('cloud version 1')",5000); ok('sync: first backup uploaded (version 1)',True)
    wid,auth,encsk=derive(code); blob=urllib.request.urlopen(urllib.request.Request(B+'api/sync?id='+wid,headers={'sec-fetch-site':'same-origin'})).read()
    ok('sync: the browser and Python derive the same workspace id from the code (HKDF verified)',len(blob)>40 and blob[0]==1,wid)
    ok('sync: the server copy is ciphertext (no plaintext, no gzip header, high entropy)',b'bluebird' not in blob and b'Sync task' not in blob and blob[13:15]!=b'\x1f\x8b' and len(set(blob[13:213]))>100)
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        snap=json.loads(gzip.decompress(AESGCM(encsk).decrypt(blob[1:13],blob[13:],None))); ok('sync: independent AES-GCM decryption in Python recovers the data','bluebird-7' in json.dumps(snap) and 'Sync task alpha' in json.dumps(snap),'kb docs: %d'%len(snap['kb']))
    except ImportError: print('SKIP python AES-GCM decrypt (cryptography not installed)')
    ctxB,Bp=ctxpage(); Bp.goto(B+'studio.html#settings'); Bp.wait_for_selector('html[data-ready="1"]')
    bad=code[:-1]+('A' if code[-1]!='A' else 'B'); Bp.fill('#sy-input',bad); Bp.click('#sy-connect'); W(Bp,"document.querySelector('#toasts').innerText.includes('No cloud copy')",8000); ok('sync: a wrong code finds nothing',True)
    Bp.fill('#sy-input',code.lower().replace('-',' '))
    with Bp.expect_navigation(timeout=20000): Bp.click('#sy-connect')
    Bp.wait_for_selector('html[data-ready="1"]'); Bp.goto(B+'studio.html#tasks'); Bp.wait_for_selector('html[data-ready="1"]')
    ok('sync: second device connects (lowercase, spaces accepted) and receives the tasks',Bp.locator('.task',has_text='Sync task alpha').count()==1)
    Bp.goto(B+'studio.html#knowledge'); Bp.wait_for_selector('html[data-ready="1"]'); ok('sync: and the notes',Bp.locator('#k-list .doc',has_text='Secret plan').count()==1)
    Bp.goto(B+'studio.html#tasks'); Bp.wait_for_selector('html[data-ready="1"]'); Bp.fill('#t-title','From device B'); Bp.click('#t-add'); Bp.goto(B+'studio.html#settings'); Bp.wait_for_selector('#sy-push'); Bp.click('#sy-push'); W(Bp,"document.getElementById('sy-status').innerText.includes('cloud version 2')",8000); ok('sync: device B pushes (version 2)',True)
    A.reload(); A.wait_for_selector('#sy-push'); A.click('#sy-push'); W(A,"document.querySelector('#toasts').innerText.includes('newer data')",8000); ok('sync: stale device is told the cloud has newer data (conflict, nothing overwritten)',True)
    A.click('#sy-force'); W(A,"document.getElementById('sy-status').innerText.includes('cloud version 3')",8000); ok('sync: force push overwrites deliberately (version 3)',True)
    # tamper with the ciphertext as a malicious server/attacker with the auth token would
    bad_blob=b'\x01'+os.urandom(12)+os.urandom(500)  # valid format byte, garbage ciphertext
    r=urllib.request.Request(B+'api/sync',data=bad_blob,method='PUT',headers={'sec-fetch-site':'same-origin','X-Sync-Id':wid,'X-Sync-Auth':auth,'X-Sync-Expected':'force'}); urllib.request.urlopen(r)
    ctxC,C=ctxpage(); C.goto(B+'studio.html#settings'); C.wait_for_selector('html[data-ready="1"]'); C.fill('#sy-input',code); C.click('#sy-connect'); W(C,"document.querySelector('#toasts').innerText.includes('Could not decrypt')",8000); ok('sync: tampered or corrupted cloud data is rejected, never applied',C.evaluate("localStorage.getItem('cps:tasks')")is None)
    A.click('#sy-del'); W(A,"document.getElementById('sy-setup') && !document.getElementById('sy-setup').hidden",8000)
    try: urllib.request.urlopen(urllib.request.Request(B+'api/sync?id='+wid,headers={'sec-fetch-site':'same-origin'})); gone=False
    except urllib.error.HTTPError as e: gone=e.code==404
    ok('sync: deleting the cloud copy removes it from the server',gone)
    # ---------- no Durable Objects deployment ----------
    ctxN,N=ctxpage(B2); N.goto(B2+'studio.html#build'); N.wait_for_selector('html[data-ready="1"]'); N.fill('#b-prompt','x app'); N.click('#b-gen'); N.wait_for_selector('#b-frame',timeout=15000); N.click('#b-publish'); W(N,"document.querySelector('#toasts').innerText.includes('Durable Objects')",6000); ok('no Durable Objects: Publish explains what is missing (no crash)',True)
    N.goto(B2+'studio.html#settings'); N.wait_for_selector('html[data-ready="1"]'); ok('no Durable Objects: sync is disabled with an explanation',N.locator('#sy-create').is_disabled() and 'Durable Objects' in N.inner_text('#s-sync'))
    ok('no Durable Objects: streaming and everything else still work',N.locator('#b-frame').count()==1)
    # ---------- accessibility audit on every panel ----------
    pa=A; allbad={}
    for pid in ['build','image','research','compare','tasks','knowledge','automations','activity','settings']:
        pa.goto(B+f'studio.html#{pid}'); pa.wait_for_selector('html[data-ready="1"]'); pa.wait_for_timeout(150)
        bad=pa.evaluate(A11Y)
        if bad: allbad[pid]=bad
    ok('accessibility: every visible control has an accessible name; lang, title and main landmark present',not allbad,json.dumps(allbad)[:400])
    pa.goto(B+'studio.html#build'); pa.wait_for_selector('html[data-ready="1"]'); pa.keyboard.press('Tab'); ok('accessibility: skip link is the first tab stop',pa.evaluate("document.activeElement.className")=='skip')
    # ---------- performance budget ----------
    ctxP,P=ctxpage(); P.goto(B+'studio.html'); P.wait_for_selector('html[data-ready="1"]'); P.wait_for_timeout(300)
    perf=P.evaluate("(()=>{const r=performance.getEntriesByType('resource').filter(e=>/\\.(js|css)$/.test(e.name));const n=performance.getEntriesByType('navigation')[0];return {js:r.filter(e=>e.name.endsWith('.js')).reduce((a,e)=>a+e.decodedBodySize,0),css:r.filter(e=>e.name.endsWith('.css')).reduce((a,e)=>a+e.decodedBodySize,0),files:r.length,dcl:Math.round(n.domContentLoadedEventEnd)}})()")
    ok('performance: Studio ships under 300 KB of JavaScript and 20 KB of CSS, loads in under 2.5 s on localhost',perf['js']<300000 and perf['css']<20000 and perf['dcl']<2500,json.dumps(perf))
    ok('no JS errors or CSP violations in the whole v3.3 session',not (A.errs+Bp.errs+N.errs+P.errs) and not [m for m in (A.msgs+Bp.msgs+P.msgs+V.msgs) if 'example.com' not in m and '/api/health' not in m],str((A.errs+Bp.errs+N.errs+P.errs)[:3]+[m for m in (A.msgs+Bp.msgs+P.msgs+V.msgs) if 'example.com' not in m and '/api/health' not in m][:2]))  # example.com: the generated test app deliberately phones home; blocking it is the point
    # ---------- own keys: real SSE streaming straight from the providers, plus the non-streaming fallback ----------
    CORS={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
    HTML='<!doctype html><html><head><title>Streamed</title></head><body><h1 id="h">Streamed by my key</h1></body></html>'
    def byo_sse(streaming):
        def setup(pg):
            pg.route(B+'api/health',lambda r:r.fulfill(status=404,body='nf'))
            def groq(r):
                if r.request.method=='OPTIONS': return r.fulfill(status=204,headers=CORS)
                if json.loads(r.request.post_data).get('stream') and streaming:
                    parts=[HTML[i:i+20] for i in range(0,len(HTML),20)]
                    return r.fulfill(status=200,content_type='text/event-stream',headers=CORS,body=''.join('data: '+json.dumps({'choices':[{'delta':{'content':x}}]})+'\n\n' for x in parts)+'data: [DONE]\n\n')
                r.fulfill(status=200,content_type='application/json',headers=CORS,body=json.dumps({'choices':[{'message':{'content':HTML}}]}))
            pg.route('https://api.groq.com/**',groq)
        return setup
    for streaming,label in [(True,'SSE streaming'),(False,'a provider that ignores streaming (fallback)')]:
        c9=br.new_context(); k=c9.new_page(); k.errs=[]; k.on('pageerror',lambda e:k.errs.append(str(e))); k.route(re.compile(r'https://fonts\.'),lambda r:r.abort()); byo_sse(streaming)(k)
        k.goto(B+'studio.html#settings'); k.wait_for_selector('html[data-ready="1"]'); k.fill('#s-groq','gsk_byo_stream_key_123456'); k.click('#s-save'); k.wait_for_timeout(400)
        k.goto(B+'studio.html#build'); k.wait_for_selector('html[data-ready="1"]'); k.fill('#b-prompt','anything'); k.click('#b-gen'); k.wait_for_selector('#b-frame',timeout=15000); k.wait_for_timeout(600)
        f=[x for x in k.frames if x.url.endswith('preview.html')][0]; ok(f'own key: build via {label}',f.inner_text('#h')=='Streamed by my key' and not k.errs)
        c9.close()
    br.close()
finally:
    srv.terminate(); srv2.terminate()
print('\nSUMMARY %d/%d passed'%(sum(R),len(R))); sys.exit(0 if all(R) else 1)
