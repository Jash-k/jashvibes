// Stream this lightweight shell while route chunks load; catalogue APIs never gate navigation.
export default function MusicLoading() {
  return <main role="status" aria-live="polite" style={{position:'fixed',inset:0,zIndex:90,background:'#0b1519',color:'#edf3f3',padding:'max(32px, env(safe-area-inset-top)) 24px',fontFamily:'system-ui'}}>
    <h1 style={{fontSize:25,marginBottom:18}}>Music Library</h1><p>Opening your library…</p><p style={{marginTop:20,color:'#9bddce'}}>New · Tracks · Albums · Artists · Playlists</p>
  </main>;
}
