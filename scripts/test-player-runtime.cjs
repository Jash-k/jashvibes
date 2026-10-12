const fs=require('fs'),assert=require('assert/strict');
(async()=>{
 const {runtimeTotal,playbackTimeLabel,fmtTime}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync('lib/player/labels.js')).toString('base64'));
 // No real runtime → no readout: live (Infinity), NaN, 0, negative, junk, placeholder.
 for(const d of [Infinity,-Infinity,NaN,0,-5,undefined,null,'',86400,86401])assert.equal(runtimeTotal(d),0,String(d));
 for(const d of [1,6300,86399,'6300'])assert.ok(runtimeTotal(d)>0);
 assert.equal(playbackTimeLabel({time:10,duration:Infinity}),null);
 assert.equal(playbackTimeLabel({time:10,duration:0}),null);
 assert.equal(playbackTimeLabel({time:10}),null);
 // Elapsed runs from the seek-window start, so a DVR-style window still counts from 0:00.
 assert.deepEqual(playbackTimeLabel({time:754,start:0,duration:6300}),{elapsed:754,total:6300,short:'12:34',pair:'12:34 / 1:45:00'});
 assert.equal(playbackTimeLabel({time:814,start:60,duration:6300}).short,'12:34');
 assert.equal(playbackTimeLabel({time:-30,start:0,duration:6300}).elapsed,0);
 assert.equal(fmtTime(3600),'1:00:00');
 // Sub-hour totals stay short; the pair is what the bar renders above the sm breakpoint.
 assert.equal(playbackTimeLabel({time:59,duration:3599}).pair,'0:59 / 59:59');
 assert.equal(playbackTimeLabel({time:0,duration:6300}).pair,'0:00 / 1:45:00');
 const js=fs.readFileSync('components/player/JashPlayer.js','utf8');
 assert.ok(js.includes("import { fmtTime, playbackTimeLabel, warnForSource }"));
 assert.ok(js.includes("time, duration, model"));
 assert.ok(js.includes('data-dvp="runtime"'));
 assert.ok(js.includes('hidden text-white/40 sm:inline'),'phone form hides the total');
 console.log('Player runtime readout: live/unknown suppression, window-relative elapsed, phone/desktop forms and wiring passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
