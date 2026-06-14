// LifeOS — Premium · Extra screens
// ① Custom category creation
// ② Tag management
// ③ Stats / Reports
// ④ Onboarding (3 screens)
// ⑤ Notifications settings

// ═══════════════════════════════════════════════════════════════
// ① Custom Category Creation (sheet from "+ New" on any chip picker)
// ═══════════════════════════════════════════════════════════════
const PALETTE = [
  '#B5AAC2','#CCBADD','#E7D0A2','#AFC8AC','#D2CFC5','#C4B3A4',
  '#D4A5A5','#A5BED4','#D4C5A5','#B5D4C2','#C2A5D4','#D4B5A5',
];

function HiNewCategory({ dark }) {
  return (
    <HiPhone dark={dark}>
      <HiStatusBar />
      <div style={{opacity:0.3, pointerEvents:'none', padding:'18px 24px'}}>
        <div className="hi-h1">Today</div>
        <div className="hi-meta" style={{marginTop:4}}>day view behind…</div>
      </div>
      <div className="hi-scrim"/>

      <div className="hi-sheet">
        <div className="handle"/>

        <div className="hi-eyebrow">New category</div>

        <input className="hi-input" placeholder="Category name" defaultValue="Meetings" style={{marginTop:4}}/>

        <div className="hi-eyebrow" style={{marginTop:28, marginBottom:12}}>01 — Color</div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(6, 1fr)', gap:10}}>
          {PALETTE.map((c, i) => (
            <div key={i} style={{
              width:'100%', aspectRatio:'1', borderRadius:'50%',
              background: c,
              border: i === 6 ? '2px solid var(--ink)' : '1px solid var(--hairline)',
              boxShadow: i === 6 ? '0 0 0 3px var(--bg), 0 0 0 5px var(--ink)' : 'none',
              cursor:'pointer',
            }}/>
          ))}
        </div>

        <div className="hi-eyebrow" style={{marginTop:28, marginBottom:12}}>02 — Icon (optional)</div>
        <div style={{display:'flex', gap:10, flexWrap:'wrap'}}>
          {['📋','💬','🎯','📞','✏️','🔔','📊','⚡'].map((e, i) => (
            <div key={i} style={{
              width:40, height:40, borderRadius:10,
              display:'flex', alignItems:'center', justifyContent:'center',
              border: i === 3 ? '2px solid var(--ink)' : '1px solid var(--hairline)',
              fontSize:18, cursor:'pointer',
              background: i === 3 ? 'var(--surface-3)' : 'transparent',
            }}>{e}</div>
          ))}
        </div>

        <div className="hi-eyebrow" style={{marginTop:28, marginBottom:8}}>03 — Default tags (optional)</div>
        <div style={{display:'flex', alignItems:'center', gap:8, padding:'8px 0 12px', borderBottom:'1px solid var(--hairline)', fontSize:13}}>
          <span style={{color:'var(--ink)'}}>standup</span>
          <span style={{color:'var(--ink-4)'}}>·</span>
          <span style={{color:'var(--ink)'}}>weekly</span>
          <span style={{color:'var(--ink-4)'}}>·</span>
          <span style={{color:'var(--ink-3)'}}>＋ add</span>
        </div>

        <div style={{display:'flex', gap:10, marginTop:24}}>
          <button className="hi-btn" style={{flex:1, padding:'13px', borderRadius:999, fontSize:11, letterSpacing:'0.16em', textTransform:'uppercase'}}>Cancel</button>
          <button className="hi-btn hi-btn-primary" style={{flex:2, padding:'13px', borderRadius:999}}>Create category</button>
        </div>
      </div>

      <HiTabBar active="day"/>
    </HiPhone>
  );
}

