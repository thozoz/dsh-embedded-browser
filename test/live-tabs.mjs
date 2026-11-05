import assert from 'node:assert/strict'
import { Cdp } from '../lib/cdp.js'
const cdp=await Cdp.connect(Number(process.env.BROWSER_CDP_PORT))
const wait=ms=>new Promise(r=>setTimeout(r,ms))
try {
 const target=(await cdp.pages()).find(p=>p.url.startsWith(process.env.GUI_ORIGIN))
 assert.ok(target,'authenticated GUI exists')
 const page=await cdp.attach(target.id);await page.enable()
 const errors=[];page.on('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails?.text))
 const poll=async(expression)=>{for(let i=0;i<80;i++){const v=await page.evaluate(expression);if(v)return v;await wait(100)}throw new Error('Timed out: '+expression)}
 const count=await page.evaluate('document.querySelectorAll(".deb-tab").length')
 assert.ok(count>=2,'initial tabs visible')
 await page.evaluate(`document.querySelector('.deb-tabs > button').click()`)
 await poll(`document.querySelectorAll('.deb-tab').length===${count+1}`)
 assert.equal(await page.evaluate(`document.querySelector('.deb-address').value`),'about:blank')
 console.log('PASS: UI + preserves previous tabs and selects new blank tab')
 await page.evaluate(`(()=>{const e=document.querySelector('.deb-address');e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'https://example.org');e.dispatchEvent(new Event('input',{bubbles:true}));})()`)
 await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
 await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
 await poll(`document.querySelector('.deb-address').value.startsWith('https://example.org') && [...document.querySelectorAll('.deb-tab')].some(e=>e.innerText.includes('Example Domain'))`)
 console.log('PASS: controlled address editing and Enter navigation')
 await page.evaluate(`document.querySelector('.deb-tab button').click()`)
 await poll(`document.querySelector('.deb-tab').dataset.selected==='true'`)
 console.log('PASS: UI tab selection')
 // Ctrl+T/W/L delivered to the focused panel, not the outer browser toolbar.
 await page.evaluate(`document.querySelector('.deb-address').focus()`)
 for(const key of ['t','w','l']) {
  await page.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key,code:'Key'+key.toUpperCase(),modifiers:2,windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0)})
  await page.send('Input.dispatchKeyEvent',{type:'keyUp',key,code:'Key'+key.toUpperCase(),modifiers:2})
  if(key==='t')await poll(`document.querySelectorAll('.deb-tab').length===${count+2}`)
  if(key==='w')await poll(`document.querySelectorAll('.deb-tab').length===${count+1}`)
 }
 assert.equal(await page.evaluate(`document.activeElement.className`),'deb-address')
 console.log('PASS: panel Ctrl+T, Ctrl+W, Ctrl+L')
 await page.evaluate(`document.querySelector('.deb-tab:last-of-type button:last-child').click()`)
 await poll(`document.querySelectorAll('.deb-tab').length===${count}`)
 assert.deepEqual(errors,[])
 console.log('PASS: individual close and no renderer exceptions')
}finally{cdp.close()}
