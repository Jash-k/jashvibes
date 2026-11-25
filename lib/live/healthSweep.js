import dbConnect from '@/lib/db';
import LiveChannel from '@/models/LiveChannel';
import LiveSource from '@/models/LiveSource';
import { checkAndUpdateChannel } from '@/lib/liveService';
import { flagshipPriority } from '@/lib/live/health';
const state=(globalThis.__liveHealthSweep ||= {running:false,registered:false});
export async function sweepLiveHealth(){
 if(state.running)return;state.running=true;
 try{
  await dbConnect();
  const enabled=await LiveSource.find({enabled:{$ne:false},deleted:{$ne:true}}).select('sourceId').lean();
  const base={'playbackHealth.code':{$ne:'OWNER_QUARANTINED'},hidden:{$ne:true},sourceId:{$in:['manual',...enabled.map(s=>s.sourceId)]},$or:[{'playbackHealth.nextCheckAt':{$lte:Date.now()}},{'playbackHealth.nextCheckAt':{$exists:false}}]};
  const flagship={...base,name:/(?:^(?:star\s+)?vijay(?:\s+tv)?(?:\s+hd|\s+sd)?$|^sun\s+tv(?:\s+hd|\s+sd)?$|^sony\s+vizha)/i};
  const first=await LiveChannel.find(flagship).sort({'playbackHealth.checkedAt':1}).limit(8);
  const others=await LiveChannel.find({...base,channelId:{$nin:first.map(r=>r.channelId)}}).sort({'playbackHealth.checkedAt':1}).limit(16);
  const rows=[...first,...others].sort((a,b)=>flagshipPriority(a)-flagshipPriority(b));
  let index=0;await Promise.all(Array.from({length:3},async()=>{while(index<rows.length){const row=rows[index++];await checkAndUpdateChannel(row).catch(()=>{});}}));
 }finally{state.running=false;}
}
export function registerLiveHealthScheduler(){
 if(state.registered)return;state.registered=true;
 if(process.env.LIVE_HEALTH_SCHEDULER==='false')return;
 const tick=()=>void sweepLiveHealth().catch(()=>console.warn('[live-health] sweep unavailable'));
 setTimeout(tick,30_000).unref?.();setInterval(tick,5*60_000).unref?.();
}
