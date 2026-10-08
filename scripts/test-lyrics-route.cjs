const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const asUrl=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
(async()=>{
 let source=fs.readFileSync(path.join(root,'app/api/music/lyrics/route.js'),'utf8');
 source=source.replace("'@/lib/lyricsMatch'",JSON.stringify(asUrl(fs.readFileSync(path.join(root,'lib/lyricsMatch.js'),'utf8'))));
 source=source.replace("'@/lib/musicSources'",JSON.stringify(asUrl(fs.readFileSync(path.join(root,'lib/musicSources.js'),'utf8'))));
 source=source.replace("import { NextResponse } from 'next/server';",'const NextResponse = { json: (body) => body };');
 const calls=[]; const originalFetch=global.fetch;
 global.fetch=async url=>{calls.push(String(url));const exact=new URL(url).pathname==='/api/get';return {ok:true,status:200,headers:new Headers(),json:async()=>exact?{id:1,trackName:'Namaste',artistName:'Anirudh Ravichander',albumName:'DC',duration:117,plainLyrics:'WRONG VERSION'}:[{id:2,trackName:'Namaste',artistName:'Anirudh Ravichander',albumName:'DC',duration:150,plainLyrics:'FIXTURE ONLY'}]};};
 const {GET}=await import(asUrl(source));
 try{
 const req=new Request('http://test/api/music/lyrics?title=Namaste&album=DC&artist=Anirudh%20Ravichander&duration=150');
 const result=await GET(req);assert.equal(result.matched.id,2);assert.equal(result.matchVersion,2);assert.equal(calls.length,2);
 const again=await GET(req);assert.equal(again.matched.id,2);assert.equal(calls.length,2);
 const rejected=await GET(new Request(req.url+'&exclude=2&skipSaavn=1&force=1'));assert.equal(rejected.source,'none');assert.equal(rejected.lyrics,'');
 console.log('PASS: wrong exact version rejected, valid search selected, cache hit, rejected record excluded');
 }finally{global.fetch=originalFetch}
})().catch(e=>{console.error(e);process.exitCode=1});
