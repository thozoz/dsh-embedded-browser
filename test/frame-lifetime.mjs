import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const source=await readFile(new URL('../lib/client.js',import.meta.url),'utf8')
const callback=source.split('const paint = useCallback(')[1].split('\n\n      /** Send one panel')[0].replace(/, \[\]\);?\s*$/,'')
let closes=0,draws=0,resizes=0,decodes=0,fail=false,resolveDecode
const canvas={getContext:()=>({drawImage(){draws++;if(fail)throw Error('draw failure')}})}
let width=1440,height=900
for(const key of ['width','height'])Object.defineProperty(canvas,key,{get:()=>key==='width'?width:height,set:v=>{resizes++;if(key==='width')width=v;else height=v}})
const ref={current:canvas},document={visibilityState:'visible'}
const context={canvasRef:ref,document,setHasFrame:()=>{},setFailure:()=>{},Blob,createImageBitmap:async()=>{decodes++;return {width:1440,height:900,close(){closes++}}}}
const paint=vm.runInNewContext('('+callback+')',context)
for(let i=0;i<100;i++)await paint(new Uint8Array())
assert.equal(closes,100);assert.equal(draws,100);assert.equal(resizes,0,'unchanged dimensions never reset canvas')
fail=true;await paint(new Uint8Array());assert.equal(closes,101,'draw failure releases bitmap');fail=false
context.createImageBitmap=()=>new Promise(r=>resolveDecode=r)
const pending=paint(new Uint8Array());ref.current=null
resolveDecode({width:1440,height:900,close(){closes++}});await pending
assert.equal(closes,102,'decode finishing after unmount releases bitmap');assert.equal(draws,101)
ref.current=canvas;document.visibilityState='hidden';await paint(new Uint8Array());assert.equal(decodes,101,'hidden page skips decode')
console.log('PASS: 100 frames closed; no redundant canvas resets; failure/unmount/hidden paths safe')
