// LifeOS — Plan & edit interactions
// - AddPlanSheet: sheet from the secondary "+" FAB
// - DayEditMode: tap a block → inline edit popover
// - DayDragMode: hold & drag to reschedule
// - WeekToDayFlow: mini diagram (tap a day in week → its day view)

// ═══════════════════════════════════════════════════════════════
// AddPlanSheet — for the + FAB. Creates a planned (translucent) block.
// Differs from AddRefined: no live timer, requires start AND end time,
// + optional repeat. Saving inserts the planned block on the day rail.
// ═══════════════════════════════════════════════════════════════
function AddPlanSheet() {
  return (
    <Phone>
      <StatusBar />
      <div className="dim" style={{padding:'8px 12px', fontFamily:'var(--label)', fontSize:11, color:'var(--ink-faint)'}}>
        <div>day view…</div>
      </div>
      <div className="scrim" />

      <div className="sheet" style={{bottom:0, borderRadius:'22px 22px 0 0'}}>
        <div className="handle"/>
        <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:6}}>
          <span className="hand" style={{fontSize:24, fontWeight:600}}>New plan</span>
          <span className="label" style={{fontSize:10, color:'var(--ink-faint)'}}>(no timer)</span>
        </div>

        <div className="input" style={{marginBottom:10, fontSize:18, padding:'8px 10px'}}>
          Lunch with Anika<span style={{opacity:0.3}}>|</span>
        </div>

        <div style={{display:'flex', gap:8, marginBottom:10}}>
          <div style={{flex:1}}>
            <div className="lbl-sm" style={{color:'var(--ink-faint)', marginBottom:3}}>START</div>
            <div className="rough-light" style={{padding:'6px 8px', fontFamily:'var(--hand)', fontSize:16, display:'flex', justifyContent:'space-between'}}>
              <span>12:30 pm</span>
              <span style={{opacity:0.4, fontSize:11}}>✎</span>
            </div>
          </div>
          <div style={{flex:1}}>
            <div className="lbl-sm" style={{color:'var(--ink-faint)', marginBottom:3}}>END</div>
            <div className="rough-light" style={{padding:'6px 8px', fontFamily:'var(--hand)', fontSize:16, display:'flex', justifyContent:'space-between'}}>
              <span>1:30 pm</span>
              <span style={{opacity:0.4, fontSize:11}}>✎</span>
            </div>
          </div>
        </div>

        <div className="lbl-sm" style={{marginBottom:5, color:'var(--ink-faint)'}}>CATEGORY</div>
        <div style={{display:'flex', flexWrap:'wrap', gap:5, marginBottom:10}}>
          <div className="chip"><div className="swatch cat-deep"/>Deep Work</div>
          <div className="chip"><div className="swatch cat-study"/>Study</div>
          <div className="chip"><div className="swatch cat-admin"/>Call</div>
          <div className="chip"><div className="swatch cat-gym"/>Gym</div>
          <div className="chip selected"><div className="swatch cat-break"/>Break</div>
          <div className="chip"><div className="swatch cat-commute"/>Commute</div>
          <div className="chip" style={{borderStyle:'dashed'}}>
            <span style={{fontFamily:'var(--hand)', fontSize:14}}>+</span> New
          </div>
        </div>

        <div className="lbl-sm" style={{marginBottom:5, color:'var(--ink-faint)'}}>REPEAT</div>
        <div style={{display:'flex', flexWrap:'wrap', gap:4, marginBottom:12}}>
          <div className="freq-pill active">Once</div>
          <div className="freq-pill">Daily</div>
          <div className="freq-pill">Weekdays</div>
          <div className="freq-pill">M W F</div>
          <div className="freq-pill">Weekly</div>
          <div className="freq-pill">Custom…</div>
        </div>

        <div className="lbl-sm" style={{marginBottom:5, color:'var(--ink-faint)'}}>TAGS · for <u>Break</u></div>
        <div style={{display:'flex', flexWrap:'wrap', gap:5, marginBottom:14}}>
          <div className="tag">Anika <span className="x">×</span></div>
          <span style={{fontFamily:'var(--label)', fontSize:11, color:'var(--ink-faint)'}}>+ add tag</span>
        </div>

        <div style={{display:'flex', gap:8}}>
          <div className="btn outline" style={{flex:1, padding:'10px', fontSize:16}}>Cancel</div>
          <div className="btn" style={{flex:2, padding:'10px', fontSize:18}}>Save plan</div>
        </div>
      </div>

      <Note style={{top:74, right:6, fontSize:12, transform:'rotate(-3deg)'}}>
        plan = future<br/>(translucent)
      </Note>
      <Note style={{top:165, right:6, fontSize:11, transform:'rotate(-2deg)'}}>
        needs end time<br/>(unlike ▶)
      </Note>
      <Note style={{top:325, right:6, fontSize:11, transform:'rotate(-2deg)'}}>
        repeat lives<br/>on the plan
      </Note>
    </Phone>
  );
}

