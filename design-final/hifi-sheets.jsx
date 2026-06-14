// LifeOS — Premium · Sheets (Add Entry, Add Plan)

function DimDayBg() {
  const RAIL_H = 460;
  const HR = RAIL_H / 15;
  const NOW = 6.5 * HR;
  return (
    <div style={{opacity:0.35, pointerEvents:'none'}}>
      <HiRunner/>
      <HiDateHead title="Today" sub="Tuesday — 26 May"/>
      <div style={{position:'relative', margin:'8px 22px 0', height:RAIL_H}}>
        <div style={{position:'absolute', left:0, top:8, bottom:0, width:28}}>
          <HiHourCol start={7} end={22} height={RAIL_H} every={2} />
        </div>
        <div style={{position:'absolute', left:34, right:0, top:0, height:RAIL_H+8}}>
          <HiBlock top={9}            height={1.25*HR-4} right={0} cat="deep"  mode="actual" label="Deep Work"/>
          <HiBlock top={1.5*HR+10}    height={3*HR-4}    right={0} cat="admin" mode="actual" label="Inbox + 1:1"/>
          <HiBlock top={4.5*HR+10}    height={2*HR-4}    right={0} cat="admin" mode="actual" label="Admin · running"/>
          <HiBlock top={NOW + 6}      height={HR - 4}    right={0} cat="admin" mode="planned" label="Admin · remaining"/>
        </div>
      </div>
    </div>
  );
}

// ─── Add Entry — timer already running ───────────────────────
function HiAddEntry({ dark }) {
  return (
    <HiPhone dark={dark}>
      <HiStatusBar />
      <DimDayBg/>
      <div className="hi-scrim"/>

      <div className="hi-sheet">
        <div className="handle"/>

        {/* live tracking strip */}
        <div style={{display:'flex', alignItems:'center', gap:10, paddingBottom:14, borderBottom:'1px solid var(--hairline)'}}>
          <span className="hi-swatch cat-admin" style={{background:'var(--c)'}}/>
          <span className="hi-eyebrow">Tracking</span>
          <span style={{marginLeft:'auto', fontFamily:'var(--font-mono)', fontSize:18, fontWeight:400, fontFeatureSettings:'"tnum"', color:'var(--ink)'}}>
            0:00<span style={{color:'var(--ink-4)'}}>:12</span>
          </span>
        </div>

        {/* Name input (display serif) */}
        <input className="hi-input" defaultValue="Quick call with Vivek" placeholder="What are you tracking?"/>

        {/* Time */}
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginTop:22, marginBottom:6}}>
          <div className="hi-eyebrow">01 — Started at</div>
          <button className="hi-btn hi-btn-ghost" style={{padding:'2px 0', fontSize:11, letterSpacing:'0.08em'}}>
            ↶ Move to last stop · 1:24 pm
          </button>
        </div>
        <div className="hi-time-pill">
          <span>1:30 pm</span>
          <span className="pencil" style={{marginLeft:'auto'}}>✎</span>
        </div>

        {/* Category */}
        <div className="hi-eyebrow" style={{marginTop:22, marginBottom:10}}>02 — Category</div>
        <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
          <HiChip cat="deep"  label="Deep Work"/>
          <HiChip cat="study" label="Study"/>
          <HiChip cat="admin" label="Admin" selected/>
          <HiChip cat="gym"   label="Gym"/>
          <HiChip cat="break" label="Break"/>
          <HiChip cat="commute" label="Commute"/>
          <HiChip label="＋ New" dashed/>
        </div>

        {/* Tags */}
        <div className="hi-eyebrow" style={{marginTop:22, marginBottom:6}}>03 — Tags</div>
        <div style={{display:'flex', alignItems:'center', gap:8, padding:'8px 0 12px', borderBottom:'1px solid var(--hairline-2)', flexWrap:'wrap', fontFamily:'var(--font-ui)', fontSize:13}}>
          <span style={{color:'var(--ink)'}}>Vivek</span>
          <span style={{color:'var(--ink-4)'}}>·</span>
          <span style={{color:'var(--ink)'}}>work</span>
          <span style={{color:'var(--ink-4)'}}>·</span>
          <span style={{color:'var(--ink-3)'}}>Vi<span style={{color:'var(--ink-4)'}}>|</span></span>
        </div>
        <div className="hi-dropdown" style={{marginTop:0}}>
          <div className="row hover">
            <span>Vincent</span>
            <span className="ct">1 prev. call</span>
          </div>
          <div className="row" style={{fontStyle:'italic', color:'var(--ink-3)'}}>＋ Create "Vi"</div>
        </div>

        <div style={{display:'flex', gap:10, marginTop:22}}>
          <button className="hi-btn" style={{flex:1, padding:'13px', borderRadius:999, fontSize:11, letterSpacing:'0.16em', textTransform:'uppercase'}}>Discard</button>
          <button className="hi-btn hi-btn-primary" style={{flex:2, padding:'13px', borderRadius:999}}>
            Save & keep tracking
          </button>
        </div>
      </div>

      <HiTabBar active="home"/>
    </HiPhone>
  );
}

