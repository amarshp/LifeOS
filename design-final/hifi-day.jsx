// LifeOS — Hi-fi · Day View (+ edit sheet + drag mode)

function HiDayView({ dark }) {
  const RAIL_H = 484;
  const HR = RAIL_H / 15;
  const NOW = 6.5 * HR;  // 1:30p
  return (
    <HiPhone dark={dark}>
      <HiStatusBar />
      <HiRunner elapsed="1:00:08" />
      <HiDateHead title="Tuesday" sub="May 26"/>

      <div style={{position:'relative', flex:1, margin:'0 16px', minHeight:0}}>
        <div style={{position:'absolute', left:0, top:8, bottom:0, width:30}}>
          <HiHourCol start={7} end={22} height={RAIL_H} every={1} />
        </div>

        <div style={{position:'absolute', left:34, right:0, top:0, height:RAIL_H+8}}>
          {/* past — actual */}
          <HiBlock top={9}            height={1.25*HR-4} right={0} cat="deep"  mode="actual"
                   label="Deep Work" sub="9:15 → 10:30 · API refactor"/>
          <HiBlock top={1.25*HR+10}   height={0.25*HR-2} right={0} cat="break" mode="actual"
                   label="Coffee"/>
          <HiBlock top={1.5*HR+10}    height={3*HR-4}    right={0} cat="admin" mode="actual"
                   label="Inbox + 1:1" sub="10:30 → 12:30"/>

          {/* currently-running Admin: actual portion = 12:30→NOW(1:30) */}
          <HiBlock top={4.5*HR+10}    height={2*HR-4}    right={0} cat="admin" mode="actual"
                   label="Admin · running" sub="1:00:08 elapsed · since 12:30"/>

          {/* its still-planned remainder = NOW(1:30)→2:30. Will be eaten as time passes. */}
          <HiBlock top={NOW + 6}      height={HR - 4}    right={0} cat="admin" mode="planned"
                   label="Admin · remaining" sub="planned to 2:30"/>

          {/* future — planned */}
          <HiBlock top={8*HR+10}      height={0.75*HR}   right={0} cat="gym"     mode="planned"
                   label="Run · 5km" sub="3:00 – 3:45 pm"/>
          <HiBlock top={8.9*HR+10}    height={1.6*HR}    right={0} cat="study"   mode="planned"
                   label="Study · ch.4" sub="3:54 – 5:30 pm"/>
          <HiBlock top={11*HR+10}     height={0.7*HR}    right={0} cat="commute" mode="planned"
                   label="Commute · home" sub="6:00 – 6:42 pm"/>
        </div>

        <div className="hi-now-line" style={{top: NOW + 4}}/>
      </div>

      <HiFab kind="secondary"/>
      <HiFab kind="primary"/>
      <HiTabBar active="day"/>
    </HiPhone>
  );
}

// ─── Edit mode — block tapped → SHEET (same UI as Add Entry) ─────
function HiDayEdit({ dark }) {
  const RAIL_H = 460;
  const HR = RAIL_H / 15;
  const NOW = 6.5 * HR;
  return (
    <HiPhone dark={dark}>
      <HiStatusBar />
      <div style={{opacity:0.32, pointerEvents:'none'}}>
        <HiRunner/>
        <HiDateHead title="Today" sub="Tuesday — 26 May"/>
        <div style={{position:'relative', margin:'8px 22px 0', height:RAIL_H}}>
          <div style={{position:'absolute', left:0, top:8, bottom:0, width:28}}>
            <HiHourCol start={7} end={22} height={RAIL_H} every={2} />
          </div>
          <div style={{position:'absolute', left:34, right:0, top:0, height:RAIL_H+8}}>
            <HiBlock top={9}            height={1.25*HR-4} right={0} cat="deep"  mode="actual" label="Deep Work"/>
            <HiBlock top={1.25*HR+10}   height={0.25*HR-2} right={0} cat="break" mode="actual" label="Coffee"/>
            {/* selected block stays at full opacity */}
            <div style={{position:'absolute', top:1.5*HR+8, left:-3, right:-3, height:3*HR-4, borderRadius:6,
                         boxShadow:'0 0 0 1.5px var(--ink)', pointerEvents:'none', zIndex:3, opacity:1/0.32}}/>
            <div style={{opacity:1/0.32, position:'absolute', top:1.5*HR+10, height:3*HR-4, left:0, right:0}}>
              <HiBlock top={0} height={3*HR-4} right={0} cat="admin" mode="actual"
                       label="Inbox + 1:1" sub="10:30 → 12:30"/>
            </div>
            <HiBlock top={4.5*HR+10}    height={2*HR-4} right={0} cat="admin" mode="actual" label="Admin · running"/>
          </div>
        </div>
      </div>
      <div className="hi-scrim"/>

      <div className="hi-sheet">
        <div className="handle"/>

        <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between'}}>
          <div className="hi-eyebrow">Edit entry</div>
          <span className="hi-meta-sm" style={{fontFeatureSettings:'"tnum"', display:'flex', alignItems:'center', gap:6}}>
            <span className="hi-swatch cat-admin" style={{background:'var(--c)'}}/>
            Admin · 120m
          </span>
        </div>

        <input className="hi-input" defaultValue="Inbox + 1:1"/>

        <div className="hi-eyebrow" style={{marginTop:22, marginBottom:6}}>01 — Time</div>
        <div style={{display:'flex', gap:18}}>
          <div style={{flex:1}}>
            <div className="hi-meta-sm" style={{fontSize:10, letterSpacing:'0.14em', textTransform:'uppercase', marginBottom:2}}>Start</div>
            <div className="hi-time-pill">
              <span>10:30 am</span>
              <span className="pencil" style={{marginLeft:'auto'}}>✎</span>
            </div>
          </div>
          <div style={{flex:1}}>
            <div className="hi-meta-sm" style={{fontSize:10, letterSpacing:'0.14em', textTransform:'uppercase', marginBottom:2}}>End</div>
            <div className="hi-time-pill">
              <span>12:30 pm</span>
              <span className="pencil" style={{marginLeft:'auto'}}>✎</span>
            </div>
          </div>
        </div>

        <div className="hi-eyebrow" style={{marginTop:22, marginBottom:10}}>02 — Category</div>
        <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
          <HiChip cat="deep"  label="Deep Work"/>
          <HiChip cat="study" label="Study"/>
          <HiChip cat="admin" label="Admin" selected/>
          <HiChip cat="gym"   label="Gym"/>
          <HiChip cat="break" label="Break"/>
          <HiChip cat="commute" label="Commute"/>
        </div>

        <div className="hi-eyebrow" style={{marginTop:22, marginBottom:6}}>03 — Tags</div>
        <div style={{display:'flex', alignItems:'center', gap:8, padding:'8px 0 12px', borderBottom:'1px solid var(--hairline-2)', fontFamily:'var(--font-ui)', fontSize:13}}>
          <span style={{color:'var(--ink)'}}>Vivek</span>
          <span style={{color:'var(--ink-4)'}}>·</span>
          <span style={{color:'var(--ink)'}}>inbox</span>
          <span style={{color:'var(--ink-4)'}}>·</span>
          <span style={{color:'var(--ink)'}}>1:1</span>
          <span style={{color:'var(--ink-4)'}}>·</span>
          <span style={{color:'var(--ink-3)'}}>＋ add</span>
        </div>

        <div style={{display:'flex', gap:8, marginTop:22, alignItems:'center'}}>
          <button className="hi-btn hi-btn-danger" style={{padding:'10px 14px', borderRadius:999, fontSize:11, letterSpacing:'0.14em', textTransform:'uppercase'}}>Delete</button>
          <button className="hi-btn" style={{padding:'10px 14px', borderRadius:999, fontSize:11, letterSpacing:'0.14em', textTransform:'uppercase'}}>Split</button>
          <button className="hi-btn hi-btn-primary" style={{marginLeft:'auto', padding:'10px 18px', borderRadius:999}}>Save</button>
        </div>
      </div>

      <HiTabBar active="day"/>
    </HiPhone>
  );
}