// ═══════════════════════════════════════════════════════════════
// DayEditMode — tap a block → inline edit popover
// ═══════════════════════════════════════════════════════════════
function DayEditMode() {
  const NOW = 196;
  return (
    <Phone>
      <StatusBar />
      <Runner task="Admin · inbox" cat="admin" time="0:24:08"/>
      <DateHead date="Tue · May 26" sub="1:30 pm"/>

      <div style={{position:'relative', flex:1, margin:'8px 10px 4px'}}>
        <HourCol start={7} end={22} height={440} left={2} every={1} />

        <div style={{position:'absolute', left:32, right:8, top:0, height:440}}>
          <div className="rough-light" style={{position:'absolute', inset:0, borderRadius:8}} />

          <Block top={10}  height={62}  cat="deep"   mode="actual" label="Deep Work" sub="9:15 → 10:17"/>
          <Block top={78}  height={18}  cat="break"  mode="actual" label="Coffee"/>
          {/* selected outline */}
          <div style={{position:'absolute', top:99, left:-4, right:-4, height:60, border:'2.5px solid var(--ink)', borderRadius:5, pointerEvents:'none', filter:'url(#wobble)'}}/>
          <Block top={102} height={56}  cat="admin"  mode="actual" label="Inbox + 1:1" sub="10:30→11:30"/>

          <RunningBlock top={178} nowAt={NOW} pendingH={56}
                        cat="admin" label="Admin (cont.)" elapsed="0:24"/>
          <Block top={262} height={42}  cat="gym"    mode="planned" label="Gym"     sub="3p"/>
          <Block top={310} height={88}  cat="study"  mode="planned" label="Study"   sub="3:30–5p"/>
        </div>

        {/* edit popover anchored to selected block */}
        <div className="popover" style={{left:60, top:178, width:220}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <span className="hand" style={{fontSize:18, fontWeight:600}}>Inbox + 1:1</span>
            <span className="label" style={{fontSize:10, color:'var(--ink-faint)'}}>actual · 60m</span>
          </div>

          <div style={{display:'flex', gap:6, marginTop:8}}>
            <div style={{flex:1}}>
              <div className="lbl-sm" style={{color:'var(--ink-faint)'}}>START</div>
              <div className="rough-light" style={{padding:'4px 6px', fontFamily:'var(--hand)', fontSize:14}}>10:30 ✎</div>
            </div>
            <div style={{flex:1}}>
              <div className="lbl-sm" style={{color:'var(--ink-faint)'}}>END</div>
              <div className="rough-light" style={{padding:'4px 6px', fontFamily:'var(--hand)', fontSize:14}}>11:30 ✎</div>
            </div>
          </div>

          <div className="lbl-sm" style={{marginTop:8, color:'var(--ink-faint)'}}>CATEGORY</div>
          <div style={{display:'flex', gap:4, marginTop:3}}>
            <div className="cat-deep"    style={{width:18, height:18, border:'1.5px solid var(--ink)', borderRadius:3}}/>
            <div className="cat-study"   style={{width:18, height:18, border:'1.5px solid var(--ink)', borderRadius:3}}/>
            <div className="cat-admin"   style={{width:18, height:18, border:'2.5px solid var(--ink)', borderRadius:3}}/>
            <div className="cat-gym"     style={{width:18, height:18, border:'1.5px solid var(--ink)', borderRadius:3}}/>
            <div className="cat-break"   style={{width:18, height:18, border:'1.5px solid var(--ink)', borderRadius:3}}/>
            <div className="cat-commute" style={{width:18, height:18, border:'1.5px solid var(--ink)', borderRadius:3}}/>
          </div>

          <div className="lbl-sm" style={{marginTop:8, color:'var(--ink-faint)'}}>TAGS</div>
          <div style={{display:'flex', flexWrap:'wrap', gap:4, marginTop:3}}>
            <div className="tag">inbox <span className="x">×</span></div>
            <div className="tag">1:1 <span className="x">×</span></div>
          </div>

          <div style={{display:'flex', gap:8, marginTop:10, alignItems:'center', fontFamily:'var(--hand)', fontSize:14}}>
            <span style={{textDecoration:'underline'}}>delete</span>
            <span style={{marginLeft:4, color:'var(--ink-faint)'}}>split ↕</span>
            <span style={{marginLeft:'auto', fontWeight:700}}>save ›</span>
          </div>
        </div>

        <Note style={{top:104, right:-10, fontSize:12, transform:'rotate(3deg)'}}>
          tap block<br/>→ edit
        </Note>
        <Note style={{bottom:60, left:-2, fontSize:11, color:'var(--ink-faint)'}}>
          works for plan<br/>or actual
        </Note>
      </div>

      <Fab kind="secondary" label="+" bottom={134}/>
      <Fab label="▶"/>
      <TabBar active="day" />
    </Phone>
  );
}

// ═══════════════════════════════════════════════════════════════
// DayDragMode — hold & drag to reschedule
// ═══════════════════════════════════════════════════════════════
function DayDragMode() {
  const NOW = 196;
  return (
    <Phone>
      <StatusBar />
      <Runner task="Admin · inbox" cat="admin" time="0:24:08"/>
      <DateHead date="Tue · May 26" sub="1:30 pm"/>

      <div style={{position:'relative', flex:1, margin:'8px 10px 4px'}}>
        <HourCol start={7} end={22} height={440} left={2} every={1} />

        <div style={{position:'absolute', left:32, right:8, top:0, height:440}}>
          <div className="rough-light" style={{position:'absolute', inset:0, borderRadius:8}} />

          <Block top={10}  height={62}  cat="deep"   mode="actual" label="Deep Work" sub="9:15 → 10:17"/>
          <Block top={78}  height={18}  cat="break"  mode="actual" label="Coffee"/>
          <Block top={102} height={56}  cat="admin"  mode="actual" label="Inbox + 1:1" sub="10:30→11:30"/>

          <RunningBlock top={178} nowAt={NOW} pendingH={56}
                        cat="admin" label="Admin (cont.)" elapsed="0:24"/>

          {/* Gym ghost (original spot) */}
          <div className="rough-dashed" style={{position:'absolute', top:262, left:1, right:1, height:42, borderRadius:3, opacity:0.4}}>
            <span style={{position:'absolute', top:2, left:6, fontFamily:'var(--label)', fontSize:9.5, color:'var(--ink-faint)'}}>was here</span>
          </div>

          {/* Lifted Gym block — offset, rotated, shadowed */}
          <div className="block planned cat-gym"
               style={{position:'absolute', top:296, left:14, right:-10, height:42, borderRadius:4, opacity:1,
                       border:'2.5px solid var(--ink)',
                       boxShadow:'4px 5px 0 var(--ink)',
                       transform:'rotate(-1.5deg)',
                       background:'var(--paper)',
                       filter:'url(#wobble)',
                       zIndex:3}}>
            <div style={{padding:'4px 6px', fontFamily:'var(--label)', fontSize:10, fontWeight:700}}>Gym</div>
            <div style={{padding:'0 6px', fontFamily:'var(--hand)', fontSize:14}}>3:30p</div>
          </div>

          <Block top={358} height={40}  cat="study"  mode="planned" label="Study"/>
        </div>

        {/* finger cursor */}
        <div style={{position:'absolute', top:316, left:130, fontSize:30, fontFamily:'var(--hand)', transform:'rotate(15deg)'}}>☝</div>

        <Note style={{top:248, right:-2, fontSize:12, transform:'rotate(2deg)'}}>
          ┄┄┄ ghost<br/>(orig. spot)
        </Note>
        <Note style={{top:298, right:-10, fontSize:12, transform:'rotate(-4deg)'}}>
          hold + drag<br/>to move ↕
        </Note>
        <Note style={{bottom:78, left:-2, fontSize:11, color:'var(--ink-faint)'}}>
          snaps to 5-min<br/>increments
        </Note>
      </div>

      <Fab kind="secondary" label="+" bottom={134}/>
      <Fab label="▶"/>
      <TabBar active="day" />
    </Phone>
  );
}

// ═══════════════════════════════════════════════════════════════
// WeekToDayFlow — mini week + arrow + mini day
// ═══════════════════════════════════════════════════════════════
function WeekToDayFlow() {
  return (
    <div style={{padding:'20px 24px', fontFamily:'var(--body)'}}>
      <div className="hand" style={{fontSize:28, fontWeight:700, lineHeight:1}}>tap a day → its day view</div>
      <div className="hand" style={{fontSize:16, color:'var(--ink-soft)', marginBottom:14}}>
        the week is a launcher
      </div>

      <div style={{display:'grid', gridTemplateColumns:'180px 60px 180px', gap:8, alignItems:'center'}}>
        {/* mini week */}
        <div style={{border:'2px solid var(--ink)', borderRadius:6, padding:8, filter:'url(#wobble-light)'}}>
          <div style={{display:'flex', gap:2, marginBottom:4}}>
            {['M','T','W','T','F','S','S'].map((d,i)=>(
              <div key={i} style={{flex:1, textAlign:'center', fontFamily:'var(--label)', fontSize:9, fontWeight:i===2?700:400}}>{d}</div>
            ))}
          </div>
          <div style={{display:'flex', gap:2, height:130, position:'relative'}}>
            {[0,1,2,3,4,5,6].map(i=>(
              <div key={i} style={{flex:1, border:'1px solid var(--ink-faint)', borderRadius:3, position:'relative',
                                   boxShadow: i===2 ? '0 0 0 2px var(--ink)' : 'none'}}>
                <div className="cat-deep" style={{position:'absolute', top:6, left:1, right:1, height:18, border:'1px solid var(--ink)', borderRadius:2}}/>
                <div className="cat-admin" style={{position:'absolute', top:28, left:1, right:1, height:12, border:'1px solid var(--ink)', borderRadius:2}}/>
                <div className="planned cat-study" style={{position:'absolute', top:50, left:1, right:1, height:22, borderRadius:2}}/>
                {(i===0||i===2||i===4) && <div className="planned cat-gym" style={{position:'absolute', top:78, left:1, right:1, height:14, borderRadius:2}}/>}
              </div>
            ))}
            <div style={{position:'absolute', top:55, left:'31%', fontSize:18}}>☞</div>
          </div>
        </div>

        <div style={{textAlign:'center'}}>
          <div className="hand" style={{fontSize:38, lineHeight:1}}>→</div>
          <div className="label" style={{fontSize:11, color:'var(--ink-faint)'}}>tap Wed</div>
        </div>

        {/* mini day */}
        <div style={{border:'2px solid var(--ink)', borderRadius:6, padding:8, filter:'url(#wobble-light)'}}>
          <div className="hand" style={{fontSize:13, fontWeight:600, textAlign:'center', marginBottom:4}}>Wed · May 27</div>
          <div style={{position:'relative', height:130}}>
            <div className="cat-deep"  style={{position:'absolute', top:6,  left:0, right:0, height:30, border:'1.5px solid var(--ink)', borderRadius:3, boxShadow:'2px 2px 0 var(--ink)'}}/>
            <div className="cat-admin" style={{position:'absolute', top:40, left:0, right:0, height:22, border:'1.5px solid var(--ink)', borderRadius:3, boxShadow:'2px 2px 0 var(--ink)'}}/>
            <div className="planned cat-study" style={{position:'absolute', top:68, left:0, right:0, height:36, borderRadius:3}}/>
            <div className="planned cat-gym"   style={{position:'absolute', top:108, left:0, right:0, height:18, borderRadius:3}}/>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { AddPlanSheet, DayEditMode, DayDragMode, WeekToDayFlow });
