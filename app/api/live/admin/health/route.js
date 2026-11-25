import { NextResponse } from 'next/server';
import { requireServiceAuth } from '@/lib/serverAuth';
import dbConnect from '@/lib/db';
import LiveChannel from '@/models/LiveChannel';
import { HEALTH_VERSION, healthFingerprintInput, flagshipPriority } from '@/lib/live/health';
import { resolutionHealth } from '@/lib/live/playback/resolveHealth';
import { checkAndUpdateChannel, toClientChannel, healthChannel } from '@/lib/liveService';
const json=(data,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(request){
 try{await requireServiceAuth(request);await dbConnect();
  const rows=await LiveChannel.find({hidden:{$ne:true}}).select('channelId name customName sourceId playbackHealth workingStatus').limit(10000).lean();
  rows.sort((a,b)=>flagshipPriority(a)-flagshipPriority(b));
  return json({ok:true,channels:rows.map(r=>({channelId:r.channelId,name:r.customName||r.name,sourceId:r.sourceId,health:r.playbackHealth||{state:'discovered'}}))});
 }catch(e){return json({ok:false,error:e.message},e.status||500);}
}
export async function POST(request){
 try{await requireServiceAuth(request);await dbConnect();const body=await request.json();
  const row=await LiveChannel.findOne({channelId:String(body.channelId||'')});
  if(!row)return json({ok:false,error:'Channel not found'},404);
  if(body.action==='confirm-browser'){
   if(body.confirmedAudioVideo!==true)return json({ok:false,error:'Confirm you personally watched at least 30 seconds of correct audio and video in Preview.'},400);
   const ch=await healthChannel(row),ready=resolutionHealth(ch);
   if(!String(ch.url||'').startsWith('https://'))return json({ok:false,error:'HTTPS stream required for public admission.'},409);
   if(!ready.ok)return json({ok:false,error:ready.error},409);
   const now=Date.now();
   row.cookie=ch.cookie; row.url=ch.url;
   for(const key of ['keyId','key','licenseKey','licenseType'])row[key]=ch[key];
   row.playbackHealth={version:HEALTH_VERSION,fingerprintInput:healthFingerprintInput(ch),state:'healthy',successes:2,failures:0,
    checkedAt:now,browserConfirmedAt:now,browserUntil:now+24*3600_000,eligibleUntil:now+30*60_000,nextCheckAt:now+5*60_000,
    code:'OWNER_BROWSER_CONFIRMED',detail:'Owner attests correct audio/video for at least 30 seconds; not automated browser telemetry.',scope:String(body.scope||'Owner browser/network').slice(0,120)};
   row.workingStatus='working';await row.save();
  }else if(body.action==='quarantine'){
   row.playbackHealth={...(row.playbackHealth||{}),state:'quarantined',eligibleUntil:0,nextCheckAt:Date.now()+10*60_000,code:'OWNER_QUARANTINED'};
   row.workingStatus='broken';await row.save();
  }else if(body.action==='probe'){await checkAndUpdateChannel(row);}
  else return json({ok:false,error:'Unknown action'},400);
  const fresh=await LiveChannel.findOne({channelId:row.channelId}).lean();
  return json({ok:true,channel:toClientChannel(fresh)});
 }catch(e){return json({ok:false,error:e.message},e.status||500);}
}
