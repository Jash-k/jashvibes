'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import RailNav from '@/components/rail/RailNav';
import Icon from '@/components/Icons';
import SiteCover from '@/components/extras/SiteCover';
import { extraUrl } from '@/lib/extrasRegistry';

const domain = url => { try { return new URL(url).hostname; } catch { return ''; } };
export default function ExtrasApp() {
  const [sites, setSites] = useState([]), [status, setStatus] = useState('loading');
  const [error, setError] = useState(''), [degraded, setDegraded] = useState(false), [query, setQuery] = useState('');
  const [selection, setSelection] = useState({}), [frameKey, setFrameKey] = useState(0), [expanded, setExpanded] = useState(false), [frameState, setFrameState] = useState('loading');
  const readSelection = useCallback(() => {
    const p = new URLSearchParams(window.location.search);
    setSelection({ id: p.get('site') || '', direct: p.get('url') || '', title: (p.get('title') || 'Website').slice(0,60) });
  }, []);
  useEffect(() => { readSelection(); window.addEventListener('popstate', readSelection); return () => window.removeEventListener('popstate', readSelection); }, [readSelection]);
  const load = useCallback(async (signal) => {
    setError('');
    try {
      const response = await fetch('/api/embed-sites', { cache: 'no-store', signal });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Could not load websites.');
      setSites(data.sites || []); setDegraded(!!data.degraded); setStatus('ready');
    } catch (err) { if (err.name !== 'AbortError') { setError('The website collection could not be loaded. Please retry.'); setStatus('error'); } }
  }, []);
  useEffect(() => {
    const controller = new AbortController(); load(controller.signal);
    const refresh = () => { if (document.visibilityState === 'visible') load(controller.signal); };
    window.addEventListener('focus', refresh);
    return () => { controller.abort(); window.removeEventListener('focus', refresh); };
  }, [load]);
  let direct = '', invalidDirect = false;
  if (selection.direct) { try { direct = extraUrl(selection.direct, typeof window !== 'undefined' ? window.location.origin : ''); } catch { invalidDirect = true; } }
  // Raw URL bookmarks are read-only viewing links, never new catalogue entries.
  const selected = direct ? { id: 'direct', label: selection.title, url: direct, allowPopups: false } : sites.find(s => s.id === selection.id || s.legacyId === selection.id);
  const viewing = Boolean(selection.id || selection.direct);
  useEffect(() => {
    setFrameState('loading'); setExpanded(false);
    if (!selected) return;
    const timer = setTimeout(() => setFrameState(state => state === 'loading' ? 'slow' : state), 12000);
    return () => clearTimeout(timer);
  }, [selected?.url, frameKey]);
  useEffect(() => {
    document.documentElement.classList.toggle('ex-expanded', expanded);
    const escape = e => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', escape);
    return () => { document.documentElement.classList.remove('ex-expanded'); window.removeEventListener('keydown', escape); };
  }, [expanded]);
  const choose = (site) => { window.history.pushState(null, '', `/extras?site=${encodeURIComponent(site.id)}`); readSelection(); window.scrollTo(0,0); };
  const back = () => { window.history.pushState(null, '', '/extras'); readSelection(); setExpanded(false); };
  const results = sites.filter(s => `${s.label} ${domain(s.url)}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="ex-page"><RailNav/><main className="ex-main jv-rail-shift"><div className="ex-content">
    <header className="ex-topbar"><div className="ex-crumb">JASHVIBES <span>/</span> <b>{viewing ? 'Extras / Website viewer' : 'Extras'}</b></div><Link className="ex-btn" href="/admin?tab=extras"><Icon name="gear"/> Manage sites</Link></header>
    {viewing ? <>
      <div className="ex-viewer-head"><div className="ex-viewer-title"><button className="ex-iconbtn" onClick={back} aria-label="Back to Extras"><Icon name="back"/></button><div className="ex-viewer-icon"><Icon name="globe"/></div><div><h1>{selected?.label || 'Website unavailable'}</h1><p>{selected ? domain(selected.url) : 'This destination is not available.'}</p></div></div>
        {selected ? <div className="ex-viewer-actions"><button className="ex-btn" onClick={() => setFrameKey(k => k+1)}><Icon name="refresh"/><span>Reload</span></button><button className="ex-btn" onClick={() => setExpanded(x => !x)} aria-pressed={expanded}><Icon name="fullscreen"/><span>{expanded ? 'Restore' : 'Expand'}</span></button><a className="ex-btn" href={selected.url} target="_blank" rel="noopener noreferrer"><Icon name="external"/><span>Open site</span></a></div> : null}
      </div>
      {status === 'loading' ? <div className="ex-empty">Loading your websites…</div> : invalidDirect ? <div className="ex-empty">This link is not a permitted public HTTPS website.<button className="ex-btn" onClick={back}>Back to Extras</button></div> : selected ? <>
        <div className="ex-framebox"><div className="ex-addressbar"><Icon name="lock"/><span>{selected.url}</span><small>Website viewer</small></div>
          <iframe key={`${selected.url}-${frameKey}-${selected.allowPopups}`} src={selected.url} title={`${selected.label} — external website`} sandbox={`allow-scripts allow-same-origin allow-forms allow-presentation${selected.allowPopups ? ' allow-popups allow-popups-to-escape-sandbox' : ''}`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onLoad={() => setFrameState('loaded')} onError={() => setFrameState('error')}/>
        </div>
        <div className="ex-view-note"><span role="status">{frameState === 'loading' ? 'Opening website…' : frameState === 'slow' || frameState === 'error' ? 'Taking too long or not loading? Use the original site link.' : 'External website. Provider permissions and restrictions apply.'}</span><a href={selected.url} target="_blank" rel="noopener noreferrer">Not loading? Open original site ↗</a></div>
        <p className="ex-muted">The app cannot change this website’s content, remove its ads or verify its playback. Reload returns to the configured starting page.{selected.allowPopups ? ' This site is allowed to open new tabs.' : ' New-tab popups are blocked.'}</p>
      </> : <div className="ex-empty">{status === 'error' ? error : 'This website was removed, hidden or is not in the collection.'}<button className="ex-btn" onClick={back}>Back to Extras</button>{status === 'error' ? <button className="ex-btn" onClick={() => load()}>Retry</button> : null}</div>}
    </> : <>
      <div className="ex-hero"><div><div className="ex-eyebrow">Your web collection</div><h1>A little more.<br/><em>All in one place.</em></h1><p>Your favourite websites, a click away.<br/>Open a site. Stay in your JashVibes space.</p></div><div className="ex-hero-art" aria-hidden="true"><div className="ex-art-back"/><div className="ex-art-front"><div>● ● ●</div><Icon name="globe"/></div><span>✦</span></div></div>
      <div className="ex-toolbar"><h2>Explore websites <span className="ex-count">{sites.length}</span></h2><label className="ex-search"><Icon name="search"/><input value={query} onChange={e => setQuery(e.target.value)} aria-label="Search websites" placeholder="Find a website…" type="search"/></label></div>
      {degraded ? <div className="ex-warning">Database unavailable; showing the existing environment-configured websites. Admin changes may not be reflected until the database reconnects.</div> : null}
      {status === 'loading' ? <div className="ex-grid" aria-label="Loading websites">{[0,1,2].map(i => <div key={i} className="ex-skeleton"/>)}</div> : status === 'error' ? <div className="ex-empty" role="alert">{error}<button className="ex-btn" onClick={() => { setStatus('loading'); load(); }}>Retry</button></div> : <div className="ex-grid">
        {results.map(site => <button className="ex-card" key={site.id} onClick={() => choose(site)} aria-label={`Open ${site.label}`}><SiteCover site={site}/><div className="ex-cardbody"><div className="ex-domain"><Icon name="globe"/>{domain(site.url)}</div><div className="ex-cardheading"><h3>{site.label}</h3><span className="ex-open-circle"><Icon name="arrow"/></span></div><p>{site.description || 'Open the entire website, inside your JashVibes space.'}</p><div className="ex-cardfoot"><span><Icon name="extras"/>Opens in-app</span><span>Original website</span></div></div></button>)}
        {!results.length ? <div className="ex-empty"><Icon name={query ? 'search' : 'globe'}/><h3>{query ? 'No matching websites' : 'Your next destination starts here.'}</h3><p>{query ? 'Try another name or domain.' : 'An admin can add websites to this collection.'}</p>{query ? <button className="ex-btn" onClick={() => setQuery('')}>Clear search</button> : <Link className="ex-btn" href="/admin?tab=extras">Manage sites</Link>}</div> : null}
      </div>}
      <div className="ex-footnote"><Icon name="info"/><span>Websites open inside the app. Their content and navigation stay with the original provider.</span></div>
    </>}
    <footer className="ex-footer"><span>JaSH ViBeS <i>/</i> A space for everything you love.</span><span>EXTRAS · YOUR WEB COLLECTION</span></footer>
  </div></main></div>;
}
