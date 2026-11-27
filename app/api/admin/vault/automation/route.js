import { NextResponse } from 'next/server';
import { requireServiceAuth } from '@/lib/serverAuth';
import { VAULT_WORKFLOWS, automationConfig, createVaultActions, dispatchInputs } from '@/lib/vaultAutomation';
import dbConnect from '@/lib/db';
import Setting from '@/models/Setting';
import { recordAction } from '@/lib/adminAudit';
import { loadVaultBase } from '@/lib/vault';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(data,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
const failure=e=>json({ok:false,error:e.status?e.message:'Vault automation request failed. Check server configuration/logs.'},e.status||500);
async function cooldown(action){
 await dbConnect();
 try {
  await Setting.updateOne({key:`vault-automation-${action}`,$or:[{'value.until':{$lte:Date.now()}},{'value.until':{$exists:false}}]},{$set:{value:{until:Date.now()+(action==='dispatch'?120000:15000)}}},{upsert:true});
 }catch(e){if(e.code===11000)throw Object.assign(Error('Another request was recently submitted. Wait before retrying.'),{status:429});throw e;}
}
export async function GET(request){
 try{
  await requireServiceAuth(request);const config=automationConfig();
  const common={ok:true,configured:!!config.token,repository:config.repository,branch:config.branch,bundled:config.bundled,workflows:VAULT_WORKFLOWS};
  if(!config.token)return json({...common,runs:[],warning:'Set VAULT_ACTIONS_TOKEN in the server environment to enable workflow triggers.'});
  return json({...common,runs:await createVaultActions(config).runs()});
 }catch(e){return failure(e);}
}
export async function POST(request){
 try{
  await requireServiceAuth(request);
  const text=await request.text();if(text.length>2048)return json({ok:false,error:'Request too large.'},413);
  let body;try{body=JSON.parse(text);}catch{return json({ok:false,error:'Invalid JSON.'},400);}
  if(!body||Array.isArray(body)||typeof body!=='object')return json({ok:false,error:'Invalid request.'},400);
  const config=automationConfig();
  if(body.action==='reload'){
   if(config.bundled)return json({ok:false,error:'Bundled snapshot mode is enabled. Switch VAULT_USE_BUNDLED_SNAPSHOT=false and redeploy to use the published feed.'},409);
   await cooldown('reload');const rows=await loadVaultBase({force:true});
   await recordAction({area:'vault',action:'vault.feed-reload',summary:'Reloaded published Vault feed on the serving process',reversible:false});
   return json({ok:true,count:rows.length,reloadedAt:new Date().toISOString(),scope:'Serving process; other instances expire their normal cache.'});
  }
  if(body.action!=='dispatch')return json({ok:false,error:'Unknown action.'},400);
  dispatchInputs(body.workflow,body); // Validate before consuming cooldown.
  if(!config.token)return json({ok:false,error:'Set VAULT_ACTIONS_TOKEN on the JaSH server.'},503);
  await cooldown('dispatch');
  const result=await createVaultActions(config).dispatch(body.workflow,body);
  await recordAction({area:'vault',action:'vault.workflow-dispatch',summary:`Requested ${result.label} on ${config.repository}@${config.branch}`,target:{kind:'github-workflow',key:body.workflow,label:result.label},reversible:false});
  return json({ok:true,...result},202);
 }catch(e){return failure(e);}
}
