// LifeOS — Dashboard (Home tab) — landing screen
// Shows: current running task (hero), next planned task, today snapshot.

function Dashboard() {
  return (
    <Phone>
      <StatusBar />

      {/* Header — date + greeting */}
      <div style={{padding:'8px 16px 4px', display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
        <div>
          <div className="hand" style={{fontSize:26, fontWeight:700, lineHeight:1}}>Tuesday</div>
          <div className="label" style={{fontSize:11, color:'var(--ink-faint)'}}>May 26 · 1:30 pm</div>
        </div>
        <div className="hand" style={{fontSize:18}}>☷</div>
      </div>

      <div style={{padding:'8px 12px 6px', flex:1, overflow:'hidden', display:'flex', flexDirection:'column', gap:10}}>

        {/* ── NOW CARD — current running task ─────────────────────── */}
        <div className="rough" style={{padding:'12px 14px', borderRadius:10, position:'relative'}}>
          <div style={{display:'flex', alignItems:'center', gap:6}}>
            <div style={{width:8, height:8, background:'var(--ink)', borderRadius:50}}/>
            <span className="label" style={{fontSize:10, letterSpacing:1.5, color:'var(--ink-faint)'}}>NOW · TRACKING</span>
            <span className="hand" style={{marginLeft:'auto', fontSize:12, color:'var(--ink-faint)'}}>started 1:06p</span>
          </div>

          {/* Big elapsed time */}
          <div style={{display:'flex', alignItems:'flex-end', gap:10, marginTop:4}}>
            <div className="hand" style={{fontSize:46, fontWeight:700, lineHeight:1}}>0:24:08</div>
            <div className="cat-admin" style={{width:18, height:42, border:'2px solid var(--ink)', borderRadius:3, marginBottom:4}}/>
          </div>

          <div style={{display:'flex', alignItems:'center', gap:6, marginTop:4}}>
            <div className="hand" style={{fontSize:20, fontWeight:600}}>Inbox + 1:1</div>
            <div className="label" style={{fontSize:10, color:'var(--ink-faint)'}}>· Call</div>
          </div>

          {/* tags */}
          <div style={{display:'flex', flexWrap:'wrap', gap:4, marginTop:6}}>
            <div className="tag" style={{fontSize:10, padding:'2px 6px'}}>vivek</div>
            <div className="tag" style={{fontSize:10, padding:'2px 6px'}}>inbox</div>
            <div className="tag" style={{fontSize:10, padding:'2px 6px'}}>1:1</div>
          </div>

          {/* stop button */}
          <div style={{position:'absolute', top:14, right:14, width:32, height:32,
                       background:'var(--ink)', border:'2.5px solid var(--ink)', borderRadius:6,
                       display:'flex', alignItems:'center', justifyContent:'center',
                       filter:'url(#wobble)', boxShadow:'2px 2px 0 var(--ink-faint)'}}>
            <div style={{width:10, height:10, background:'var(--paper)'}}/>
          </div>
        </div>

        {/* ── NEXT CARD — upcoming planned task ─────────────────────── */}
        <div className="rough-light" style={{padding:'10px 12px', borderRadius:8, opacity:0.85}}>
          <div style={{display:'flex', alignItems:'center', gap:6}}>
            <span className="label" style={{fontSize:10, letterSpacing:1.5, color:'var(--ink-faint)'}}>NEXT · IN 1h 30m</span>
            <span className="hand" style={{marginLeft:'auto', fontSize:13}}>→</span>
          </div>
          <div style={{display:'flex', alignItems:'center', gap:8, marginTop:4}}>
            <div className="planned cat-gym" style={{width:14, height:30, borderRadius:3}}/>
            <div style={{flex:1}}>
              <div className="hand" style={{fontSize:18, fontWeight:600, lineHeight:1.1}}>Gym · Run 5km</div>
              <div className="label" style={{fontSize:10.5, color:'var(--ink-faint)'}}>3:00 – 3:45 pm</div>
            </div>
          </div>
        </div>

        {/* ── TODAY mini-timeline ─────────────────────── */}
        <div className="rough-light" style={{padding:'10px 12px 6px', borderRadius:8}}>
          <div style={{display:'flex', alignItems:'center', gap:6}}>
            <span className="label" style={{fontSize:10, letterSpacing:1.5, color:'var(--ink-faint)'}}>TODAY</span>
            <span className="label" style={{marginLeft:'auto', fontSize:10, color:'var(--ink-faint)'}}>tap to expand →</span>
          </div>

          {/* horizontal mini timeline 7a → 10p */}
          <div style={{position:'relative', height:36, margin:'8px 0 4px', border:'1.5px solid var(--ink)', borderRadius:4, filter:'url(#wobble-light)'}}>
            {/* hour ticks */}
            {[7,10,13,16,19,22].map(h => {
              const pct = (h-7)/15*100;
              return (
                <div key={h} className="tick"
                     style={{position:'absolute', top:-13, left:`${pct}%`, transform:'translateX(-50%)'}}>
                  {h%12||12}{h<12?'a':'p'}
                </div>
              );
            })}
            {/* sample tracked blocks (past — opaque) */}
            <div className="cat-deep"  style={{position:'absolute', top:2, bottom:2, left:`${(9.25-7)/15*100}%`,  width:`${(1.05)/15*100}%`, border:'1.5px solid var(--ink)', borderRadius:2, boxShadow:'1.5px 1.5px 0 var(--ink)'}}/>
            <div className="cat-break" style={{position:'absolute', top:2, bottom:2, left:`${(10.3-7)/15*100}%`,  width:`${(0.3)/15*100}%`,  border:'1.5px solid var(--ink)', borderRadius:2}}/>
            <div className="cat-admin" style={{position:'absolute', top:2, bottom:2, left:`${(10.6-7)/15*100}%`,  width:`${(0.9)/15*100}%`,  border:'1.5px solid var(--ink)', borderRadius:2, boxShadow:'1.5px 1.5px 0 var(--ink)'}}/>
            {/* running task — straddles now line */}
            <div className="cat-admin" style={{position:'absolute', top:2, bottom:2, left:`${(13.1-7)/15*100}%`,  width:`${(0.4)/15*100}%`,  border:'1.8px solid var(--ink)', borderRight:'none', borderRadius:'2px 0 0 2px'}}/>
            {/* future planned (translucent) */}
            <div className="planned cat-gym"   style={{position:'absolute', top:2, bottom:2, left:`${(15-7)/15*100}%`, width:`${(0.75)/15*100}%`, borderRadius:2}}/>
            <div className="planned cat-study" style={{position:'absolute', top:2, bottom:2, left:`${(15.5-7)/15*100}%`,  width:`${(1.5)/15*100}%`,  borderRadius:2}}/>
            <div className="planned cat-commute" style={{position:'absolute', top:2, bottom:2, left:`${(18-7)/15*100}%`, width:`${(0.6)/15*100}%`, borderRadius:2}}/>

            {/* now indicator */}
            <div style={{position:'absolute', top:-4, bottom:-4, left:`${(13.5-7)/15*100}%`, width:0, borderLeft:'2.5px solid var(--ink)', filter:'url(#wobble-light)'}}>
              <div style={{position:'absolute', top:-8, left:-3, width:6, height:6, background:'var(--ink)', borderRadius:50}}/>
            </div>
          </div>

          {/* day stats row */}
          <div style={{display:'flex', justifyContent:'space-between', marginTop:4, fontFamily:'var(--label)', fontSize:11}}>
            <span><b>3h 12m</b> <span style={{color:'var(--ink-faint)'}}>tracked</span></span>
            <span><b>8h 30m</b> <span style={{color:'var(--ink-faint)'}}>planned</span></span>
            <span style={{color:'var(--ink-soft)'}}>+12m drift</span>
          </div>
        </div>

        {/* ── Quick start — recent ─────────────────────── */}
        <div>
          <div className="label" style={{fontSize:10, letterSpacing:1.5, color:'var(--ink-faint)', marginBottom:5}}>QUICK START</div>
          <div style={{display:'flex', gap:5, flexWrap:'wrap'}}>
            <div className="chip"><div className="swatch cat-deep"/>Deep · API</div>
            <div className="chip"><div className="swatch cat-study"/>Study</div>
            <div className="chip"><div className="swatch cat-break"/>Break</div>
          </div>
        </div>
      </div>

      <Fab kind="secondary" label="+" bottom={134}/>
      <Fab label="▶"/>
      <TabBar active="home" />

      {/* annotations */}
      <Note style={{top:88, right:-2, fontSize:12, transform:'rotate(-2deg)'}}>
        running<br/>task = hero
      </Note>
      <Note style={{top:240, right:-2, fontSize:11, transform:'rotate(2deg)'}}>
        what's next
      </Note>
      <Note style={{top:330, right:-2, fontSize:11, color:'var(--ink-faint)'}}>
        mini day
      </Note>
    </Phone>
  );
}

// Empty state — nothing is running
function DashboardEmpty() {
  return (
    <Phone>
      <StatusBar />
      <div style={{padding:'8px 16px 4px'}}>
        <div className="hand" style={{fontSize:26, fontWeight:700, lineHeight:1}}>Tuesday</div>
        <div className="label" style={{fontSize:11, color:'var(--ink-faint)'}}>May 26 · 9:00 am</div>
      </div>

      <div style={{padding:'12px', flex:1, display:'flex', flexDirection:'column', gap:10}}>
        {/* idle NOW card */}
        <div className="rough-dashed" style={{padding:'18px 14px', borderRadius:10, textAlign:'center'}}>
          <div className="label" style={{fontSize:10, letterSpacing:1.5, color:'var(--ink-faint)'}}>NOTHING TRACKING</div>
          <div className="hand" style={{fontSize:26, fontWeight:700, marginTop:6}}>tap ▶ to start</div>
          <div className="label" style={{fontSize:11, color:'var(--ink-faint)', marginTop:4}}>or pick a quick start below</div>
        </div>

        {/* NEXT card same */}
        <div className="rough-light" style={{padding:'10px 12px', borderRadius:8}}>
          <div style={{display:'flex'}}>
            <span className="label" style={{fontSize:10, letterSpacing:1.5, color:'var(--ink-faint)'}}>NEXT · IN 0h 30m</span>
          </div>
          <div style={{display:'flex', alignItems:'center', gap:8, marginTop:4}}>
            <div className="planned cat-deep" style={{width:14, height:30, borderRadius:3}}/>
            <div style={{flex:1}}>
              <div className="hand" style={{fontSize:18, fontWeight:600, lineHeight:1.1}}>Deep Work · API refactor</div>
              <div className="label" style={{fontSize:10.5, color:'var(--ink-faint)'}}>9:30 – 11:30 am</div>
            </div>
            <div className="freq-pill" style={{borderStyle:'dashed', fontSize:10}}>start now</div>
          </div>
        </div>

        <div>
          <div className="label" style={{fontSize:10, letterSpacing:1.5, color:'var(--ink-faint)', marginBottom:5}}>QUICK START</div>
          <div style={{display:'flex', gap:5, flexWrap:'wrap'}}>
            <div className="chip"><div className="swatch cat-deep"/>Deep · API</div>
            <div className="chip"><div className="swatch cat-study"/>Study · ch.4</div>
            <div className="chip"><div className="swatch cat-admin"/>Inbox</div>
            <div className="chip"><div className="swatch cat-break"/>Coffee</div>
          </div>
        </div>
      </div>

      <Fab kind="secondary" label="+" bottom={134}/>
      <Fab label="▶"/>
      <TabBar active="home" />

      <Note style={{top:110, right:-2, fontSize:11, color:'var(--ink-faint)', transform:'rotate(-2deg)'}}>
        empty state
      </Note>
      <Note style={{top:215, right:-2, fontSize:11, transform:'rotate(-2deg)'}}>
        "start now" pre-fills<br/>from upcoming plan
      </Note>
    </Phone>
  );
}

Object.assign(window, { Dashboard, DashboardEmpty });