// ═══════════════════════════════════════════════════════════════
// ② Tag Management (from Settings → Tags)
// ═══════════════════════════════════════════════════════════════
function HiTagManagement({ dark }) {
  const groups = [
    { cat:'admin', tags:[
      {name:'vivek', count:12}, {name:'inbox', count:8}, {name:'1:1', count:6}, {name:'standup', count:4},
    ]},
    { cat:'deep', tags:[
      {name:'api', count:18}, {name:'design', count:7}, {name:'refactor', count:5},
    ]},
    { cat:'gym', tags:[
      {name:'run', count:14}, {name:'strength', count:3},
    ]},
    { cat:'study', tags:[
      {name:'algorithms', count:9}, {name:'ch.4', count:2},
    ]},
    { cat:'break', tags:[
      {name:'coffee', count:22}, {name:'lunch', count:11},
    ]},
    { cat:'commute', tags:[
      {name:'home→office', count:16}, {name:'office→home', count:15},
    ]},
  ];

  return (
    <HiPhone dark={dark}>
      <HiStatusBar />

      <div style={{padding:'18px 24px 6px', display:'flex', alignItems:'center', gap:12}}>
        <button style={{background:'transparent', border:0, fontFamily:'var(--font-display)', fontSize:22, color:'var(--ink)', cursor:'pointer', padding:0}}>‹</button>
        <div>
          <div className="hi-num">Settings</div>
          <div className="hi-h2" style={{marginTop:2}}>Tags</div>
        </div>
        <div style={{marginLeft:'auto'}}>
          <span className="hi-meta-sm" style={{fontFeatureSettings:'"tnum"'}}>48 total</span>
        </div>
      </div>

      <hr className="hi-rule" style={{margin:'12px 24px'}}/>

      {/* search */}
      <div style={{padding:'0 24px 8px'}}>
        <div style={{padding:'10px 0', borderBottom:'1px solid var(--hairline)', fontFamily:'var(--font-ui)', fontSize:14, color:'var(--ink-3)'}}>
          Search tags…
        </div>
      </div>

      <div style={{padding:'0 24px', flex:1, overflow:'hidden', display:'flex', flexDirection:'column', gap:0}}>
        {groups.map((g, i) => (
          <div key={i} style={{paddingTop: i === 0 ? 8 : 16, paddingBottom:4}}>
            <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:6}}>
              <span style={{width:8, height:8, borderRadius:50, background:`var(--c-${g.cat})`}}/>
              <span className="hi-eyebrow">{HCATS[g.cat].name}</span>
              <span className="hi-meta-sm" style={{marginLeft:'auto'}}>{g.tags.length}</span>
            </div>
            {g.tags.map((t, j) => (
              <div key={j} style={{
                display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'10px 0',
                borderBottom: '1px solid var(--hairline)',
              }}>
                <span style={{fontFamily:'var(--font-display)', fontSize:16, fontWeight:600}}>{t.name}</span>
                <span className="hi-meta-sm" style={{fontFeatureSettings:'"tnum"'}}>{t.count} uses</span>
              </div>
            ))}
            {/* show only first 2 tags per group to fit screen; real UI scrolls */}
          </div>
        )).slice(0, 4)}
      </div>

      <HiTabBar active="set"/>
    </HiPhone>
  );
}

