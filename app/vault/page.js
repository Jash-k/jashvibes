'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import RailNav from '@/components/rail/RailNav';
import Icon from '@/components/Icons';
import { VaultTile, SkeletonGrid } from '@/components/vault/VaultCards';
import { readSessionCache, writeSessionCache } from '@/lib/clientCache';
import { watchHref } from '@/lib/watch/policy';
import { VAULT_TABS, vaultCategory, latestVaultFirst } from '@/lib/vaultBrowse';
import { useReveal } from '@/lib/useReveal';
import './vault-lens.css';

const CACHE_KEY = 'jash:vault:v2', CACHE_TTL = 30 * 60 * 1000, STEP = 60;
const EMPTY = { qualities: [], era: '', rating: '', language: '', sources: '', letter: '' };
const LENSES = [{ id: 'quality', label: 'Quality' }, { id: 'year', label: 'Year' }, { id: 'rating', label: 'Rating' }, { id: 'more', label: 'More filters' }];
const ERAS = ['2020s', '2010s', '2000s', '1990s', '1980s', 'Earlier'];
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');
function eraOf(year) { return year >= 2020 ? '2020s' : year >= 2010 ? '2010s' : year >= 2000 ? '2000s' : year >= 1990 ? '1990s' : year >= 1980 ? '1980s' : year > 0 ? 'Earlier' : ''; }
function sourceBucket(count) { return count <= 1 ? '1' : count === 2 ? '2' : count <= 4 ? '3–4' : '5+'; }
function matches(item, filters, query, skip = '') {
  if (query && !`${item.title} ${item.year}`.toLowerCase().includes(query)) return false;
  if (skip !== 'quality' && filters.qualities.length && !filters.qualities.some((q) => item.embeds?.some((e) => String(e.quality).toLowerCase() === q.toLowerCase()))) return false;
  if (skip !== 'year' && filters.era && eraOf(item.year) !== filters.era) return false;
  if (skip !== 'rating' && filters.rating && (filters.rating === 'unrated' ? item.rating > 0 : Number(item.rating) < Number(filters.rating))) return false;
  if (skip !== 'language' && filters.language && (item.language || 'unknown') !== filters.language) return false;
  if (skip !== 'sources' && filters.sources && sourceBucket(item.embedCount) !== filters.sources) return false;
  if (skip !== 'letter' && filters.letter && item.letter !== filters.letter) return false;
  return true;
}
function FilterPanel({ title, close, children }) {
  const ref = useRef(null), onClose = useRef(close); onClose.current = close;
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    const key = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose.current(); }
      if (event.key !== 'Tab') return;
      const list = [...ref.current.querySelectorAll('button,select,input')].filter((node) => !node.disabled && node.getClientRects().length);
      const first = list[0], last = list[list.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus?.(); };
  }, []);
  return <div className="vl-backdrop" onClick={(event) => { if (event.target === event.currentTarget) close(); }}><section className="vl-popover" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}><header><h2>{title}</h2><button type="button" aria-label="Close filters" onClick={close}>×</button></header>{children}<button type="button" className="vl-apply" onClick={close}>Done · Show results</button></section></div>;
}

