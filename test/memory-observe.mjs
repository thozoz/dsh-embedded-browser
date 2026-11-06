import { Cdp } from '../lib/cdp.js'
import { execFileSync } from 'node:child_process'
const cdp=await Cdp.connect(Number(process.env.BROWSER_CDP_PORT))
try {
 const target=(await cdp.pages()).find(t=>t.url.startsWith('https://code.thozoz.vip'))
 if(!target)throw new Error('authenticated GUI target missing')
 const page=await cdp.attach(target.id);await page.enable()
 await page.evaluate(`(()=>{
 if(window.__bitmapAudit)return;
 const s=window.__bitmapAudit={created:0,closed:0,bytes:0,resizes:0,frames:0};
 const create=window.createImageBitmap;
 window.createImageBitmap=async function(...args){const b=await create.apply(this,args);s.created++;s.bytes+=b.width*b.height*4;return b};
 const close=ImageBitmap.prototype.close;
 ImageBitmap.prototype.close=function(){s.closed++;return close.call(this)};
 for(const key of ['width','height']){const d=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,key);Object.defineProperty(HTMLCanvasElement.prototype,key,{...d,set(v){s.resizes++;return d.set.call(this,v)}})}
 })()`)
 for(let i=0;i<=18;i++){
 const state=await page.evaluate(`({audit:window.__bitmapAudit,heap:performance.memory?.usedJSHeapSize,nodes:document.getElementsByTagName('*').length,hidden:document.hidden,canvas:[...document.querySelectorAll('canvas')].map(c=>({w:c.width,h:c.height}))})`)
 const processes=execFileSync('ps',['-eo','pid,ppid,rss,comm'],{encoding:'utf8'}).split('\n').filter(l=>/chromium/.test(l)).map(l=>l.trim())
 console.log(JSON.stringify({seconds:i*10,...state,processes}))
 if(i<18)await new Promise(r=>setTimeout(r,10000))
 }
}finally{cdp.close()}
