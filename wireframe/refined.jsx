// LifeOS — Refined wireframes based on decisions
// - Week view B refined: parallel activities + tap → day
// - Add Entry: + custom category, tags scoped to category
// - Template Editor: same week grid + repeat frequency

// ═══════════════════════════════════════════════════════════════
// WeekRefined — Compact 7-col, parallel activities, tap → day
// ═══════════════════════════════════════════════════════════════
function WeekRefined() {
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const NOW = 130; // pretend it's Tue ~1:30p — show a runner there

  return (
    <Phone>
      <StatusBar />
      <Runner task="Admin · inbox" cat="admin" time="0:24:08"/>
      <div className="datehead">
        <span className="arrows">←</span>
        <span style={{textAlign:'center'}}>
          <div className="date">Week 22</div>
          <div className="sub">May 25 – 31</div>
        </span>
        <span className="arrows">→</span>
      </div>

      <div style={{position:'relative', flex:1, margin:'4px 8px'}}>
        <div style={{position:'absolute', left:0, top:20, bottom:8, width:22}}>
          <HourCol start={7} end={22} height={420} left={0} every={3} />
        </div>

        <div style={{position:'absolute', left:24, right:0, top:0, bottom:8, display:'flex', gap:2}}>
          {days.map((d,i) => {
            const isToday = i === 1;
            return (
              <div key={i} style={{flex:1, display:'flex', flexDirection:'column'}}>
                <div style={{textAlign:'center', fontFamily:'var(--label)', fontSize:10, fontWeight:isToday?700:400}}>
                  {d[0]}<span style={{color:'var(--ink-faint)'}}>{25+i}</span>
                </div>
                <div className="rough-light"
                     style={{position:'relative', flex:1, borderRadius:4, minHeight:0,
                             boxShadow: isToday ? '0 0 0 1.5px var(--ink)' : 'none'}}>
                  {/* Each block uses sub-column 0/1 of column width for parallel activities */}
                  {(() => {
                    // Past (above each day's "now") vs future varies; for non-today, all is "past" if before today, all "future" if after
                    const isPast = i < 1;
                    const isFuture = i > 1;
                    const blocks = [
                      // 8-9a Deep Work — full width
                      {top:8, h:38, cat:'deep', col:'full'},
                      // 9-10a Deep Work + parallel Music (study cat)
                      {top:48, h:32, cat:'deep',  col:'L'},
                      {top:48, h:32, cat:'study', col:'R'},
                      // 10-11a Admin
                      {top:82, h:28, cat:'admin', col:'full'},
                      // 11-12 Study
                      {top:112, h:30, cat:'study', col:'full'},
                      // Lunch break
                      {top:144, h:14, cat:'break', col:'full'},
                      // 1-2p — Gym (M W F)
                      ...(i!==3&&i!==5&&i!==6 ? [{top:160, h:24, cat:'gym', col:'full'}] : []),
                      // 2-3p Call (admin) + writing parallel
                      {top:186, h:22, cat:'admin', col:'L'},
                      {top:186, h:22, cat:'deep',  col:'R'},
                      // 3-5p Deep work
                      {top:210, h:56, cat:'deep', col:'full'},
                      // 6p Commute weekdays only
                      ...(i<5 ? [{top:298, h:22, cat:'commute', col:'full'}] : []),
                    ];
                    return blocks.map((b, j) => {
                      // determine mode
                      let mode = isPast ? 'actual' : (isFuture ? 'planned' : (b.top + b.h < NOW ? 'actual' : 'planned'));
                      const isRunning = isToday && b.top < NOW && b.top + b.h > NOW && b.cat==='admin' && b.col==='full' && b.top===82;
                      const left = b.col==='L' ? '0%' : b.col==='R' ? '52%' : '0%';
                      const width = b.col==='full' ? '100%' : '48%';
                      if (isRunning) {
                        return <RunningBlock key={j} top={b.top} nowAt={NOW} pendingH={28}
                                             cat={b.cat} label="" 
                                             style={{left, width}}/>;
                      }
                      return <Block key={j} top={b.top} height={b.h} cat={b.cat} mode={mode}
                                    label="" style={{left, width}}/>;
                    });
                  })()}
                  {/* now-line on today */}
                  {isToday && (
                    <div style={{position:'absolute', left:-3, right:-3, top:NOW, height:0,
                                 borderTop:'2px solid var(--ink)'}}>
                      <span className="hand" style={{position:'absolute', right:-2, top:-12, fontSize:9, background:'var(--paper)', padding:'0 2px'}}>now</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Tap-to-day cue: finger tap on today column */}
        <div style={{position:'absolute', top:28, left:48, width:30, fontFamily:'var(--hand)', fontSize:14, transform:'rotate(-2deg)'}}>
          <span style={{fontSize:18}}>☞</span>
        </div>

        <Note style={{top:60, right:-2, fontSize:11, transform:'rotate(-3deg)'}}>
          tap col →<br/>day view
        </Note>
        <Note style={{top:170, right:-2, fontSize:11, transform:'rotate(2deg)'}}>
          parallel<br/>= split col
        </Note>
        <Note style={{bottom:60, right:-2, fontSize:11, color:'var(--ink-faint)'}}>
          opacity =<br/>past/future
        </Note>
      </div>

      <TabBar active="week" />
    </Phone>
  );
}

// Parallel detail callout — show what tapping a parallel cell does
function ParallelDetail() {
  return (
    <div style={{padding:'20px 24px', fontFamily:'var(--body)'}}>
      <div className="hand" style={{fontSize:30, fontWeight:700, lineHeight:1}}>parallel activities</div>
      <div className="hand" style={{fontSize:18, color:'var(--ink-soft)', marginBottom:12}}>
        listening to a podcast while coding
      </div>

      <div style={{display:'grid', gridTemplateColumns:'170px 1fr', gap:24, alignItems:'flex-start'}}>
        {/* sample slot */}
        <div style={{position:'relative', height:160, border:'1.8px solid var(--ink)', borderRadius:6, filter:'url(#wobble-light)'}}>
          {/* labeled hour markers */}
          <div className="tick" style={{position:'absolute', left:-22, top:14}}>9a</div>
          <div className="tick" style={{position:'absolute', left:-22, top:78}}>10a</div>
          <div className="tick" style={{position:'absolute', left:-22, top:142}}>11a</div>

          {/* parallel pair */}
          <Block top={14}  height={62} cat="deep"   mode="actual" label="Code"
                 style={{left:'2%', width:'46%'}}/>
          <Block top={14}  height={62} cat="study"  mode="actual" label="Podcast"
                 style={{left:'52%', width:'46%'}}/>
          {/* full width below */}
          <Block top={80}  height={60} cat="admin"  mode="actual" label="Admin"
                 style={{left:'2%', width:'96%'}}/>
        </div>

        <div style={{fontSize:14, lineHeight:1.55}}>
          <p style={{margin:0}}>
            <b className="hand" style={{fontSize:18}}>two timers, same hour.</b><br/>
            When you start a second timer with "<b>+ parallel</b>" (long-press FAB or pick from sheet), it sits beside the running task instead of replacing it.
          </p>
          <p style={{marginTop:10}}>
            Column splits 50/50. 3+ parallel = thirds.
            Tap either block to see/edit just that one.
          </p>
          <div style={{marginTop:10, padding:'6px 10px', border:'1.5px dashed var(--ink)', borderRadius:6, fontSize:12.5, color:'var(--ink-soft)'}}>
            <b>open Q:</b> should categories like Break or Commute count as parallel-capable, or is that only for "passive" things (music, podcast, etc.)?
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// AddRefined — Timer starts on tap. Sheet lets you fill details
// while running. Start time editable, "use last stop" quick action.
// ═══════════════════════════════════════════════════════════════
function AddRefined() {
  return (
    <Phone>
      <StatusBar />
      <div className="dim" style={{padding:'8px 12px', fontFamily:'var(--label)', fontSize:11, color:'var(--ink-faint)'}}>
        <div>day view…</div>
      </div>
      <div className="scrim" />

      <div className="sheet" style={{bottom:0, borderRadius:'22px 22px 0 0'}}>
        <div className="handle"/>

        {/* Live timer banner — already running */}
        <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:10,
                     padding:'8px 10px', border:'2px solid var(--ink)', borderRadius:10,
                     filter:'url(#wobble-light)', background:'var(--paper-shade)'}}>
          <div style={{width:10, height:10, borderRadius:50, background:'var(--ink)'}}/>
          <span className="hand" style={{fontSize:20, fontWeight:700}}>tracking · 0:00:12</span>
          <span style={{marginLeft:'auto', fontFamily:'var(--label)', fontSize:10, color:'var(--ink-faint)'}}>started 1:30p</span>
        </div>

        {/* Start time row — editable + quick action */}
        <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:10, flexWrap:'wrap'}}>
          <span className="lbl-sm" style={{color:'var(--ink-faint)'}}>START</span>
          <div className="rough-light" style={{padding:'4px 8px', display:'flex', gap:4, alignItems:'center', fontFamily:'var(--hand)', fontSize:16}}>
            1:30 pm
            <span style={{fontFamily:'var(--label)', fontSize:11, opacity:0.5}}>✎</span>
          </div>
          <div className="freq-pill" style={{borderStyle:'dashed', padding:'3px 8px', fontSize:10.5}}>
            ← use last stop · 1:24p
            <span style={{marginLeft:4, color:'var(--ink-faint)'}}>(+6m)</span>
          </div>
        </div>

        {/* Name */}
        <div className="input" style={{marginBottom:10, fontSize:18, padding:'8px 10px'}}>
          Quick call<span style={{opacity:0.3}}>|</span>
        </div>

        <div className="lbl-sm" style={{marginBottom:5, color:'var(--ink-faint)'}}>CATEGORY</div>
        <div style={{display:'flex', flexWrap:'wrap', gap:5, marginBottom:10}}>
          <div className="chip"><div className="swatch cat-deep"/>Deep Work</div>
          <div className="chip"><div className="swatch cat-study"/>Study</div>
          <div className="chip selected"><div className="swatch cat-admin"/>Call</div>
          <div className="chip"><div className="swatch cat-gym"/>Gym</div>
          <div className="chip"><div className="swatch cat-break"/>Break</div>
          <div className="chip"><div className="swatch cat-commute"/>Commute</div>
          <div className="chip" style={{borderStyle:'dashed'}}>
            <span style={{fontFamily:'var(--hand)', fontSize:14}}>+</span> New
          </div>
        </div>

        <div className="lbl-sm" style={{marginBottom:5, color:'var(--ink-faint)'}}>
          TAGS · for <u>Call</u>
        </div>
        <div style={{display:'flex', flexWrap:'wrap', gap:5, alignItems:'center', marginBottom:4}}>
          <div className="tag">Vivek <span className="x">×</span></div>
          <div className="tag">work <span className="x">×</span></div>
          <span style={{fontFamily:'var(--label)', fontSize:11, color:'var(--ink-faint)'}}>Vi|</span>
        </div>
        <div className="dropdown" style={{marginTop:2, marginBottom:12}}>
          <div className="row hover">Vincent <span style={{color:'var(--ink-faint)', float:'right'}}>1 prev. call</span></div>
          <div className="row" style={{fontStyle:'italic', color:'var(--ink-soft)'}}>+ create "Vi"</div>
        </div>

        {/* save / discard */}
        <div style={{display:'flex', gap:8}}>
          <div className="btn outline" style={{flex:1, padding:'10px', fontSize:16}}>Discard</div>
          <div className="btn" style={{flex:2, padding:'10px', fontSize:18}}>Save · keep tracking</div>
        </div>
      </div>

      <Note style={{top:60, right:6, fontSize:13, transform:'rotate(-3deg)'}}>
        timer ran<br/>on tap of ▶
      </Note>
      <Note style={{top:130, right:6, fontSize:11, transform:'rotate(-2deg)'}}>
        edit start<br/>or use last<br/>stop time
      </Note>
      <Note style={{bottom:30, right:6, fontSize:10, color:'var(--ink-faint)', transform:'rotate(-2deg)'}}>
        save = sheet<br/>closes, timer<br/>keeps running
      </Note>
    </Phone>
  );
}

Object.assign(window, { WeekRefined, ParallelDetail, AddRefined });
