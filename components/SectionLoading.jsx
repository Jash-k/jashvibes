import RailNav from '@/components/rail/RailNav';
export default function SectionLoading({ title = 'section' }) {
  return <><RailNav/><main className="jv-rail-shift jv-section-loading" aria-busy="true">
    <h1>{title}</h1><p role="status">Opening {title}…</p>
    <div className="jv-section-skeleton" aria-hidden="true">{Array.from({length:6},(_,i)=><span key={i}/>)}</div>
  </main></>;
}
