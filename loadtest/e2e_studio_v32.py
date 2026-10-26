# v3.2: model arena + image understanding. Run: python loadtest/e2e_studio_v32.py
import subprocess, time, json, os, sys, re, urllib.request
from playwright.sync_api import sync_playwright
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
CORS={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
try:
  with sync_playwright() as p:
    br=p.chromium.launch()
    def newpage(extra=None,w=1280,h=800):
        ctx=br.new_context(viewport={'width':w,'height':h}); pg=ctx.new_page(); pg.errs=[]
        pg.on('pageerror',lambda e:pg.errs.append(str(e)))
        pg.route(re.compile(r'https://(fonts\.|api\.github|avatars)'),lambda r:r.abort())
        if extra: extra(pg)
        return pg
    pg=newpage(); pg.goto(B+'studio.html#compare'); pg.wait_for_selector('html[data-ready="1"]')
    ok('studio has 9 tools including Compare',pg.locator('#nav a').count()==9 and pg.locator('#nav a',has_text='Compare').count()==1)
    # ---------- model arena (server mode: provider is forced per card) ----------
    pg.fill('#c-prompt','Explain RAG in one line'); pg.click('#c-run'); W(pg,"document.getElementById('c-groq-out').innerText.includes('Simulated answer') && document.getElementById('c-gemini-out').innerText.includes('Simulated answer')",15000)
    ok('arena: each card is answered by its own provider',('from groq' in pg.inner_text('#c-groq-out')) and ('from gemini' in pg.inner_text('#c-gemini-out')),pg.inner_text('#c-groq-out')[:50])
    ok('arena: latency and token estimate shown for both',re.search(r's · ~\d+ tokens',pg.inner_text('#c-groq-meta')) and re.search(r's · ~\d+ tokens',pg.inner_text('#c-gemini-meta')),pg.inner_text('#c-groq-meta'))
    pg.click('[data-vote="gemini"]'); pg.click('[data-vote="gemini"]'); pg.click('[data-vote="tie"]'); ok('arena: voting updates scoreboard','Gemini 2' in pg.inner_text('#c-score') and 'Tie 1' in pg.inner_text('#c-score'),pg.inner_text('#c-score'))
    pg.reload(); pg.wait_for_selector('html[data-ready="1"]'); ok('arena: votes persist',  'Gemini 2' in pg.inner_text('#c-score'))
    pg.keyboard.press('Control+k'); pg.keyboard.type('compare'); pg.keyboard.press('Enter'); pg.wait_for_timeout(250); ok('palette: jump to Compare',pg.evaluate('location.hash')=='#compare')
    # ---------- image understanding (server) ----------
    pg.goto(B+'studio.html#image'); pg.wait_for_selector('html[data-ready="1"]'); pg.fill('#i-prompt','a red fox'); pg.click('#i-gen'); pg.wait_for_selector('#i-viewer img',timeout=15000)
    for task,label in [('describe','Describe the'),('alt','Write ONE'),('ocr','Transcribe all'),('extract','Extract any')]:
        pg.select_option('#v-task',task); pg.click('#v-go'); W(pg,f"document.getElementById('v-out').innerText.includes('Simulated vision result ({label}')",10000); ok(f'vision (server): {task}',True,pg.inner_text('#v-out')[:60].replace('\n',' '))
    pg.click('#v-save'); pg.wait_for_timeout(500); pg.goto(B+'studio.html#knowledge'); pg.wait_for_selector('html[data-ready="1"]'); ok('vision: result saved to knowledge base',pg.locator('#k-list .doc',has_text='Image extract').count()==1)
    pg.goto(B+'studio.html#image'); pg.wait_for_selector('html[data-ready="1"]'); pg.click('[data-itab="svg"]'); pg.fill('#s-prompt','a robot'); pg.click('#s-gen'); pg.wait_for_function if False else W(pg,"document.querySelector('#i-viewer img') && document.querySelector('#i-viewer img').src.startsWith('data:image/svg')",10000)
    pg.select_option('#v-task','describe'); pg.click('#v-go'); W(pg,"document.getElementById('v-out').innerText.includes('Simulated vision')",10000); ok('vision works on AI-drawn SVGs too',True)
    # ---------- agent uses describe_image ----------
    pg.click('#open-agent'); pg.fill('#ag-in','Please describe the image in my gallery'); pg.click('#ag-go'); W(pg,"document.getElementById('ag-log').innerText.includes('I described the image.')",20000)
    ok('agent: describe_image tool used on the latest gallery image','describe_image' in pg.inner_text('#ag-log'),pg.inner_text('#ag-log')[:100].replace('\n',' '))
    ok('no JS errors (server mode)',not pg.errs,str(pg.errs[:2]))
    # ---------- static host + own keys: arena and vision go direct to the providers ----------
    seen={'gemini_vision':None}
    def nosrv(p):
        p.route(B+'api/health',lambda r:r.fulfill(status=404,body='nf'))
        def groq(r):
            if r.request.method=='OPTIONS': return r.fulfill(status=204,headers=CORS)
            r.fulfill(status=200,content_type='application/json',headers=CORS,body=json.dumps({'choices':[{'message':{'content':'byo groq says hi'}}]}))
        def gem(r):
            if r.request.method=='OPTIONS': return r.fulfill(status=204,headers=CORS)
            b=json.loads(r.request.post_data or '{}')
            if any('inlineData' in x for x in b['contents'][0]['parts']): seen['gemini_vision']=b
            r.fulfill(status=200,content_type='application/json',headers=CORS,body=json.dumps({'candidates':[{'content':{'parts':[{'text':'byo gemini says hi'}]}}]}))
        p.route('https://api.groq.com/**',groq); p.route('https://generativelanguage.googleapis.com/**',gem)
    p2=newpage(nosrv); p2.goto(B+'studio.html#settings'); p2.wait_for_selector('html[data-ready="1"]'); p2.fill('#s-groq','gsk_byo_groq_key_12345678'); p2.fill('#s-gem','AIzaSyByoGeminiKey_1234567890abcdefghijk'); p2.click('#s-save'); p2.wait_for_timeout(500)
    p2.goto(B+'studio.html#compare'); p2.wait_for_selector('html[data-ready="1"]'); p2.fill('#c-prompt','hello'); p2.click('#c-run'); W(p2,"document.getElementById('c-groq-out').innerText.includes('byo groq') && document.getElementById('c-gemini-out').innerText.includes('byo gemini')",15000)
    ok('arena (own keys): each provider answers separately',True)
    p2.goto(B+'studio.html#image'); p2.wait_for_selector('html[data-ready="1"]'); p2.click('[data-itab="svg"]'); p2.fill('#s-prompt','x'); 
    ok('image tab explains AI images need Workers AI when no server',p2.locator('#i-notice').inner_text().startswith('AI image generation runs on Cloudflare'))
    p2.set_input_files('#e-file','/tmp/test_in.png') if p2.click('[data-itab="edit"]') is None else None; p2.wait_for_selector('#e-tools:not([hidden])'); p2.click('#e-save'); p2.wait_for_timeout(600)
    p2.locator('#i-gallery .thumb').first.click(); p2.wait_for_selector('#v-go'); p2.select_option('#v-task','ocr'); p2.click('#v-go'); W(p2,"document.getElementById('v-out').innerText.includes('byo gemini')",10000)
    vb=seen['gemini_vision']; ok('vision (own key): image sent to Gemini as inlineData JPEG with the OCR instruction',vb and vb['contents'][0]['parts'][1]['inlineData']['mimeType']=='image/jpeg' and vb['systemInstruction']['parts'][0]['text'].startswith('Transcribe'),str(vb)[:80] if not vb else '')
    # no server and no keys -> clear message
    p3=newpage(lambda p:p.route(B+'api/health',lambda r:r.fulfill(status=404,body='nf'))); p3.goto(B+'studio.html#image'); p3.wait_for_selector('html[data-ready="1"]'); p3.click('[data-itab="edit"]'); p3.set_input_files('#e-file','/tmp/test_in.png'); p3.wait_for_selector('#e-tools:not([hidden])'); p3.click('#e-save'); p3.wait_for_timeout(600)
    p3.locator('#i-gallery .thumb').first.click(); p3.click('#v-go'); W(p3,"document.getElementById('v-out').innerText.includes('needs a Gemini key')",8000); ok('vision without server or key: clear message',True,p3.inner_text('#v-out')[:80])
    # mobile
    pm=newpage(None,390,844); pm.goto(B+'studio.html#compare'); pm.wait_for_selector('html[data-ready="1"]'); ok('mobile: arena has no horizontal overflow',not pm.evaluate("document.documentElement.scrollWidth>document.documentElement.clientWidth+1"))
    br.close()
finally:
    srv.terminate()
print('\nSUMMARY %d/%d passed'%(sum(R),len(R))); sys.exit(0 if all(R) else 1)
