// Server-only caller; token is read at request time and never returned to clients.
export const VAULT_WORKFLOWS = Object.freeze([
 {id:'hourly',file:'hourly-new-entries.yml',label:'Fetch New Titles',minutes:10,max:15},
 {id:'releases',file:'new-releases.yml',label:'Refresh Releases & Episodes',minutes:25,max:30},
 {id:'dubbed',file:'isaidub.yml',label:'Refresh Dubbed Content',minutes:25,max:30},
 {id:'enrich',file:'enrich.yml',label:'Enrich Metadata',minutes:20,max:30},
 {id:'historic',file:'historic.yml',label:'Historical Recovery',minutes:60,max:90,advanced:true},
]);
export const VAULT_WRITER_FILES = Object.freeze([...VAULT_WORKFLOWS.map(w=>w.file),'az-archive.yml','tmdb-backfill.yml']);
const activeStatuses=new Set(['queued','in_progress','waiting','pending','requested']);
export function automationConfig(env=process.env){
 const repository=env.VAULT_ACTIONS_REPOSITORY||'Jash-k/mv_vault';
 const branch=env.VAULT_ACTIONS_BRANCH||'main';
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)||repository.includes('..'))throw Error('Invalid VAULT_ACTIONS_REPOSITORY.');
 if(!/^[A-Za-z0-9_./-]+$/.test(branch)||branch.includes('..'))throw Error('Invalid VAULT_ACTIONS_BRANCH.');
 return {repository,branch,token:env.VAULT_ACTIONS_TOKEN||'',bundled:env.VAULT_USE_BUNDLED_SNAPSHOT==='true'};
}
export function dispatchInputs(id,body={}){
 const workflow=VAULT_WORKFLOWS.find(w=>w.id===id);if(!workflow)throw Object.assign(Error('Unknown workflow.'),{status:400});
 const minutes=Number(body.minutes??workflow.minutes);
 if(!Number.isInteger(minutes)||minutes<1||minutes>workflow.max)throw Object.assign(Error(`Budget must be 1–${workflow.max} whole minutes.`),{status:400});
 if(workflow.advanced&&body.confirm!==true)throw Object.assign(Error('Historical recovery requires explicit confirmation.'),{status:400});
 const inputs={budget_min:String(minutes)};
 if(id==='hourly')Object.assign(inputs,{max_items:'30',publish:true});
 if(id==='releases')Object.assign(inputs,{with_series:true,commit:true});
 if(id==='dubbed')Object.assign(inputs,{walk_concurrency:'2',commit:true});
 if(id==='enrich')Object.assign(inputs,{limit:'0',concurrency:'4',commit:true});
 if(id==='historic')Object.assign(inputs,{metadata_budget_min:'10'});
 return {workflow,inputs};
}
export function createVaultActions(config,{fetchImpl=fetch}={}){
 const base=`https://api.github.com/repos/${config.repository}`;
 async function api(path,options={}){
  if(!config.token)throw Object.assign(Error('Configure VAULT_ACTIONS_TOKEN on the JaSH server.'),{status:503});
  let r;try{r=await fetchImpl(base+path,{...options,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${config.token}`,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'JaSH-Vault-Automation','Content-Type':'application/json'}});}catch{throw Object.assign(Error('GitHub request did not complete. Check Actions before retrying: a dispatch may have been accepted.'),{status:502});}
  if(!r.ok){await r.body?.cancel();const messages={401:'GitHub token is invalid or expired.',403:'GitHub denied this action. Check Actions read/write permission, organization approval and API limits.',404:'Repository or workflow not found, or the token cannot access it. Publish the workflow on the default branch first.',409:'GitHub cannot dispatch this workflow in its current state.',422:'GitHub rejected the branch or workflow inputs. Confirm the latest mv_vault workflows are published.',429:'GitHub rate limit reached. Wait before retrying.'};throw Object.assign(Error(messages[r.status]||`GitHub returned HTTP ${r.status}.`),{status:r.status===401||r.status===403?502:r.status===429?429:502});}
  if(r.status===204)return null;return r.json();
 }
 async function runs(){
  const data=await api(`/actions/runs?branch=${encodeURIComponent(config.branch)}&per_page=100`);
  const allowed=new Set(VAULT_WRITER_FILES);
  return (data.workflow_runs||[]).filter(r=>allowed.has(String(r.path||'').split('@')[0].split('/').at(-1))).map(r=>({id:r.id,name:r.name,status:r.status,conclusion:r.conclusion,url:/^https:\/\/github\.com\//.test(r.html_url||'')?r.html_url:null,createdAt:r.created_at,updatedAt:r.updated_at,event:r.event,branch:r.head_branch,workflow:String(r.path).split('@')[0].split('/').at(-1),active:activeStatuses.has(r.status)}));
 }
 async function dispatch(id,body){
  const {workflow,inputs}=dispatchInputs(id,body);
  // Query each active state: do not miss a long-running job outside the latest-100 list.
  for(const status of ['queued','in_progress','waiting','pending','requested']){
   const data=await api(`/actions/runs?branch=${encodeURIComponent(config.branch)}&status=${status}&per_page=100`);
   const allowed=new Set(VAULT_WRITER_FILES);
   if((data.workflow_runs||[]).some(r=>allowed.has(String(r.path||'').split('@')[0].split('/').at(-1))))throw Object.assign(Error('A Vault writer is queued or running. Wait for it to finish.'),{status:409});
  }
  const info=await api(`/actions/workflows/${encodeURIComponent(workflow.file)}`);
  if(info.state!=='active')throw Object.assign(Error('This workflow is disabled in GitHub Actions. Enable it there first.'),{status:409});
  await api(`/actions/workflows/${encodeURIComponent(workflow.file)}/dispatches`,{method:'POST',body:JSON.stringify({ref:config.branch,inputs})});
  return {accepted:true,workflow:workflow.id,label:workflow.label,requestedAt:new Date().toISOString(),message:'GitHub accepted the dispatch request. Execution and publication are not yet confirmed.'};
 }
 return {runs,dispatch};
}