// ═══════════════════════════════════════════════════════════════
// ③ Stats / Reports
// ═══════════════════════════════════════════════════════════════
function HiStats({ dark }) {
  const days = ['M','T','W','T','F','S','S'];
  const dayData = [
    {deep:3.5, admin:1.5, study:2, gym:0.5, brk:0.4, comm:0.7},
    {deep:4,   admin:1,   study:1.8, gym:0.8, brk:0.3, comm:0.7},
    {deep:3,   admin:2.2, study:2.5, gym:0, brk:0.5, comm:0.7},
    {deep:5,   admin:1,   study:0, gym:0.8, brk:0.2, comm:0.7},
    {deep:2.5, admin:1.5, study:1.4, gym:0, brk:1, comm:0.7},
    {deep:0,   admin:0,   study:1.5, gym:1, brk:0.5, comm:0},
    {deep:0,   admin:0,   study:0.5, gym:0, brk:0.8, comm:0},
  ];
  const maxH = 10;
  const catKeys = ['deep','admin','study','gym','brk','comm'];
  const catColors = ['var(--c-deep)','var(--c-admin)','var(--c-study)','var(--c-gym)','var(--c-break)','var(--c-commute)'];
  const catNames = ['Deep Work','Admin','Study','Gym','Break','Commute'];
  const totalByDay = dayData.map(d => catKeys.reduce((s,k)=> s + (d[k]||0), 0));
  const weekTotal = totalByDay.reduce((s,v) => s + v, 0);
  const catTotals = catKeys.map(k => dayData.reduce((s,d) => s + (d[k]||0), 0));

  return (
    <HiPhone dark={dark}>
      <HiStatusBar />

      <div style={{padding:'18px 24px 6px'}}>
        <div className="hi-num">Reports</div>
        <div className="hi-h1" style={{marginTop:6}}>This Week</div>
        <div className="hi-meta" style={{marginTop:4}}>May 25 – 31</div>
      </div>

      <hr className="hi-rule" style={{margin:'14px 24px'}}/>

      <div style={{padding:'6px 24px', flex:1, display:'flex', flexDirection:'column', gap:0, overflow:'hidden'}}>

        {/* Big number */}
        <div style={{display:'flex', gap:24, paddingBottom:18, borderBottom:'1px solid var(--hairline)'}}>
          <div>
            <div style={{fontFamily:'var(--font-display)', fontSize:44, fontWeight:700, letterSpacing:'-0.03em', lineHeight:1}}>
              {weekTotal.toFixed(1)}<span style={{fontSize:20, fontWeight:400, color:'var(--ink-3)'}}>h</span>
            </div>
            <div className="hi-meta-sm">total tracked</div>
          </div>
          <div>
            <div style={{fontFamily:'var(--font-display)', fontSize:44, fontWeight:700, letterSpacing:'-0.03em', lineHeight:1, color:'var(--ink-2)'}}>
              48<span style={{fontSize:20, fontWeight:400, color:'var(--ink-3)'}}>h</span>
            </div>
            <div className="hi-meta-sm">planned</div>
          </div>
          <div>
            <div style={{fontFamily:'var(--font-display)', fontSize:44, fontWeight:700, letterSpacing:'-0.03em', lineHeight:1, color:'#C2856A'}}>
              +42<span style={{fontSize:20, fontWeight:400, color:'var(--ink-3)'}}>m</span>
            </div>
            <div className="hi-meta-sm">avg drift</div>
          </div>
        </div>

        {/* Bar chart */}
        <div className="hi-eyebrow" style={{marginTop:18, marginBottom:12}}>01 — Daily hours</div>
        <div style={{display:'flex', gap:8, alignItems:'flex-end', height:120}}>
          {dayData.map((d, i) => {
            const total = totalByDay[i];
            return (
              <div key={i} style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4}}>
                <div style={{width:'100%', height:(total/maxH)*100, display:'flex', flexDirection:'column-reverse', borderRadius:3, overflow:'hidden'}}>
                  {catKeys.map((k, j) => {
                    const h = d[k] || 0;
                    if (h === 0) return null;
                    return (
                      <div key={j} style={{height:`${(h/total)*100}%`, background:catColors[j], minHeight:1}}/>
                    );
                  })}
                </div>
                <span className="hi-meta-sm" style={{fontSize:10, fontWeight: i===1?600:400}}>{days[i]}</span>
              </div>
            );
          })}
        </div>

        {/* Category breakdown */}
        <div className="hi-eyebrow" style={{marginTop:22, marginBottom:8}}>02 — By category</div>
        {catKeys.map((k, i) => {
          const hrs = catTotals[i];
          const pct = (hrs / weekTotal * 100).toFixed(0);
          return (
            <div key={i} style={{display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:'1px solid var(--hairline)'}}>
              <span style={{width:8, height:8, borderRadius:50, background:catColors[i], flexShrink:0}}/>
              <span style={{fontFamily:'var(--font-display)', fontSize:15, fontWeight:600, flex:1}}>{catNames[i]}</span>
              <span style={{fontFamily:'var(--font-mono)', fontSize:12, color:'var(--ink-2)', fontFeatureSettings:'"tnum"'}}>{hrs.toFixed(1)}h</span>
              <span className="hi-meta-sm" style={{width:28, textAlign:'right', fontFeatureSettings:'"tnum"'}}>{pct}%</span>
            </div>
          );
        })}
      </div>

      <HiTabBar active="home"/>
    </HiPhone>
  );
}

