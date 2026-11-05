import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDiagnostics } from '../lib/diagnostics.js'
const directory=await mkdtemp(join(tmpdir(),'dsh-diagnostics-'))
const previous=process.env.DSH_HOME
try {
 process.env.DSH_HOME=directory
 const log=createDiagnostics()
 log.write('test',{method:'Page.navigate',ms:30000,cookie:'SECRET',text:'PASSWORD',url:'https://example.com/?token=SECRET'})
 const text=await readFile(log.path,'utf8')
 assert.ok(!text.includes('SECRET')&&!text.includes('PASSWORD'))
 assert.equal(JSON.parse(text).method,'Page.navigate')
 console.log('PASS: diagnostics retain timing and exclude page/input/credential fields')
} finally {
 if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous
 assert.ok(directory.startsWith(join(tmpdir(),'dsh-diagnostics-')))
 await rm(directory,{recursive:true,force:true})
}
