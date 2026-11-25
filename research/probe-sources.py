import requests,concurrent.futures,json,re,time
from urllib.parse import urljoin,urlparse
sources={
'iptv-org-tamil':'https://iptv-org.github.io/iptv/languages/tam.m3u',
'free-tv':'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8',
'amaze-local':'https://raw.githubusercontent.com/amazeyourself/tamil-local-iptv/main/channels-nortmp.m3u',
'amaze-yuppfast':'https://raw.githubusercontent.com/amazeyourself/m3u/main/yupptvfast.m3u',
'amaze-distro':'https://raw.githubusercontent.com/amazeyourself/m3u/main/distrotv.m3u',
'amaze-jayam':'https://raw.githubusercontent.com/amazeyourself/m3u/main/jayamott.m3u'}
def get(url):
 r=requests.get(url,timeout=9,stream=True,headers={'Origin':'https://jashvibes-o3pw.onrender.com','User-Agent':'Mozilla/5.0'})
 data=next(r.iter_content(100000),b'')
 r.close();return r,data
jobs=[];feed=[]
for sid,url in sources.items():
 try:
  r=requests.get(url,timeout=15);rows=[];name='';group=''
  for line in r.text.splitlines():
   if line.startswith('#EXTINF'):name=line.rsplit(',',1)[-1];m=re.search('group-title="([^"]*)',line);group=m[1] if m else ''
   elif line.startswith(('http://','https://')):rows.append({'name':name,'url':line.strip(),'group':group})
  selected=rows if sid!='free-tv' else [x for x in rows if re.search('india|tamil',x['group'],re.I)]
  # Spread across the feed rather than testing only its first entries.
  n=min(8,len(selected));sample=[selected[(i*len(selected))//n] for i in range(n)] if n else []
  feed.append({'source':sid,'url':url,'http':r.status_code,'entries':len(rows),'sampled':len(sample)})
  jobs.extend((sid,x) for x in sample)
 except Exception as e:feed.append({'source':sid,'error':type(e).__name__})
def probe(job):
 sid,row=job;out={'source':sid,'name':row['name'],'host':urlparse(row['url']).hostname};start=time.time()
 try:
  r,data=get(row['url']);out.update(http=r.status_code,cors=r.headers.get('access-control-allow-origin'),https=r.url.startswith('https://'))
  txt=data.decode('utf-8','ignore');out['manifest']=r.ok and '#EXTM3U' in txt
  if out['manifest']:
   base=r.url
   # A master variant is followed once, then one media segment is sampled.
   lines=txt.splitlines();links=[x.strip() for x in lines if x.strip() and not x.startswith('#')]
   if '#EXT-X-STREAM-INF' in txt and links:
    r,data=get(urljoin(base,links[0]));base=r.url;txt=data.decode('utf-8','ignore');out['variantHttp']=r.status_code;links=[x.strip() for x in txt.splitlines() if x.strip() and not x.startswith('#')]
   out['encrypted']='#EXT-X-KEY' in txt
   if '#EXTINF' in txt and links:
    r,data=get(urljoin(base,links[-1]));out.update(segmentHttp=r.status_code,segmentBytesSampled=len(data),segmentCors=r.headers.get('access-control-allow-origin'))
 except Exception as e:out['error']=type(e).__name__
 out['seconds']=round(time.time()-start,2);return out
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:results=list(ex.map(probe,jobs))
report={'scope':'Bounded remote-server sample, not India/browser playback certification. No keys/cookies supplied. Segment sample is first response chunk only.','feeds':feed,'probes':results}
open('research/live-source-probes.json','w').write(json.dumps(report,indent=2))
for f in feed:
 rs=[x for x in results if x['source']==f['source']];print(f,'manifest',sum(x.get('manifest',False) for x in rs),'segment',sum(x.get('segmentHttp') in [200,206] and x.get('segmentBytesSampled',0)>0 for x in rs),'cors',sum(bool(x.get('cors')) for x in rs))
for x in results:
 if x.get('segmentHttp') in [200,206]:print('PASS SAMPLE',x['source'],x['name'],x.get('cors'),x.get('segmentCors'))
