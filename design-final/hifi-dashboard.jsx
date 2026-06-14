// LifeOS — Premium · Dashboard (Home)
// Ultra-minimal editorial. No circular buttons on cards — FABs are the only circles.
// Card actions are subtle text affordances.

function HiDashboard({ dark }) {
  return (
    <HiPhone dark={dark}>
      <HiStatusBar />

      <div style={{padding:'18px 24px 6px', display:'flex', alignItems:'flex-end', justifyContent:'space-between'}}>
        <div>
          <div className="hi-num">Tuesday — 26 May</div>
          <div className="hi-h1" style={{marginTop:6}}>Today</div>
        </div>
        <div className="hi-meta-sm" style={{fontFeatureSettings:'"tnum"'}}>1:30 pm</div>
      </div>

      <hr className="hi-rule" style={{margin:'14px 24px'}}/>

      <div style={{padding:'4px 24px 0', flex:1, display:'flex', flexDirection:'column', gap:0, minHeight:0, overflow:'hidden'}}>

        {/* ── 01 · Now ─────────────────────────────────── */}
        <div style={{paddingTop:6, paddingBottom:20}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <div className="hi-eyebrow">01 — Now</div>
            <div className="hi-meta-sm" style={{fontFeatureSettings:'"tnum"'}}>since 12:30</div>
          </div>

          <div className="hi-display" style={{
            fontSize: 72,
            fontWeight: 700,
            letterSpacing: '-0.04em',
            lineHeight: 0.92,
            marginTop: 18,
            fontFeatureSettings: '"tnum"',
          }}>
            1:00<span style={{color:'var(--ink-4)'}}>:08</span>
          </div>

          <div style={{display:'flex', alignItems:'center', gap:8, marginTop:16}}>
            <span style={{width:8, height:8, borderRadius:50, background:'var(--c-admin)', flexShrink:0}}/>
            <span className="hi-h3" style={{fontWeight:600}}>Admin</span>
            <span className="hi-meta-sm" style={{marginLeft:4}}>vivek · inbox · 1:1</span>
          </div>

          <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginTop:12}}>
            <div className="hi-meta-sm" style={{fontFeatureSettings:'"tnum"'}}>planned to 2:30</div>
            <span style={{
              fontFamily:'var(--font-ui)', fontSize:11.5, fontWeight:500,
              letterSpacing:'0.14em', textTransform:'uppercase',
              color:'var(--ink-3)', cursor:'pointer',
              borderBottom:'1px solid var(--ink-4)', paddingBottom:1,
            }}>Stop ■</span>
          </div>
        </div>

        <hr className="hi-rule"/>

        {/* ── 02 · Next ──────────────────────────────── */}
        <div style={{paddingTop:18, paddingBottom:18}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <div className="hi-eyebrow">02 — Next</div>
            <div className="hi-meta-sm" style={{fontFeatureSettings:'"tnum"'}}>in 1h 30m</div>
          </div>

          <div style={{display:'flex', alignItems:'flex-start', gap:12, marginTop:14}}>
            <span style={{width:10, height:10, borderRadius:50, background:'var(--c-gym)', flexShrink:0, marginTop:6}}/>
            <div style={{flex:1, minWidth:0}}>
              <div className="hi-h2" style={{fontSize:24}}>Run · 5km</div>
              <div className="hi-meta-sm" style={{marginTop:4, fontFeatureSettings:'"tnum"', letterSpacing:'0.04em'}}>Gym  ·  3:00 → 3:45</div>
            </div>
          </div>

          <div style={{textAlign:'right', marginTop:10}}>
            <span style={{
              fontFamily:'var(--font-ui)', fontSize:11.5, fontWeight:500,
              letterSpacing:'0.14em', textTransform:'uppercase',
              color:'var(--ink-3)', cursor:'pointer',
              borderBottom:'1px solid var(--ink-4)', paddingBottom:1,
            }}>Start ▶</span>
          </div>
        </div>

        <hr className="hi-rule"/>

        {/* ── 03 · Day strip (24h) ──────────────────── */}
        <div style={{paddingTop:18, paddingBottom:14, flex:1}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18}}>
            <div className="hi-eyebrow">03 — Day</div>
            <div className="hi-meta-sm" style={{fontSize:10, letterSpacing:'0.1em', fontFeatureSettings:'"tnum"'}}>3:12 / 8:30 · +12m drift</div>
          </div>

          <div style={{position:'relative', height:14, margin:'0 0 4px'}}>
            {[0,4,8,12,16,20,24].map(h => {
              const pct = h/24*100;
              return (
                <div key={h} className="hi-tick" style={{
                  position:'absolute', top:0, left:`${pct}%`, transform:'translateX(-50%)',
                  fontSize:9, letterSpacing:'0.04em',
                }}>
                  {h === 0 ? '12a' : h === 12 ? '12p' : h === 24 ? '12a' : `${h%12}${h<12?'a':'p'}`}
                </div>
              );
            })}
          </div>

          <div className="hi-mini-rail">
            <div className="blk actual cat-deep"   style={{left:`${9.25/24*100}%`, width:`${1.25/24*100}%`}}/>
            <div className="blk actual cat-break"  style={{left:`${10.5/24*100}%`, width:`${0.25/24*100}%`}}/>
            <div className="blk actual cat-admin"  style={{left:`${10.75/24*100}%`, width:`${1.75/24*100}%`}}/>
            <div className="blk actual cat-admin"  style={{left:`${12.5/24*100}%`, width:`${1.0/24*100}%`}}/>
            <div className="blk planned cat-admin" style={{left:`${13.5/24*100}%`, width:`${1.0/24*100}%`}}/>
            <div className="blk planned cat-gym"   style={{left:`${15/24*100}%`,   width:`${0.75/24*100}%`}}/>
            <div className="blk planned cat-study" style={{left:`${15.9/24*100}%`, width:`${1.6/24*100}%`}}/>
            <div className="blk planned cat-commute" style={{left:`${18/24*100}%`, width:`${0.7/24*100}%`}}/>
            <div className="now" style={{left:`${13.5/24*100}%`}}/>
          </div>
        </div>
      </div>

      <HiFab kind="secondary" />
      <HiFab kind="primary" />
      <HiTabBar active="home"/>
    </HiPhone>
  );
}

