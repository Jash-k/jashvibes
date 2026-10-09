const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
(async()=>{
 let s=fs.readFileSync(path.join(root,'app/api/music/lyrics/route.js'),'utf8');
 for(const name of ['lyricsMatch','musicSources']) s=s.replace(`'@/lib/${name}'`,JSON.stringify(url(fs.readFileSync(path.join(root,`lib/${name}.js`),'utf8'))));
 s=s.replace("import { NextResponse } from 'next/server';",'const NextResponse={json:(body,options)=>({body,...options})};');
 const {GET}=await import(url(s)); let mode='busy',calls=0; const original=fetch;
 const record={id:6450583,trackName:'Pookara',artistName:'Shankar Mahadevan & Vasundra Das',albumName:'Citizen',duration:380,plainLyrics:'FIXTURE',syncedLyrics:'[00:00]FIXTURE'};
 global.fetch=async input=>{calls++;const exact=new URL(input).pathname==='/api/get';return {ok:mode!=='busy',status:mode==='busy'?503:200,headers:new Headers({'Retry-After':'1'}),json:async()=>exact?null:mode==='empty'?[]:[record]};};
 const req=new Request('http://fixture/api/music/lyrics?title=Pookara&artist=Shankar%20Mahadevan&album=Citizen&duration=380&skipSaavn=1');
 try {
 let r=await GET(req);assert.equal(r.status,503);assert(r.body.retryable);assert.equal(calls,1);
 r=await GET(req);assert.equal(r.status,503);assert.equal(calls,1,'cooldown honored');
 await new Promise(r=>setTimeout(r,1050));mode='good';r=await GET(req);assert.equal(r.body.matched.id,6450583,'failure not negative cached');
 let n=calls;await GET(req);assert.equal(calls,n,'positive cache');
 mode='empty';r=await GET(new Request(req.url+'&exclude=6450583'));assert.equal(r.body.source,'none'); n=calls;await GET(new Request(req.url+'&exclude=6450583'));assert.equal(calls,n,'true no-match cache');
 mode='busy';r=await GET(new Request(req.url+'&source=lrclib&force=1'));assert(r.body.retryable,'forced source exposes failure');
 r=await GET(new Request(req.url+'&list=1&force=1'));assert(r.body.sources.find(s=>s.id==='auto').retryable,'picker distinguishes outage');
 console.log('PASS Pookara fixture matching, transient versus no-match, Retry-After, no poisoned negative cache, positive/negative caches, forced source and picker.');
 }finally{global.fetch=original;}
})().catch(e=>{console.error(e);process.exitCode=1});