// ─── Drag mode (unchanged structurally) ─────────────────────
function HiDayDrag({ dark }) {
  const RAIL_H = 484;
  const HR = RAIL_H / 15;
  const NOW = 6.5 * HR;
  return (
    <HiPhone dark={dark}>
      <HiStatusBar />
      <HiRunner />
      <HiDateHead title="Tuesday" sub="May 26"/>

      <div style={{position:'relative', flex:1, margin:'0 16px', minHeight:0}}>
        <div style={{position:'absolute', left:0, top:8, bottom:0, width:30}}>
          <HiHourCol start={7} end={22} height={RAIL_H} every={1} />
        </div>

        <div style={{position:'absolute', left:34, right:0, top:0, height:RAIL_H+8}}>
          <HiBlock top={9}            height={1.25*HR-4} right={0} cat="deep"  mode="actual" label="Deep Work"/>
          <HiBlock top={1.25*HR+10}   height={0.25*HR-2} right={0} cat="break" mode="actual" label="Coffee"/>
          <HiBlock top={1.5*HR+10}    height={3*HR-4}    right={0} cat="admin" mode="actual" label="Inbox + 1:1"/>

          {/* GHOST — where Gym was */}
          <div className="cat-gym" style={{
            position:'absolute', top: 8*HR + 10, height: 0.8*HR, left: 0, right: 0,
            borderRadius:8, border:'1px dashed color-mix(in oklab, var(--c) 50%, transparent)',
            background:'color-mix(in oklab, var(--c) 6%, transparent)',
          }}/>

          {/* DRAGGING — Gym lifted */}
          <div className="hi-block actual cat-gym" style={{
            position:'absolute', top: 8*HR + 10 + 60, left: 8, right: -10, height: 0.8*HR,
            transform:'rotate(-1deg) scale(1.02)',
            boxShadow:'0 18px 36px -10px rgba(0,0,0,0.7), 0 0 0 2px rgba(255,255,255,0.18)',
            zIndex: 5,
          }}>
            <div className="title">Run · 5km</div>
            <div className="sub">3:55 – 4:40 pm</div>
          </div>

          {/* Running Admin still going below the lifted block */}
          <HiBlock top={4.5*HR+10}    height={2*HR-4}    right={0} cat="admin" mode="actual"
                   label="Admin · running" sub="1:00:08 elapsed"/>
          <HiBlock top={NOW + 6}      height={HR - 4}    right={0} cat="admin" mode="planned"
                   label="Admin · remaining"/>

          <HiBlock top={11*HR+12} height={0.7*HR} right={0} cat="commute" mode="planned" label="Commute"/>
        </div>

        <div style={{
          position:'absolute', top: 8*HR + 60 + 4, right: -8,
          padding:'3px 7px', borderRadius:6,
          background:'#fff', color:'#000', fontFamily:'var(--font-mono)',
          fontSize:11, fontWeight:600,
        }}>
          +55m
        </div>

        <div className="hi-now-line" style={{top: NOW + 4}}/>
      </div>

      <HiFab kind="secondary"/>
      <HiFab kind="primary"/>
      <HiTabBar active="day"/>
    </HiPhone>
  );
}

Object.assign(window, { HiDayView, HiDayEdit, HiDayDrag });