// ═══════════════════════════════════════════════════════════════
// ④ Onboarding (3 screens)
// ═══════════════════════════════════════════════════════════════
function HiOnboarding1({ dark }) {
  return (
    <HiPhone dark={dark}>
      <HiStatusBar />
      <div style={{flex:1, display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', padding:'0 40px', textAlign:'center'}}>
        <div style={{
          fontFamily:'var(--font-display)', fontSize:72, fontWeight:700,
          letterSpacing:'-0.04em', lineHeight:0.92, color:'var(--ink)',
        }}>
          Life<br/>OS<span style={{fontStyle:'italic', color:'var(--ink-3)'}}>.</span>
        </div>
        <div style={{
          fontFamily:'var(--font-display)', fontSize:18, fontWeight:400,
          fontStyle:'italic', color:'var(--ink-2)', marginTop:24, lineHeight:1.4,
        }}>
          Plan your time.<br/>
          Track what happens.<br/>
          See the difference.
        </div>
      </div>
      <div style={{padding:'0 28px 40px'}}>
        <button className="hi-btn hi-btn-primary" style={{width:'100%', padding:'16px', borderRadius:999}}>
          Get started
        </button>
      </div>
    </HiPhone>
  );
}

function HiOnboarding2({ dark }) {
  const cats = [
    { k:'deep',  name:'Deep Work',  on:true },
    { k:'study', name:'Study',      on:true },
    { k:'admin', name:'Admin',      on:true },
    { k:'gym',   name:'Gym',        on:true },
    { k:'break', name:'Break',      on:false },
    { k:'commute', name:'Commute',  on:false },
  ];
  return (
    <HiPhone dark={dark}>
      <HiStatusBar />

      <div style={{padding:'32px 28px 0'}}>
        <div className="hi-num">Step 1 of 2</div>
        <div className="hi-h1" style={{marginTop:8}}>Your categories</div>
        <div className="hi-meta" style={{marginTop:8, lineHeight:1.5}}>
          These are defaults. Toggle off what you don't need, or add your own.
        </div>
      </div>

      <div style={{padding:'24px 28px', flex:1}}>
        {cats.map((c, i) => (
          <div key={i} style={{
            display:'flex', alignItems:'center', gap:14,
            padding:'14px 0',
            borderBottom:'1px solid var(--hairline)',
          }}>
            <span style={{width:12, height:12, borderRadius:50, background:`var(--c-${c.k})`}}/>
            <span style={{fontFamily:'var(--font-display)', fontSize:18, fontWeight:600, flex:1}}>{c.name}</span>
            <Switch on={c.on}/>
          </div>
        ))}
        <div style={{
          display:'flex', alignItems:'center', gap:14,
          padding:'14px 0', cursor:'pointer',
        }}>
          <span style={{width:12, height:12, borderRadius:50, border:'1.5px dashed var(--ink-4)'}}/>
          <span style={{fontFamily:'var(--font-display)', fontSize:18, fontWeight:500, color:'var(--ink-3)'}}>＋ Add your own</span>
        </div>
      </div>

      <div style={{padding:'0 28px 40px'}}>
        <button className="hi-btn hi-btn-primary" style={{width:'100%', padding:'16px', borderRadius:999}}>
          Continue
        </button>
      </div>
    </HiPhone>
  );
}

function HiOnboarding3({ dark }) {
  return (
    <HiPhone dark={dark}>
      <HiStatusBar />

      <div style={{padding:'32px 28px 0'}}>
        <div className="hi-num">Step 2 of 2</div>
        <div className="hi-h1" style={{marginTop:8}}>Plan your day</div>
        <div className="hi-meta" style={{marginTop:8, lineHeight:1.5}}>
          Add a few blocks to see how it works. Tap ＋ to schedule, ▶ to track.
        </div>
      </div>

      {/* Mini demo timeline */}
      <div style={{position:'relative', flex:1, margin:'24px 28px 0'}}>
        <div style={{position:'absolute', left:0, top:0, bottom:0, width:28}}>
          <HiHourCol start={9} end={17} height={340} every={2} />
        </div>
        <div style={{position:'absolute', left:32, right:0, top:0, height:340}}>
          <HiBlock top={4}   height={80} right={0} cat="deep" mode="planned" label="Deep Work" sub="9:00 – 11:00"/>
          <HiBlock top={88}  height={40} right={0} cat="admin" mode="planned" label="Meetings" sub="11:00 – 12:00"/>
          <HiBlock top={134} height={40} right={0} cat="break" mode="planned" label="Lunch" sub="12:00 – 1:00"/>
          {/* empty slot prompts */}
          <div style={{
            position:'absolute', top:182, left:0, right:0, height:60,
            borderRadius:4, border:'1.5px dashed var(--hairline-2)',
            display:'flex', alignItems:'center', justifyContent:'center',
            color:'var(--ink-3)', fontSize:13, fontFamily:'var(--font-display)', fontWeight:500,
          }}>
            ＋ Add afternoon block
          </div>
        </div>
      </div>

      <div style={{padding:'0 28px 40px', display:'flex', gap:10}}>
        <button className="hi-btn" style={{flex:1, padding:'16px', borderRadius:999, fontSize:11, letterSpacing:'0.16em', textTransform:'uppercase'}}>Skip</button>
        <button className="hi-btn hi-btn-primary" style={{flex:2, padding:'16px', borderRadius:999}}>
          Done — let's go
        </button>
      </div>
    </HiPhone>
  );
}

// ═══════════════════════════════════════════════════════════════
// ⑤ Notifications Settings (from Settings → Notifications)
// ═══════════════════════════════════════════════════════════════
function HiNotifications({ dark }) {
  const notifs = [
    { group: '01 — Timer alerts', items:[
      { label:'Running too long',     sub:'After 90 min with no stop', on:true },
      { label:'Idle reminder',        sub:'After 15 min with nothing tracking', on:true },
    ]},
    { group: '02 — Plans', items:[
      { label:'Plan starts soon',     sub:'5 min before a planned block', on:true },
      { label:'Plan missed',          sub:'When a plan window passes untracked', on:false },
    ]},
    { group: '03 — Summary', items:[
      { label:'End-of-day summary',   sub:'Daily tracked vs planned at 9 PM', on:true },
      { label:'Weekly report',        sub:'Every Monday morning', on:true },
    ]},
    { group: '04 — Drift', items:[
      { label:'Drift alert',          sub:'When drift exceeds 30 min in a day', on:false },
      { label:'Streak broken',        sub:'When a daily category streak ends', on:false },
    ]},
  ];

  return (
    <HiPhone dark={dark}>
      <HiStatusBar />

      <div style={{padding:'18px 24px 6px', display:'flex', alignItems:'center', gap:12}}>
        <button style={{background:'transparent', border:0, fontFamily:'var(--font-display)', fontSize:22, color:'var(--ink)', cursor:'pointer', padding:0}}>‹</button>
        <div>
          <div className="hi-num">Settings</div>
          <div className="hi-h2" style={{marginTop:2}}>Notifications</div>
        </div>
      </div>

      <hr className="hi-rule" style={{margin:'12px 24px'}}/>

      <div style={{padding:'0 24px', flex:1, overflow:'hidden', display:'flex', flexDirection:'column', gap:0}}>
        {notifs.map((g, i) => (
          <div key={i} style={{paddingTop:16, paddingBottom:4}}>
            <div className="hi-eyebrow" style={{marginBottom:6}}>{g.group}</div>
            {g.items.map((n, j) => (
              <div key={j} style={{
                display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'12px 0',
                borderBottom:'1px solid var(--hairline)',
              }}>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontFamily:'var(--font-display)', fontSize:16, fontWeight:600}}>{n.label}</div>
                  <div className="hi-meta-sm" style={{marginTop:2}}>{n.sub}</div>
                </div>
                <Switch on={n.on}/>
              </div>
            ))}
          </div>
        ))}
      </div>

      <HiTabBar active="set"/>
    </HiPhone>
  );
}

Object.assign(window, { HiNewCategory, HiTagManagement, HiStats, HiOnboarding1, HiOnboarding2, HiOnboarding3, HiNotifications });