// ─── Add Plan ─────────────────────────────────────────────────
function HiAddPlan({ dark }) {
  return (
    <HiPhone dark={dark}>
      <HiStatusBar />
      <DimDayBg/>
      <div className="hi-scrim"/>

      <div className="hi-sheet">
        <div className="handle"/>

        <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
          <div className="hi-eyebrow">New plan</div>
          <span className="hi-meta-sm">No timer</span>
        </div>

        <input className="hi-input" defaultValue="Lunch with Anika"/>

        <div className="hi-eyebrow" style={{marginTop:22, marginBottom:6}}>01 — Time</div>
        <div style={{display:'flex', gap:18}}>
          <div style={{flex:1}}>
            <div className="hi-meta-sm" style={{fontSize:10, letterSpacing:'0.14em', textTransform:'uppercase', marginBottom:2}}>Start</div>
            <div className="hi-time-pill">
              <span>12:30 pm</span>
              <span className="pencil" style={{marginLeft:'auto'}}>✎</span>
            </div>
          </div>
          <div style={{flex:1}}>
            <div className="hi-meta-sm" style={{fontSize:10, letterSpacing:'0.14em', textTransform:'uppercase', marginBottom:2}}>End</div>
            <div className="hi-time-pill">
              <span>1:30 pm</span>
              <span className="pencil" style={{marginLeft:'auto'}}>✎</span>
            </div>
          </div>
        </div>

        <div className="hi-eyebrow" style={{marginTop:22, marginBottom:10}}>02 — Category</div>
        <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
          <HiChip cat="deep"  label="Deep Work"/>
          <HiChip cat="study" label="Study"/>
          <HiChip cat="admin" label="Admin"/>
          <HiChip cat="gym"   label="Gym"/>
          <HiChip cat="break" label="Break" selected/>
          <HiChip cat="commute" label="Commute"/>
          <HiChip label="＋ New"/>
        </div>

        <div className="hi-eyebrow" style={{marginTop:22, marginBottom:10}}>03 — Repeat</div>
        <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
          <span className="hi-freq active">Once</span>
          <span className="hi-freq">Daily</span>
          <span className="hi-freq">Weekdays</span>
          <span className="hi-freq">M W F</span>
          <span className="hi-freq">Weekly</span>
          <span className="hi-freq">Custom…</span>
        </div>

        <div className="hi-eyebrow" style={{marginTop:22, marginBottom:6}}>04 — Tags</div>
        <div style={{display:'flex', alignItems:'center', gap:8, padding:'8px 0 12px', borderBottom:'1px solid var(--hairline-2)', fontFamily:'var(--font-ui)', fontSize:13}}>
          <span style={{color:'var(--ink)'}}>Anika</span>
          <span style={{color:'var(--ink-4)'}}>·</span>
          <span style={{color:'var(--ink-3)'}}>＋ add tag</span>
        </div>

        <div style={{display:'flex', gap:10, marginTop:24}}>
          <button className="hi-btn" style={{flex:1, padding:'13px', borderRadius:999, fontSize:11, letterSpacing:'0.16em', textTransform:'uppercase'}}>Cancel</button>
          <button className="hi-btn hi-btn-primary" style={{flex:2, padding:'13px', borderRadius:999}}>Save plan</button>
        </div>
      </div>

      <HiTabBar active="home"/>
    </HiPhone>
  );
}

Object.assign(window, { HiAddEntry, HiAddPlan });