export default function VaultPage() {
  const [data, setData] = useState(null), [status, setStatus] = useState('loading'), [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false), [tab, setTab] = useState('tamil-movie');
  const [query, setQuery] = useState(''), [sort, setSort] = useState('latest'), [dense, setDense] = useState(false);
  const [filters, setFilters] = useState(EMPTY), [lens, setLens] = useState(''), [visible, setVisible] = useState(STEP);
  const request = useRef(null), sentinel = useRef(null), handled = useRef(false), content = useRef(null);
  const router = useRouter();
  const load = useCallback(async (force = false) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setRefreshing(force); setError('');
    try {
      const response = await fetch(`/api/vault${force ? '?force=1' : ''}`, { signal: controller.signal });
      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload.movies)) throw new Error(payload.error || 'Vault catalogue unavailable.');
      if (controller.signal.aborted) return;
      setData(payload); setStatus('ready'); writeSessionCache(CACHE_KEY, payload);
    } catch (err) { if (!controller.signal.aborted) { setError(err.message); setStatus((previous) => previous === 'ready' ? previous : 'error'); } }
    finally { if (!controller.signal.aborted) setRefreshing(false); }
  }, []);
  useEffect(() => {
    const cached = readSessionCache(CACHE_KEY, CACHE_TTL);
    if (Array.isArray(cached?.movies)) { setData(cached); setStatus('ready'); }
    load(new URLSearchParams(window.location.search).has('force'));
    return () => request.current?.abort();
  }, [load]);
  useEffect(() => {
    if (handled.current || !data?.movies) return;
    handled.current = true; const id = new URLSearchParams(window.location.search).get('play');
    const item = id && data.movies.find((movie) => movie.id === id);
    if (item) router.replace(watchHref(item, 'vault'));
  }, [data, router]);
  useEffect(() => {
    if (!lens) return;
    const nodes = [content.current, document.querySelector('.mobile-dock'), document.querySelector('.jv-rail')].filter(Boolean);
    const values = nodes.map((node) => node.inert); nodes.forEach((node) => { node.inert = true; });
    return () => nodes.forEach((node, index) => { node.inert = values[index]; });
  }, [lens]);
  const movies = data?.movies || [];
  const tabCounts = useMemo(() => movies.reduce((acc, movie) => { const key = vaultCategory(movie); acc[key] = (acc[key] || 0) + 1; return acc; }, {}), [movies]);
  const collection = useMemo(() => movies.filter((movie) => vaultCategory(movie) === tab), [movies, tab]);
  const needle = query.trim().toLowerCase();
  const results = useMemo(() => {
    const list = collection.filter((movie) => matches(movie, filters, needle));
    if (sort === 'latest') list.sort(latestVaultFirst);
    else if (sort === 'added') list.sort((a, b) => (Date.parse(b.addedAt) || 0) - (Date.parse(a.addedAt) || 0));
    else if (sort === 'year') list.sort((a, b) => b.year - a.year);
    else if (sort === 'rating') list.sort((a, b) => b.rating - a.rating);
    else if (sort === 'sources') list.sort((a, b) => b.embedCount - a.embedCount);
    else list.sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }, [collection, filters, needle, sort]);
  useEffect(() => { setVisible(STEP); }, [tab, filters, query, sort]);
  useEffect(() => {
    if (!sentinel.current) return;
    const observer = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) setVisible((v) => Math.min(v + STEP, results.length)); }, { rootMargin: '700px' });
    observer.observe(sentinel.current); return () => observer.disconnect();
  }, [results.length, visible]);
  const reveal = useReveal(`${tab}|${sort}|${query}|${JSON.stringify(filters)}|${visible}`);
  const patch = (value) => setFilters((old) => ({ ...old, ...value }));
  const count = (dimension, value) => collection.filter((movie) => matches(movie, filters, needle, dimension) && (dimension === 'quality' ? movie.embeds?.some((e) => String(e.quality).toLowerCase() === value.toLowerCase()) : dimension === 'year' ? eraOf(movie.year) === value : dimension === 'rating' ? value === 'unrated' ? !movie.rating : Number(movie.rating) >= Number(value) : dimension === 'sources' ? sourceBucket(movie.embedCount) === value : dimension === 'language' ? (movie.language || 'unknown') === value : movie.letter === value)).length;
  const chips = [...filters.qualities.map((q) => ({ key: q, label: q, remove: () => patch({ qualities: filters.qualities.filter((v) => v !== q) }) })), ...Object.entries(filters).filter(([k, v]) => k !== 'qualities' && v).map(([k, v]) => ({ key: k, label: k === 'rating' ? v === 'unrated' ? 'Unrated' : `${v}+ rating` : k === 'sources' ? `${v} sources` : k === 'language' ? data?.facets?.languages?.find((x) => x.code === v)?.label || v : v, remove: () => patch({ [k]: '' }) }))];
  const selected = tab === 'unverified' ? { label: 'Unverified' } : VAULT_TABS.find((item) => item.id === tab);
  const options = (dimension, values, key) => <div className="vl-options">{values.map((value) => { const active = key === 'qualities' ? filters.qualities.includes(value) : filters[key] === value; const total = count(dimension, value); return <button type="button" key={value} aria-pressed={active} disabled={!active && !total} onClick={() => patch({ [key]: key === 'qualities' ? active ? filters.qualities.filter((v) => v !== value) : [...filters.qualities, value] : active ? '' : value })}>{value === 'unrated' ? 'Unrated' : value}<small>{total}</small></button>; })}</div>;
  return <main className="jv-vault-page jv-rail-shift vl-page"><RailNav/>
    <section className="vl-content" ref={content}>
      <header className="vl-header"><div><h1 className="vl-wordmark" aria-label="MoViE VaULT"><span className="vl-wordmark-movie">MoViE</span>{' '}<span className="vl-wordmark-vault">VaULT</span></h1></div><div className="vl-header-actions"><Link href="/classics" className="vl-refresh vl-retro"><Icon name="film" className="h-4 w-4"/>ReTro</Link><button type="button" className="vl-refresh vl-refresh-icon" disabled={refreshing} onClick={() => load(true)} aria-label={refreshing ? 'Refreshing Vault' : 'Refresh Vault'} title={refreshing ? 'Refreshing…' : 'Refresh Vault'} aria-busy={refreshing}><Icon name="refresh" className={`h-4 w-4${refreshing ? ' vl-refresh-spinning' : ''}`}/></button></div></header>
      <label className="vl-search"><Icon name="search" className="h-5 w-5"/><span className="sr-only">Search titles or year</span><input type="search" placeholder="Search titles or year…" value={query} onChange={(event) => setQuery(event.target.value)}/>{query ? <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>×</button> : null}</label>
      <nav className="vl-tabs" aria-label="Vault categories">{VAULT_TABS.map((item) => <button type="button" key={item.id} aria-pressed={tab === item.id} onClick={() => { setTab(item.id); setFilters(EMPTY); setQuery(''); }}><span>{item.label}</span><small>{tabCounts[item.id] || 0}</small></button>)}</nav>
      <div className="vl-verification-note"><button type="button" aria-pressed={tab === 'unverified'} onClick={() => { setTab('unverified'); setFilters(EMPTY); setQuery(''); }}>Unverified <small>{tabCounts.unverified || 0}</small></button></div>
      <div className="vl-lenses">{LENSES.map((item) => <button type="button" key={item.id} onClick={() => setLens(item.id)} aria-haspopup="dialog" aria-expanded={lens === item.id}>{item.label}<span>⌄</span></button>)}<label><span className="sr-only">Sort titles</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="latest">Latest updates</option><option value="added">Recently added</option><option value="year">Release year</option><option value="rating">Top rated</option><option value="az">A–Z</option><option value="sources">Most sources</option></select></label><button type="button" aria-pressed={dense} onClick={() => setDense(!dense)}>{dense ? 'Dense' : 'Cozy'}</button></div>
      {chips.length ? <div className="vl-cuts"><span>Your cut:</span>{chips.map((chip) => <button type="button" key={chip.key} onClick={chip.remove} aria-label={`Remove ${chip.label}`}>{chip.label} ×</button>)}<button type="button" onClick={() => setFilters(EMPTY)}>Clear filters</button></div> : null}
      <div className="vl-results-head"><h2>{selected.label}</h2><span>{results.length} titles · {sort === 'latest' ? 'Latest catalogue updates' : 'Filtered catalogue'}</span></div>
      {error ? <div className="vl-error" role="alert">{error} <button type="button" onClick={() => load(true)}>Retry</button></div> : null}
      {status === 'loading' ? <SkeletonGrid/> : null}
      {status === 'ready' && !results.length ? <div className="vl-empty"><h3>No matching titles</h3><p>Try another category or clear your search and filters.</p><button type="button" onClick={() => { setFilters(EMPTY); setQuery(''); }}>Clear search and filters</button></div> : null}
      {status === 'ready' ? <div className={`vl-grid ${dense ? 'is-dense' : ''}`} ref={reveal}>{results.slice(0, visible).map((movie, index) => <VaultTile key={movie.id} movie={movie} index={index} onPlay={(item) => router.push(watchHref(item, 'vault'))}/>)}</div> : null}
      {visible < results.length ? <div className="vl-more" ref={sentinel}><button type="button" onClick={() => setVisible((v) => v + STEP)}>Show more titles</button></div> : null}
      {tab === 'unverified' ? <p className="vl-note">These records lack original-language metadata or have conflicting classifications. Their sources and playback links are unchanged; no origin is assumed.</p> : null}
    </section>
    {lens ? <FilterPanel title={LENSES.find((item) => item.id === lens)?.label || 'Filters'} close={() => setLens('')}>
      {lens === 'quality' ? <><p>Matches any available source of a title.</p>{options('quality', ['1080p', '720p', 'HD', '360p'], 'qualities')}</> : null}
      {lens === 'year' ? <><p>Filter by release era.</p>{options('year', ERAS, 'era')}</> : null}
      {lens === 'rating' ? <><p>Minimum catalogue rating; missing ratings remain unrated.</p>{options('rating', ['5', '6', '7', '8', 'unrated'], 'rating')}</> : null}
      {lens === 'more' ? <><h3>Original language</h3><label><span className="sr-only">Original language</span><select value={filters.language} onChange={(event) => patch({ language: event.target.value })}><option value="">Any language</option>{(data?.facets?.languages || []).map((item) => <option key={item.code} value={item.code}>{item.label} ({count('language', item.code)})</option>)}<option value="unknown">Unknown ({count('language', 'unknown')})</option></select></label><h3>Source count</h3>{options('sources', ['1', '2', '3–4', '5+'], 'sources')}<h3>Title starts with</h3>{options('letter', ALPHABET, 'letter')}</> : null}
      <p className="vl-note">{results.length} matching titles. Filters update instantly.</p><button type="button" className="vl-clear" onClick={() => setFilters(EMPTY)}>Clear all filters</button>
    </FilterPanel> : null}
    {/* AuthGate supplies the shared MobileDock on /vault; do not mount a duplicate. */}
  </main>;
}
