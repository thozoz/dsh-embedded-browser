import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserManager, sleep } from '../lib/browser.js'
import { ScreencastHub } from '../lib/screencast.js'
import { HumanBroker } from '../lib/human.js'
const root=await mkdtemp(join(tmpdir(),'dsh-tabs-'))
const server=createServer((req,res)=>{
  if(req.url==='/slow')return setTimeout(()=>res.end('<title>/slow</title>'),1500)
  res.end(`<title>${req.url}</title><input value="kept"><a target="_blank" href="/welcome">Login link</a>`)
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const base=`http://127.0.0.1:${server.address().port}`
const manager=new BrowserManager({config:{profileDir:join(root,'profile'),mode:'headless',viewport:'1000x700'}})
try {
  const first=await manager.navigate('a',base+'/signup')
  const signup=first.session.tabId
  const second=await manager.newTab('a',base+'/mail')
  const mail=second.session.tabId
  assert.notEqual(signup,mail)
  assert.equal(second.session.tabs.length,2)
  await manager.selectTab('a',signup)
  assert.equal(await manager.evaluate('a','document.querySelector("input").value'),'kept')
  await manager.navigate('b',base+'/foreign')
  await assert.rejects(manager.selectTab('b',signup),/Unknown tab/)
  await assert.rejects(manager.closeTab('b',mail),/Unknown tab/)
  await manager.selectTab('a',mail)
  await manager.snapshot('a')
  await manager.clickText('a','Login link')
  let tabs=[]
  for(let i=0;i<30;i++){tabs=await manager.listTabs('a');if(tabs.length===3)break;await sleep(100)}
  assert.equal(tabs.length,3,'popup adopted via opener')
  assert.ok(tabs.find(t=>t.selected).url.endsWith('/welcome'))
  assert.equal((await manager.listTabs('b')).length,1)
  const hub=new ScreencastHub({manager,human:new HumanBroker({}),viewport:{width:1000,height:700},quality:50,maxWidth:1000,maxHeight:700})
  const messages=[]
  const connection={sessionId:'a',sendJson:m=>messages.push(m),sendBinary:()=>{}}
  try {
    await hub.handleMessage(connection,{type:'input',kind:'text',text:'WRONG',tabId:signup})
    assert.equal(messages.at(-1).type,'error','stale panel input refused')
    await manager.selectTab('a',mail)
    const point=await manager.evaluate('a',`(()=>{const r=document.querySelector('a').getBoundingClientRect();return {x:r.x+2,y:r.y+2}})()`)
    await hub.handleMessage(connection,{type:'open-link',tabId:mail,...point})
    assert.equal((await manager.listTabs('a')).length,4,'context link opens owned tab')
    await manager.selectTab('a',mail)
    await hub.handleMessage(connection,{type:'input',kind:'mouse',event:'up',button:'left',modifiers:['ctrl'],tabId:mail,...point})
    for(let i=0;i<30;i++){if((await manager.listTabs('a')).length===5)break;await sleep(100)}
    assert.equal((await manager.listTabs('a')).length,5,'Ctrl-click popup adopted')
  } finally { await hub.close() }
  await manager.closeTab('a',signup)
  assert.equal((await manager.listTabs('a')).length,4)
  const slowNav=manager.newTab('a',base+'/slow')
  await sleep(150)
  const t0=Date.now()
  const midStatus=await manager.status('a')
  assert.ok(Date.now()-t0<400,'status does not block while a tab is navigating')
  assert.equal(midStatus.session.tabs.length,5,'all tabs remain visible during slow navigation')
  await slowNav
  manager.setKeepAliveMinutes(0)
  assert.equal((await manager.status('a')).keepAliveMinutes,0,'keepAliveMinutes override to 0 (infinite)')
  manager.setKeepAliveMinutes(60)
  assert.equal((await manager.status('a')).keepAliveMinutes,60,'keepAliveMinutes override to 60')
  await manager.selectTab('a',mail)
  await manager.evaluate('a','document.querySelector("input").value="user-typed"')
  assert.equal(await manager.hasDirtyForms(),true,'dirty form detected when input modified')
  await manager.evaluate('a','document.querySelector("input").value="kept"')
  assert.equal(await manager.hasDirtyForms(),false,'clean form detected when input matches defaultValue')
  await manager.closeSession('a')
  assert.equal((await manager.listTabs('a')).length,0)
  assert.equal((await manager.listTabs('b')).length,1)
  console.log('PASS: multiple tabs, preserved form, popup selection, ownership and cleanup')
} finally {
  await manager.stop()
  await new Promise(r=>server.close(r))
  // Only the unique temporary test directory created above is removed.
  assert.ok(root.startsWith(join(tmpdir(),'dsh-tabs-')))
  await rm(root,{recursive:true,force:true})
}
