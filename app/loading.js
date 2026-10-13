import SectionLoading from '@/components/SectionLoading';

// Fallback geometry matches the section it stands in for; see components/Skeletons.jsx.
export default function Loading() { return <SectionLoading title="Home" variant="shelf" rows={3} items={7}/>; }
