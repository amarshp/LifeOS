// LifeOS — Day View (chosen)
// Single rail · opacity follows time. Single source of truth for the metaphor.

function DayV1_Overlay() {
  // Rail spans 7a→10p (15h), height 440 → 1h ≈ 29.3px. Now = 1:30p → 196px.
  const NOW = 196;
  return (
    <Phone>
      <StatusBar />
      <Runner task="Admin · inbox" cat="admin" time="0:24:08"/>
      <DateHead date="Tue · May 26" sub="1:30 pm"/>

      <div style={{position:'relative', flex:1, margin:'8px 10px 4px'}}>
        <HourCol start={7} end={22} height={440} left={2} every={1} />

        {/* the rail */}
        <div style={{position:'absolute', left:32, right:8, top:0, height:440}}>
          <div className="rough-light" style={{position:'absolute', inset:0, borderRadius:8}} />

          {/* PAST (above now) — opaque */}
          <Block top={10}  height={62}  cat="deep"   mode="actual" label="Deep Work" sub="9:15 → 10:17"/>
          <Block top={78}  height={18}  cat="break"  mode="actual" label="Coffee"/>
          <Block top={102} height={56}  cat="admin"  mode="actual" label="Inbox + 1:1"/>

          {/* RUNNING — crosses the now-line, no end */}
          <RunningBlock top={178} nowAt={NOW} pendingH={56}
                        cat="admin" label="Admin (cont.)" elapsed="0:24"/>

          {/* FUTURE (below now) — translucent */}
          <Block top={262} height={42}  cat="gym"    mode="planned" label="Gym"     sub="3p"/>
          <Block top={310} height={88}  cat="study"  mode="planned" label="Study"   sub="3:30–5p"/>
          <Block top={406} height={32}  cat="commute" mode="planned" label="Commute"/>
        </div>

        {/* now line */}
        <div style={{position:'absolute', left:24, right:0, top:NOW, height:0,
                     borderTop:'2.5px solid var(--ink)', filter:'url(#wobble-light)'}}>
          <span className="hand" style={{position:'absolute', left:-4, top:-22, fontSize:16, background:'var(--paper)', padding:'0 4px'}}>now · 1:30p</span>
        </div>

        <Note style={{top:18, right:-2, fontSize:13, transform:'rotate(2deg)'}}>
          past =<br/>opaque
        </Note>
        <Note style={{top:188, right:-2, fontSize:13, transform:'rotate(-3deg)'}}>
          running<br/>no end!
        </Note>
        <Note style={{top:330, right:-2, fontSize:13, transform:'rotate(2deg)'}}>
          future =<br/>translucent
        </Note>
      </div>

      <Note style={{bottom:128, right:78, fontSize:13, transform:'rotate(-4deg)', textAlign:'right'}}>
        + plan
      </Note>
      <Note style={{bottom:74, right:78, fontSize:13, transform:'rotate(-4deg)', textAlign:'right'}}>
        ▶ start<br/>tracking
      </Note>

      <Fab kind="secondary" label="+" bottom={134}/>
      <Fab label="▶"/>
      <TabBar active="day" />
    </Phone>
  );
}

// MetaphorCard — explains the opacity-by-time rule used in Day View
function MetaphorCard() {
  const NOW = 150;
  return (
    <div style={{padding:'22px 26px', fontFamily:'var(--body)'}}>
      <div style={{fontFamily:'var(--hand)', fontSize:32, fontWeight:700, lineHeight:1}}>
        the rule
      </div>
      <div style={{fontFamily:'var(--hand)', fontSize:20, color:'var(--ink-soft)', marginTop:2, marginBottom:14}}>
        opacity follows time, not category
      </div>

      <div style={{display:'grid', gridTemplateColumns:'200px 1fr', gap:28, alignItems:'flex-start'}}>
        <div style={{position:'relative', height:300, border:'1.8px solid var(--ink)', borderRadius:6, filter:'url(#wobble-light)'}}>
          <Block top={10}  height={50}  cat="deep"   mode="actual" label="Deep Work" sub="9–10a · done"/>
          <Block top={66}  height={30}  cat="admin"  mode="actual" label="Admin" sub="done"/>
          <RunningBlock top={130} nowAt={NOW} pendingH={50}
                        cat="study" label="Study" elapsed="0:18"/>
          <Block top={210} height={40}  cat="gym"    mode="planned" label="Gym" sub="3p"/>
          <Block top={258} height={32}  cat="commute" mode="planned" label="Commute" sub="6p"/>
          <div style={{position:'absolute', left:-6, right:-6, top:NOW, height:0,
                       borderTop:'2.5px solid var(--ink)', filter:'url(#wobble-light)'}}>
            <span className="hand" style={{position:'absolute', right:-46, top:-10, fontSize:16, color:'var(--ink)'}}>← now</span>
          </div>
        </div>

        <div style={{fontSize:14, lineHeight:1.55}}>
          <div style={{display:'flex', gap:10, alignItems:'flex-start', marginBottom:14}}>
            <div className="cat-deep" style={{width:38, height:22, border:'2px solid var(--ink)', boxShadow:'2px 2px 0 var(--ink)', borderRadius:3, flexShrink:0, marginTop:3}}/>
            <div>
              <b className="hand" style={{fontSize:20}}>past = opaque</b><br/>
              <span style={{color:'var(--ink-soft)'}}>solid fill + drop shadow. it really happened.</span>
            </div>
          </div>

          <div style={{display:'flex', gap:10, alignItems:'flex-start', marginBottom:14}}>
            <div className="planned cat-gym" style={{width:38, height:22, borderRadius:3, flexShrink:0, marginTop:3}}/>
            <div>
              <b className="hand" style={{fontSize:20}}>future = translucent</b><br/>
              <span style={{color:'var(--ink-soft)'}}>dashed outline, faded hatching. just intent.</span>
            </div>
          </div>

          <div style={{display:'flex', gap:10, alignItems:'flex-start'}}>
            <div style={{width:38, height:46, flexShrink:0, marginTop:3, position:'relative'}}>
              <div className="cat-study" style={{position:'absolute', left:0, right:0, top:0, height:22, border:'2px solid var(--ink)', borderBottom:'1.5px solid var(--ink)', boxShadow:'2px 2px 0 var(--ink)', borderRadius:'3px 3px 0 0'}}/>
              <div className="cat-study" style={{position:'absolute', left:0, right:0, top:22, height:18, opacity:0.45, backgroundImage:'repeating-linear-gradient(0deg, transparent 0 6px, var(--ink) 6px 7px)', borderLeft:'2px solid var(--ink)', borderRight:'2px solid var(--ink)'}}/>
              <span style={{position:'absolute', bottom:-4, left:'50%', transform:'translateX(-50%)', fontFamily:'var(--hand)', fontSize:18}}>⋯</span>
            </div>
            <div>
              <b className="hand" style={{fontSize:20}}>running = both</b><br/>
              <span style={{color:'var(--ink-soft)'}}>opaque above the now-line, translucent below.</span><br/>
              <span style={{color:'var(--ink-soft)'}}><i>no end time shown — task is open.</i></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { DayV1_Overlay, MetaphorCard });
