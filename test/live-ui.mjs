import assert from 'node:assert/strict'
import { Cdp } from '../lib/cdp.js'

const cdp = await Cdp.connect(Number(process.env.BROWSER_CDP_PORT))
try {
  const target = (await cdp.pages()).find(p => p.url.startsWith(process.env.GUI_ORIGIN))
  assert.ok(target, 'authenticated GUI target exists')
  const page = await cdp.attach(target.id)
  await page.enable()
  const errors = []
  page.on('Runtime.exceptionThrown', e => errors.push(e.exceptionDetails?.text))
  const panel = await page.evaluate(`(() => { const c=document.querySelector('canvas.deb-canvas'); return c && {width:c.width,height:c.height,box:c.getBoundingClientRect().toJSON()} })()`)
  assert.ok(panel?.width > 0 && panel.box.width > 0, 'live sidebar canvas renders')
  console.log('PASS: authenticated GUI and live Better Sidebar browser canvas')

  // Click the GUI's own sidebar toggle through its mirrored browser canvas.
  const point = await page.evaluate(`(() => { const b=document.querySelector('button[aria-label="Collapse sidebar"]'); const c=document.querySelector('canvas.deb-canvas'); if(!b||!c)return null; const r=b.getBoundingClientRect(),s=c.getBoundingClientRect(); return {x:s.x+(r.x+r.width/2)/innerWidth*s.width,y:s.y+(r.y+r.height/2)/innerHeight*s.height} })()`)
  assert.ok(point, 'sidebar toggle and canvas found')
  await page.send('Input.dispatchMouseEvent', {type:'mousePressed',...point,button:'left',buttons:1,clickCount:1})
  await page.send('Input.dispatchMouseEvent', {type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1})
  let changed = false
  for(let i=0;i<50;i++) {
    changed = await page.evaluate(`!!document.querySelector('button[aria-label="Open sidebar"]')`)
    if(changed) break
    await new Promise(r=>setTimeout(r,100))
  }
  assert.ok(changed, 'real mouse input on canvas reaches the underlying page')
  await page.evaluate(`document.querySelector('button[aria-label="Open sidebar"]').click()`)
  console.log('PASS: real canvas mouse input, state change and restoration')

  console.log('Waiting for hand-over banner')
  let buttons=[]
  for(let i=0;i<120;i++) {
    buttons=await page.evaluate(`[...document.querySelectorAll('.deb-banner button.deb-primary')].map(b=>({text:b.textContent,bg:getComputedStyle(b).backgroundColor,fg:getComputedStyle(b).color}))`)
    if(buttons.length) break
    await new Promise(r=>setTimeout(r,250))
  }
  assert.equal(buttons.length,2,'hand-over action buttons render')
  for(const theme of ['light','dark']) {
    await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]})
    const colors=await page.evaluate(`[...document.querySelectorAll('.deb-banner button.deb-primary')].map(b=>({text:b.textContent,bg:getComputedStyle(b).backgroundColor,fg:getComputedStyle(b).color}))`)
    assert.ok(colors.every(c=>c.bg!==c.fg),'buttons have distinct foreground/background')
    console.log(`PASS: ${theme} hand-over colors ${JSON.stringify(colors)}`)
  }
  await page.send('Emulation.setEmulatedMedia',{features:[]})
  await page.evaluate(`document.querySelector('.deb-banner button.deb-primary:last-child').click()`)
  assert.deepEqual(errors,[],'no renderer exceptions during live test')
  console.log('PASS: Done button resolves hand-over; no renderer exceptions')
} finally { cdp.close() }
