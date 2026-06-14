// LifeOS — Premium · Settings
// Shows the appearance / theme toggle.

function HiSettings({ dark }) {
  const sections = [
    {
      eyebrow: '01 — Appearance',
      rows: [
        {
          label: 'Theme',
          value: (
            <div style={{display:'flex', gap:0, border:'1px solid var(--hairline-2)', borderRadius:999, padding:2, background:'transparent'}}>
              {['Light','Dark','Auto'].map(t => {
                const active = dark ? t === 'Dark' : t === 'Light';
                return (
                  <button key={t} className="hi-btn" style={{
                    padding:'5px 12px', borderRadius:999, border:'none',
                    fontSize:11, letterSpacing:'0.14em', textTransform:'uppercase', minWidth:54,
                    background: active ? 'var(--ink)' : 'transparent',
                    color: active ? 'var(--bg)' : 'var(--ink-2)',
                  }}>{t}</button>
                );
              })}
            </div>
          ),
        },
        { label: 'Reduce motion', value: <Switch on={false}/> },
        { label: 'Sound on stop',  value: <Switch on={true}/>  },
      ],
    },
    {
      eyebrow: '02 — Categories & tags',
      rows: [
        { label: 'Categories',   value: <Chevron sub="6 · edit colors & icons"/> },
        { label: 'Tags',         value: <Chevron sub="48 · review usage"/> },
        { label: 'Quick start',  value: <Chevron sub="3 pinned"/> },
      ],
    },
    {
      eyebrow: '03 — Day & week',
      rows: [
        { label: 'Week starts on',    value: <Chevron sub="Monday"/> },
        { label: 'Snap drag to',      value: <Chevron sub="5 min"/> },
      ],
    },
    {
      eyebrow: '04 — Account',
      rows: [
        { label: 'iCloud sync',      value: <Chevron sub="On · vivek@…"/> },
        { label: 'Export data',      value: <Chevron sub="CSV · JSON"/> },
      ],
    },
  ];

  return (
    <HiPhone dark={dark}>
      <HiStatusBar />

      <div style={{padding:'18px 24px 6px'}}>
        <div className="hi-num">Preferences</div>
        <div className="hi-h1" style={{marginTop:6}}>Settings</div>
      </div>

      <hr className="hi-rule" style={{margin:'14px 24px'}}/>

      <div style={{padding:'4px 24px 12px', flex:1, overflow:'hidden', display:'flex', flexDirection:'column', gap:0}}>
        {sections.map((s, i) => (
          <div key={i} style={{paddingTop:18, paddingBottom: i === sections.length-1 ? 0 : 6}}>
            <div className="hi-eyebrow" style={{marginBottom:8}}>{s.eyebrow}</div>
            {s.rows.map((r, j) => (
              <div key={j} style={{
                display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'12px 0',
                borderBottom: j === s.rows.length-1 && i === sections.length-1 ? 'none' : '1px solid var(--hairline)',
              }}>
                <div style={{fontFamily:'var(--font-display)', fontSize:16, fontWeight:500, color:'var(--ink)'}}>{r.label}</div>
                {r.value}
              </div>
            ))}
          </div>
        ))}
      </div>

      <HiTabBar active="set"/>
    </HiPhone>
  );
}

// little helpers
function Switch({ on }) {
  return (
    <div style={{
      width:36, height:20, borderRadius:999,
      background: on ? 'var(--ink)' : 'transparent',
      border: '1px solid ' + (on ? 'var(--ink)' : 'var(--hairline-2)'),
      position:'relative', transition:'all 0.2s',
    }}>
      <div style={{
        position:'absolute', top:1, left: on ? 16 : 1,
        width:16, height:16, borderRadius:50,
        background: on ? 'var(--bg)' : 'var(--ink-3)',
      }}/>
    </div>
  );
}

function Chevron({ sub }) {
  return (
    <div style={{display:'flex', alignItems:'center', gap:10}}>
      {sub && <span className="hi-meta-sm" style={{fontSize:11.5, letterSpacing:'0.02em'}}>{sub}</span>}
      <span style={{color:'var(--ink-4)', fontFamily:'var(--font-display)', fontSize:18, lineHeight:1}}>›</span>
    </div>
  );
}

Object.assign(window, { HiSettings });
