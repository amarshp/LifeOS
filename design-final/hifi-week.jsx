// LifeOS — Hi-fi · Week View (Teams-style — 3 days visible, swipe for more)

function HiWeekView({ dark }) {
  const startH = 7, endH = 22;
  const RAIL_H = 520;
  const HR = RAIL_H / (endH - startH);
  const NOW = 6.5 * HR; // 1:30p on Tue

  // 7-day context strip (small)
  const weekDays = [
    { dow:'M', num:25 },
    { dow:'T', num:26, today:true },
    { dow:'W', num:27 },
    { dow:'T', num:28 },
    { dow:'F', num:29 },
    { dow:'S', num:30, weekend:true },
    { dow:'S', num:31, weekend:true },
  ];

  // 3 visible days with their blocks: Mon 25 (past) · Tue 26 (today) · Wed 27 (future)
  const days = [
    {
      dow:'Mon', num:25, past:true, today:false,
      blocks:[
        { s:8.5,  e:11,    cat:'deep',  label:'Deep Work',  sub:'API refactor' },
        { s:11,   e:11.25, cat:'break', label:'Coffee' },
        { s:11.25,e:12.75, cat:'admin', label:'Admin',      sub:'inbox · 1:1' },
        { s:13,   e:14,    cat:'break', label:'Lunch' },
        { s:14,   e:15,    cat:'gym',   label:'Run · 5km' },
        { s:15.5, e:17,    cat:'study', label:'Study',      sub:'ch.3' },
        { s:18,   e:18.7,  cat:'commute', label:'Commute' },
      ],
    },
    {
      dow:'Tue', num:26, past:false, today:true,
      blocks:[
        { s:9.25, e:10.5,  cat:'deep',  label:'Deep Work',  sub:'API refactor' },
        { s:10.5, e:10.75, cat:'break', label:'Coffee' },
        { s:10.75,e:12.5,  cat:'admin', label:'Inbox + 1:1' },
        // currently running Admin: actual portion ends at now (13.5)
        { s:12.5, e:13.5,  cat:'admin', label:'Admin', running:true },
        // its planned remainder — still future, will be eaten as time passes
        { s:13.5, e:14.5,  cat:'admin', label:'Admin' },
        // future
        { s:15,   e:15.75, cat:'gym',   label:'Run · 5km' },
        { s:15.9, e:17.5,  cat:'study', label:'Study',      sub:'ch.4' },
        { s:18,   e:18.7,  cat:'commute', label:'Commute' },
      ],
    },
    {
      dow:'Wed', num:27, past:false, today:false, future:true,
      blocks:[
        { s:9,    e:11,    cat:'deep',  label:'Deep Work' },
        { s:11.25,e:12.5,  cat:'admin', label:'Admin' },
        { s:13,   e:13.75, cat:'break', label:'Lunch' },
        { s:14,   e:15,    cat:'gym',   label:'Gym' },
        { s:15.5, e:17.5,  cat:'study', label:'Study' },
        { s:18,   e:18.7,  cat:'commute', label:'Commute' },
      ],
    },
  ];

  return (
    <HiPhone dark={dark}>
      <HiStatusBar />
      <HiRunner />

      {/* Week header w/ arrows */}
      <div style={{display:'flex', alignItems:'center', padding:'14px 14px 6px', gap:6}}>
        <button className="hi-btn hi-btn-ghost" style={{padding:'6px 8px', borderRadius:8, minWidth:32, lineHeight:1}}>‹</button>
        <div style={{flex:1, textAlign:'center'}}>
          <div style={{fontSize:16, fontWeight:600, letterSpacing:'-0.015em'}}>Week 22</div>
          <div className="hi-meta-sm" style={{fontSize:11.5, marginTop:1}}>May 25 – 31</div>
        </div>
        <button className="hi-btn hi-btn-ghost" style={{padding:'6px 8px', borderRadius:8, minWidth:32, lineHeight:1}}>›</button>
      </div>

      {/* 7-day strip for context */}
      <div style={{display:'flex', gap:0, padding:'4px 16px 10px'}}>
        {weekDays.map((d,i) => {
          const visible = i >= 0 && i <= 2;
          return (
            <div key={i} style={{
              flex:1, textAlign:'center',
              opacity: visible ? 1 : 0.4,
            }}>
              <div className="hi-meta-sm" style={{
                fontSize:9.5, letterSpacing:'0.06em',
                color: d.today ? 'var(--text-1)' : d.weekend ? 'var(--text-4)' : 'var(--text-3)',
                fontWeight: d.today ? 600 : 500,
              }}>{d.dow}</div>
              <div style={{
                marginTop:3, display:'inline-flex', width:22, height:22,
                alignItems:'center', justifyContent:'center',
                borderRadius:50,
                background: d.today ? 'var(--text-1)' : 'transparent',
                color:    d.today ? '#000' : (d.weekend ? 'var(--text-4)' : 'var(--text-2)'),
                fontWeight: d.today ? 600 : 500,
                fontSize:12.5,
                fontFeatureSettings:'"tnum"',
              }}>{d.num}</div>
            </div>
          );
        })}
      </div>

      {/* 3-day grid: hour col + 3 day cols */}
      <div style={{position:'relative', flex:1, margin:'0 8px 0 6px', minHeight:0}}>
        {/* Sticky day-header row */}
        <div style={{display:'flex', paddingLeft:30, gap:6, paddingBottom:8, borderBottom:'1px solid var(--border)'}}>
          {days.map((d,i) => (
            <div key={i} style={{
              flex:1, textAlign:'center', padding:'6px 0',
              borderRadius:8,
              background: d.today ? 'rgba(255,255,255,0.04)' : 'transparent',
              border: d.today ? '1px solid var(--border-2)' : '1px solid transparent',
            }}>
              <div style={{fontSize:11, fontWeight:500, color:'var(--text-3)', letterSpacing:'0.04em', textTransform:'uppercase'}}>{d.dow}</div>
              <div style={{
                marginTop:2,
                fontSize:18, fontWeight:600, letterSpacing:'-0.02em', fontFeatureSettings:'"tnum"',
                color: d.today ? 'var(--text-1)' : 'var(--text-2)',
              }}>{d.num}</div>
            </div>
          ))}
        </div>

        {/* hour col */}
        <div style={{position:'absolute', left:0, top:54, width:28, height:RAIL_H}}>
          <HiHourCol start={startH} end={endH} height={RAIL_H} every={2} />
        </div>

        {/* day cols */}
        <div style={{position:'absolute', left:30, right:0, top:54, height:RAIL_H, display:'flex', gap:6}}>
          {days.map((d,i) => (
            <div key={i} style={{
              flex:1, position:'relative',
              background: d.today ? 'rgba(255,255,255,0.015)' : 'transparent',
              borderRadius: 8,
              border: d.today ? '1px solid var(--border-2)' : 'none',
              overflow:'hidden',
            }}>
              {/* hour grid lines */}
              {Array.from({length: endH-startH+1}).map((_,h) => (
                <div key={h} style={{
                  position:'absolute', left:0, right:0, top: h*HR, height:0,
                  borderTop:'1px solid var(--border)', opacity: 0.7,
                }}/>
              ))}

              {/* blocks */}
              {d.blocks.map((b,j) => {
                const top = (b.s - startH) * HR;
                const h = (b.e - b.s) * HR;
                const isToday = d.today;
                // mode: actuals are tracked time; planned are future intent.
                // explicit running flag marks the actual portion of the live task.
                let mode = d.past ? 'actual'
                         : d.future ? 'planned'
                         : (b.running ? 'actual' : (b.e <= 13.5 ? 'actual' : 'planned'));
                return (
                  <div key={j} className={`hi-block ${mode} ${HCATS[b.cat].cls}`}
                       style={{
                         position:'absolute',
                         top, height: h, left: 3, right: 3,
                         borderRadius: 6,
                         padding:'4px 6px',
                         fontSize:11,
                       }}>
                    <div className="title" style={{fontSize:11, lineHeight:1.15}}>{b.label}</div>
                    {b.sub && h > 32 && <div className="sub" style={{fontSize:10}}>{b.sub}</div>}
                  </div>
                );
              })}

              {/* now line — today only */}
              {d.today && (
                <div className="hi-now-line" style={{top: NOW, left:-1, right:-1}}/>
              )}
            </div>
          ))}
        </div>
      </div>

      <HiTabBar active="week"/>
    </HiPhone>
  );
}

Object.assign(window, { HiWeekView });
