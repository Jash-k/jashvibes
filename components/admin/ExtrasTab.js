'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '@/components/Icons';
import SiteCover from '@/components/extras/SiteCover';
import { validateExtra } from '@/lib/extrasRegistry';
import '@/components/extras/extras.css';

const defaults = { label: '', url: '', description: '', coverUrl: '', theme: 'amber', enabled: true, allowPopups: false };
function FormDialog({ site, count, busy, error, onSave, onClose }) {
  const ref = useRef(null), previous = useRef(null);
  const [form, setForm] = useState({ ...defaults, ...site });
  const [position, setPosition] = useState(site ? site.position + 1 : count + 1);
  const [validation, setValidation] = useState('');
  useEffect(() => { previous.current = document.activeElement; ref.current.showModal(); return () => previous.current?.focus?.(); }, []);
  const field = (name, value) => setForm(f => ({ ...f, [name]: value }));
  return <dialog ref={ref} className="ex-dialog" aria-labelledby="ex-form-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="ex-dialoghead"><div><h2 id="ex-form-title">{site ? 'Edit website' : 'Add a website'}</h2><p>Give your next destination a place in Extras.</p></div><button className="ex-iconbtn" onClick={onClose} disabled={busy} aria-label="Close dialog"><Icon name="close"/></button></div>
    <form onSubmit={e => { e.preventDefault(); setValidation(''); try { const row = validateExtra(form, window.location.origin); onSave(row, Number(position) - 1); } catch (err) { setValidation(err.message); } }}>
      <div className="ex-formbody"><div className="ex-field"><label htmlFor="ex-label">Website name *</label><input id="ex-label" value={form.label} onChange={e => field('label', e.target.value)} required maxLength={60} autoFocus placeholder="e.g. Arivumani"/></div>
      <div className="ex-field"><label htmlFor="ex-url">Website URL *</label><input id="ex-url" type="url" value={form.url} onChange={e => field('url', e.target.value)} required maxLength={2048} placeholder="https://example.com"/><small>Public HTTPS websites only. Embedding still depends on the provider’s permission.</small></div>
      <div className="ex-field"><label htmlFor="ex-description">Short description</label><textarea id="ex-description" value={form.description} onChange={e => field('description', e.target.value)} maxLength={180} placeholder="A short introduction for the card"/></div>
      <div className="ex-field"><label htmlFor="ex-cover">Cover image URL <span>(optional)</span></label><input id="ex-cover" type="url" value={form.coverUrl} onChange={e => field('coverUrl', e.target.value)} maxLength={2048} placeholder="https://your-image-host/cover.jpg"/><small>Use an image you have permission to display. Leave blank for an illustrated cover. Images load directly; no server fetch.</small></div>
      <div className="ex-formrow"><div className="ex-field"><span className="ex-fieldlabel" id="ex-theme-label">Card appearance</span><div className="ex-themes" role="group" aria-labelledby="ex-theme-label">{['amber','mint','lilac'].map(t => <button key={t} type="button" className={`ex-theme ex-${t}`} aria-label={`${t} appearance`} aria-pressed={form.theme === t} onClick={() => field('theme',t)}/>)}</div></div><div className="ex-field"><label htmlFor="ex-position">Display order</label><input id="ex-position" type="number" min={1} max={site ? count : count + 1} required value={position} onChange={e => setPosition(e.target.value)}/></div></div>
      <label className="ex-checkbox"><input type="checkbox" checked={form.enabled} onChange={e => field('enabled',e.target.checked)}/>Show this website in Extras</label>
      <label className="ex-checkbox"><input type="checkbox" checked={form.allowPopups} onChange={e => field('allowPopups',e.target.checked)}/>Allow this website to open new tabs</label><p className="ex-muted">Popups are blocked by default. Enable only for trusted sites that need them for normal navigation. Top-level app navigation stays blocked.</p>
      {validation || error ? <p className="ex-error" role="alert">{validation || error}</p> : null}</div>
      <div className="ex-dialogfoot"><button type="button" className="ex-btn ex-ghost" disabled={busy} onClick={() => { setValidation(''); try { const row = validateExtra(form, window.location.origin); window.open(`/extras?url=${encodeURIComponent(row.url)}&title=${encodeURIComponent(row.label)}`, '_blank', 'noopener,noreferrer'); } catch (err) { setValidation(err.message); } }}><Icon name="globe"/>Preview embed</button><button type="button" className="ex-btn ex-ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="ex-btn ex-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : site ? 'Save changes' : 'Add website'}<Icon name="arrow"/></button></div>
    </form>
  </dialog>;
}
function DeleteDialog({ site, busy, error, onClose, onRemove }) {
  const ref = useRef(null), previous = useRef(null);
  useEffect(() => { previous.current = document.activeElement; ref.current.showModal(); return () => previous.current?.focus?.(); }, []);
  return <dialog ref={ref} className="ex-dialog ex-small-dialog" aria-labelledby="ex-delete-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}><div className="ex-dialoghead"><h2 id="ex-delete-title">Remove website?</h2><button className="ex-iconbtn" aria-label="Close dialog" onClick={onClose} disabled={busy}><Icon name="close"/></button></div><div className="ex-formbody"><p>Remove <strong>{site.label}</strong> from Extras? This removes its card, not the original website. Hide it instead to keep its settings.</p>{error ? <p className="ex-error" role="alert">{error}</p> : null}</div><div className="ex-dialogfoot"><button className="ex-btn" disabled={busy} onClick={onClose}>Keep website</button><button className="ex-btn ex-danger" disabled={busy} onClick={onRemove}>{busy ? 'Removing…' : 'Remove website'}</button></div></dialog>;
}
export default function ExtrasTab() {
  const [registry, setRegistry] = useState({ sites: [], version: 0, source: 'database' });
  const [status, setStatus] = useState('loading'), [error, setError] = useState(''), [note, setNote] = useState('');
  const [busy, setBusy] = useState(false), [dialog, setDialog] = useState(null), [dialogError, setDialogError] = useState('');
  const mounted = useRef(false), abort = useRef(null), locked = useRef(false);
  const load = useCallback(async () => {
    setStatus('loading'); setError('');
    abort.current?.abort(); abort.current = new AbortController();
    try {
      const response = await fetch('/api/admin/extras', { cache: 'no-store', signal: abort.current.signal });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Read failed.');
      if (mounted.current) { setRegistry(data); setStatus('ready'); }
    } catch (err) { if (mounted.current && err.name !== 'AbortError') { setError(err.message); setStatus('error'); } }
  }, []);
  useEffect(() => { mounted.current = true; load(); return () => { mounted.current = false; abort.current?.abort(); }; }, [load]);
  const close = () => { if (!locked.current) { setDialog(null); setDialogError(''); } };
  async function mutate(method, payload, message) {
    if (locked.current) return false;
    locked.current = true; setBusy(true); setDialogError(''); setNote('');
    try {
      const response = await fetch('/api/admin/extras', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, version: registry.version }) });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        if (response.status === 409) { if (mounted.current) setDialog(null); await load(); }
        throw new Error(data.error || 'Save failed.');
      }
      if (mounted.current) { setRegistry(data); setNote(message); setDialog(null); setError(''); }
      return true;
    } catch (err) { if (mounted.current) { setDialogError(err.message); setError(err.message); } return false; }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  const open = value => { setDialogError(''); setDialog(value); };
  const reorder = (index, direction) => {
    const ids = registry.sites.map(s => s.id), target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    mutate('PATCH', { action: 'reorder', ids }, 'Card order updated.');
  };
  return <section className="ex-admin" aria-label="Manage Extras"><div className="ex-adminheader"><div><div className="ex-eyebrow">Your web collection</div><h2>Manage Extras</h2><p>A home for your websites. You decide what appears.</p></div><button className="ex-btn ex-primary" onClick={() => open({ kind:'form' })} disabled={status !== 'ready' || busy}><Icon name="plus"/>Add website</button></div>
    <div className="ex-stats"><div><span>Total websites</span><strong>{registry.sites.length}</strong></div><div><span>Visible in Extras</span><strong>{registry.sites.filter(s => s.enabled).length}</strong></div><div><span>Hidden websites</span><strong>{registry.sites.filter(s => !s.enabled).length}</strong></div></div>
    {note ? <p className="ex-success" role="status">{note}</p> : null}{error ? <div className="ex-error" role="alert">{error}<button className="ex-btn" onClick={load} disabled={busy}>Reload list</button></div> : null}
    {status === 'loading' ? <p className="ex-empty">Loading website settings…</p> : status === 'ready' ? <><div className="ex-adminbar"><h3>Your websites</h3><span>Use the arrows to change card order</span></div><div className="ex-tablewrap"><table><thead><tr><th>Website</th><th>Status</th><th>Order</th><th>Controls</th></tr></thead><tbody>{registry.sites.map((site,index) => <tr key={site.id}><td><div className="ex-sitecell"><SiteCover site={site} compact/><div><b>{site.label}</b><small>{new URL(site.url).hostname}</small></div></div></td><td><button className={`ex-status ${site.enabled ? '' : 'ex-off'}`} disabled={busy} aria-label={`${site.enabled ? 'Hide' : 'Enable'} ${site.label}`} onClick={() => mutate('PATCH',{ action:'edit',id:site.id,site:{...site,enabled:!site.enabled},position:index },site.enabled ? 'Website hidden from Extras.' : 'Website enabled.')}>{site.enabled ? 'Enabled' : 'Hidden'}</button></td><td><div className="ex-order"><span>{String(index + 1).padStart(2,'0')}</span><button className="ex-iconbtn" onClick={() => reorder(index,-1)} disabled={busy || index === 0} aria-label={`Move ${site.label} up`}><Icon name="chevU"/></button><button className="ex-iconbtn" onClick={() => reorder(index,1)} disabled={busy || index === registry.sites.length - 1} aria-label={`Move ${site.label} down`}><Icon name="chevD"/></button></div></td><td><div className="ex-actions"><Link className="ex-iconbtn" href={`/extras?site=${encodeURIComponent(site.id)}`} title={site.enabled ? 'Preview website' : 'Enable before viewing in Extras'} aria-label={`Preview ${site.label}`}><Icon name="globe"/></Link><button className="ex-iconbtn" disabled={busy} aria-label={`Edit ${site.label}`} onClick={() => open({kind:'form',site:{...site,position:index}})}><Icon name="edit"/></button><button className="ex-iconbtn ex-danger-icon" disabled={busy} aria-label={`Remove ${site.label}`} onClick={() => open({kind:'delete',site})}><Icon name="trash"/></button></div></td></tr>)}{!registry.sites.length ? <tr><td colSpan={4} className="ex-empty">No websites yet. Add your first destination above.</td></tr> : null}</tbody></table></div>
    {registry.source === 'environment' ? <div className="ex-warning">Showing your existing environment-configured sites. Your first saved admin change stores the entire list in MongoDB. After that, this panel is the source of truth—even when all sites are removed.</div> : <p className="ex-muted">Saved to MongoDB. Only enabled websites appear in Extras. Removing the final site keeps the collection empty.</p>}
    <div className="ex-warning"><Icon name="info"/>Some websites forbid iframe embedding. Preview from your app and keep the external-open fallback. This panel does not bypass provider restrictions.</div></> : null}
    <Link href="/extras" className="ex-btn ex-ghost"><Icon name="back"/>View Extras</Link>
    {dialog?.kind === 'form' ? <FormDialog site={dialog.site} count={registry.sites.length} busy={busy} error={dialogError} onClose={close} onSave={(site,position) => mutate(dialog.site ? 'PATCH' : 'POST', { ...(dialog.site ? {action:'edit',id:dialog.site.id} : {}),site,position },dialog.site ? 'Website updated.' : 'Website added to Extras.')}/> : null}
    {dialog?.kind === 'delete' ? <DeleteDialog site={dialog.site} busy={busy} error={dialogError} onClose={close} onRemove={() => mutate('DELETE',{id:dialog.site.id},'Website removed.')}/> : null}
  </section>;
}
