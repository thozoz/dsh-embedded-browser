import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserManager, sleep } from '../lib/browser.js'
const root=await mkdtemp(join(tmpdir(),'dsh-tabs-'))
const server=createServer((req,res)=>res.end(`<title>${req.url}</title><input value="kept"><a target="_blank" href="/welcome">Login link</a>`))
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
  await manager.closeTab('a',signup)
  assert.equal((await manager.listTabs('a')).length,2)
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