// ─── Empty ───────────────────────────────────────────────────
function HiDashboardEmpty({ dark }) {
  return (
    <HiPhone dark={dark}>
      <HiStatusBar time="9:00" />

      <div style={{padding:'18px 24px 6px'}}>
        <div className="hi-num">Tuesday — 26 May</div>
        <div className="hi-h1" style={{marginTop:6}}>Today</div>
      </div>

      <hr className="hi-rule" style={{margin:'14px 24px'}}/>

      <div style={{padding:'4px 24px 0', flex:1, display:'flex', flexDirection:'column', minHeight:0}}>
        <div style={{padding:'40px 0 24px'}}>
          <div className="hi-eyebrow">01 — Now</div>
          <div className="hi-display" style={{fontSize:42, fontWeight:700, letterSpacing:'-0.025em', marginTop:14, color:'var(--ink-3)'}}>
            Nothing tracking
          </div>
          <div className="hi-meta-sm" style={{marginTop:8}}>Tap ▶ to start a timer</div>
        </div>

        <hr className="hi-rule"/>

        <div style={{paddingTop:18, paddingBottom:18}}>
          <div style={{display:'flex', justifyContent:'space-between'}}>
            <div className="hi-eyebrow">02 — Next</div>
            <div className="hi-meta-sm" style={{fontFeatureSettings:'"tnum"'}}>in 30m</div>
          </div>

          <div style={{display:'flex', alignItems:'flex-start', gap:12, marginTop:14}}>
            <span style={{width:10, height:10, borderRadius:50, background:'var(--c-deep)', flexShrink:0, marginTop:6}}/>
            <div style={{flex:1, minWidth:0}}>
              <div className="hi-h2" style={{fontSize:22}}>API refactor</div>
              <div className="hi-meta-sm" style={{marginTop:3, fontSize:10, textTransform:'uppercase', letterSpacing:'0.08em', fontFeatureSettings:'"tnum"'}}>Deep Work  ·  9:30 → 11:30</div>
            </div>
          </div>

          <div style={{textAlign:'right', marginTop:10}}>
            <span style={{
              fontFamily:'var(--font-ui)', fontSize:11.5, fontWeight:500,
              letterSpacing:'0.14em', textTransform:'uppercase',
              color:'var(--ink-3)', cursor:'pointer',
              borderBottom:'1px solid var(--ink-4)', paddingBottom:1,
            }}>Start ▶</span>
          </div>
        </div>

        <hr className="hi-rule"/>
      </div>

      <HiFab kind="secondary" />
      <HiFab kind="primary" />
      <HiTabBar active="home"/>
    </HiPhone>
  );
}

Object.assign(window, { HiDashboard, HiDashboardEmpty });
