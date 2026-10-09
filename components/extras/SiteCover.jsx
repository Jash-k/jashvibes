'use client';
import { useId, useState } from 'react';

export default function SiteCover({ site, compact = false }) {
  const uid = useId().replace(/:/g, '');
  const [failed, setFailed] = useState('');
  const colours = { amber: ['#3d282a','#191219','#dba479'], mint: ['#29433b','#101e1b','#b9d0b3'], lilac: ['#393040','#1c1624','#d6c0e2'] };
  const [first, last, ink] = colours[site.theme] || colours.amber;
  if (compact) return <span className={`ex-mini ex-${site.theme}`}>{site.label.charAt(0)}</span>;
  return <div className="ex-cover">
    {site.coverUrl && failed !== site.coverUrl ? <img src={site.coverUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(site.coverUrl)} /> : <svg fill="none" viewBox="0 0 360 193" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs><linearGradient id={uid} x2="1" y2="1"><stop stopColor={first}/><stop offset="1" stopColor={last}/></linearGradient><pattern id={`${uid}-p`} width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0H0v25" stroke={ink} strokeOpacity=".06"/></pattern></defs>
      <rect width="360" height="193" fill={`url(#${uid})`}/><rect width="360" height="193" fill={`url(#${uid}-p)`}/><circle cx="285" cy="144" r="119" fill={ink} fillOpacity=".035"/>
      {site.theme === 'mint' ? <g transform="translate(234 80) rotate(-14)"><rect width="110" height="134" rx="8" fill={ink} fillOpacity=".05" stroke={ink} strokeOpacity=".35"/><rect x="16" y="16" width="78" height="49" rx="3" fill={ink} fillOpacity=".08"/><path d="m42 27 26 14-26 14z" fill={ink} fillOpacity=".6"/><path d="M17 83h74M17 95h61M17 107h42" stroke={ink} strokeOpacity=".35"/></g> : site.theme === 'lilac' ? <g transform="translate(285 145)"><circle r="66" stroke={ink} strokeOpacity=".25"/><circle r="53" stroke={ink} strokeOpacity=".14"/><circle r="42" stroke={ink} strokeOpacity=".16"/><circle r="17" stroke={ink} strokeOpacity=".4"/><circle r="4" fill={ink}/><path d="m57-71-9 72-15 16" stroke={ink} strokeWidth="3" strokeOpacity=".4"/></g> : <g transform="translate(282 139)"><circle r="64" stroke={ink} strokeOpacity=".3"/><ellipse rx="29" ry="64" stroke={ink} strokeOpacity=".3"/><path d="M-64 0H64M-55-30H55M-55 30H55" stroke={ink} strokeOpacity=".3"/><path d="m-45-69 2-7 2 7 7 2-7 2-2 7-2-7-7-2Z" fill={ink}/></g>}
      <text x="23" y="121" fill={ink} fontSize="35" fontFamily="Georgia,serif" fontStyle="italic">{site.theme === 'mint' ? 'Discover.' : site.theme === 'lilac' ? 'Tune in.' : 'Stay curious.'}</text><text x="25" y="149" fill={ink} opacity=".5" fontSize="8" fontFamily="Arial" letterSpacing="2.5">A NEW WINDOW TO YOUR WORLD</text>
    </svg>}
    <span className="ex-cover-badge">Website</span>
  </div>;
}
