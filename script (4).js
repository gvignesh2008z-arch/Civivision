  /* ============ CONFIG ============ */
  // Set in config.js. Leave empty to always use the offline in-browser classifier.
  const API_BASE = (window.CIVICVISION_API_BASE || '').replace(/\/$/, '');

  /* ============ DATA ============ */
  const ISSUE_TYPES = [
    { key:'pothole',    match:['pothole','road','crack','asphalt','pavement','pot hole'], label:'Pothole / Road Damage', dept:'Public Works Department', icon:'🚧', base:66 },
    { key:'drainage',   match:['drain','water','flood','sewage','sewer','overflow','clog','stagnant'], label:'Drainage Overflow', dept:'Water & Sewerage Board', icon:'💧', base:70 },
    { key:'garbage',    match:['garbage','trash','waste','dump','litter','rubbish'], label:'Garbage Overflow', dept:'Sanitation Department', icon:'🗑️', base:58 },
    { key:'streetlight',match:['light','lamp','dark','streetlight','electric','wire','pole'], label:'Broken Streetlight', dept:'Electricity Board', icon:'💡', base:48 },
    { key:'general',    match:[], label:'General Infrastructure Issue', dept:'Municipal Corporation', icon:'🏗️', base:42 }
  ];
  const URGENCY_WORDS = ['large','major','severe','dangerous','flooding','collapsed','broken','urgent','huge','deep','overflowing','blocking','accident','unsafe'];

  let reportCount = 247;
  let critical = 18, high = 64, medium = 103;
  let currentAnalysis = null;

  /* ============ MAP DATA ============ */
  const LOCATION_COORDS = {
    'Anna Nagar': [13.0850, 80.2101],
    'T Nagar':    [13.0418, 80.2341],
    'Egmore':     [13.0732, 80.2609],
    'Guindy':     [13.0067, 80.2206]
  };
  const CHENNAI_CENTER = [13.0500, 80.2300];
  const SEED_MARKERS = [
    { icon:'🚧', label:'Pothole', dept:'Public Works Department', loc:'Anna Nagar', priority:'P1', pClass:'p1', score:94 },
    { icon:'💧', label:'Drainage Overflow', dept:'Water & Sewerage Board', loc:'Egmore', priority:'P1', pClass:'p1', score:91 },
    { icon:'🗑️', label:'Garbage Overflow', dept:'Sanitation Department', loc:'Guindy', priority:'P2', pClass:'p2', score:87 },
    { icon:'💡', label:'Broken Streetlight', dept:'Electricity Board', loc:'T Nagar', priority:'P3', pClass:'p3', score:76 }
  ];
  let map, markersLayer;

  /* ============ IMAGE PREVIEW ============ */
  function previewImage(event){
    const file = event.target.files[0];
    const preview = document.getElementById('imagePreview');
    const drop = document.getElementById('fileDrop');
    const label = document.getElementById('fileDropLabel');
    preview.innerHTML = '';
    if(!file) return;
    drop.classList.add('has-file');
    label.textContent = file.name;
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    img.alt = 'Preview of uploaded issue photo';
    preview.appendChild(img);
  }

  function scrollToReport(){
    document.getElementById('report').scrollIntoView({ behavior:'smooth' });
  }

  /* ============ CLASSIFIER ============ */
  function classify(description, location){
    const text = description.toLowerCase();
    let bestType = ISSUE_TYPES[ISSUE_TYPES.length - 1];
    let bestHits = 0;
    for(const type of ISSUE_TYPES){
      const hits = type.match.filter(word => text.includes(word)).length;
      if(hits > bestHits){ bestHits = hits; bestType = type; }
    }

    let score = bestType.base;
    const urgencyHits = URGENCY_WORDS.filter(word => text.includes(word)).length;
    score += urgencyHits * 7;
    score += Math.min(text.length / 20, 10);
    score += bestHits > 1 ? 6 : 0;
    score = Math.max(28, Math.min(99, Math.round(score)));

    let severity, sevClass, priority, pClass;
    if(score >= 85){ severity='Critical'; sevClass='sev-critical'; priority='P1'; pClass='p1'; }
    else if(score >= 68){ severity='High'; sevClass='sev-high'; priority='P2'; pClass='p2'; }
    else if(score >= 50){ severity='Medium'; sevClass='sev-medium'; priority='P3'; pClass='p3'; }
    else { severity='Low'; sevClass='sev-low'; priority='P4'; pClass=''; }

    const locationText = location ? ` in ${location}` : ' at the reported location';
    const urgencyText = urgencyHits > 0
      ? `Language such as "${URGENCY_WORDS.find(w => text.includes(w))}" indicates elevated urgency, `
      : 'No high-urgency language was detected, ';
    const explanation = `Classified as ${bestType.label.toLowerCase()}${locationText} with ${bestHits > 0 ? 'strong' : 'partial'} keyword match. ${urgencyText}placing this report in the ${severity.toLowerCase()} severity band. It has been routed to the ${bestType.dept} for action.`;

    return { type:bestType, score, severity, sevClass, priority, pClass, explanation, location };
  }

  /* ============ BACKEND CALL (falls back to local classify()) ============ */
  async function classifyViaBackend(description, location){
    if(!API_BASE) return classify(description, location);
    try{
      const res = await fetch(`${API_BASE}/api/analyze`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ description, location })
      });
      if(!res.ok) throw new Error(`Backend responded ${res.status}`);
      const data = await res.json();
      // Expected shape matches classify()'s return value.
      return {
        type:{ icon:data.type.icon, label:data.type.label, dept:data.type.dept },
        score:data.score,
        severity:data.severity,
        sevClass:data.sevClass,
        priority:data.priority,
        pClass:data.pClass,
        explanation:data.explanation,
        location:data.location || location
      };
    }catch(err){
      console.warn('Backend analysis unavailable, using offline classifier:', err);
      return classify(description, location);
    }
  }

  /* ============ ANALYZE ============ */
  async function analyzeIssue(){
    const description = document.getElementById('description').value.trim();
    const location = document.getElementById('location').value;
    const hint = document.getElementById('formHint');
    const btn = document.getElementById('analyzeBtn');
    const btnLabel = document.getElementById('analyzeBtnLabel');

    if(description.length < 6){
      hint.textContent = 'Add a short description of the problem to run the analysis.';
      document.getElementById('description').focus();
      return;
    }
    hint.textContent = '';

    btn.classList.add('is-loading');
    btnLabel.innerHTML = 'Analyzing<span class="dot"></span><span class="dot" style="animation-delay:.15s"></span><span class="dot" style="animation-delay:.3s"></span>';

    currentAnalysis = await classifyViaBackend(description, location);
    renderTicket(currentAnalysis);
    btn.classList.remove('is-loading');
    btnLabel.textContent = '🤖 Analyze Issue';

    const resultSection = document.getElementById('result');
    resultSection.classList.remove('hidden');
    resultSection.scrollIntoView({ behavior:'smooth' });
  }

  function renderTicket(a){
    document.getElementById('ticketNum').textContent = 'CV-' + String(100000 + reportCount + Math.floor(Math.random()*900)).slice(-6);
    document.getElementById('detectedIssue').textContent = `${a.type.icon} ${a.type.label}`;
    const sev = document.getElementById('severity');
    sev.textContent = a.severity;
    sev.className = a.sevClass;
    document.getElementById('priority').textContent = `${a.priority} · ${a.score}/100`;
    document.getElementById('department').textContent = a.type.dept;
    document.getElementById('explanation').textContent = a.explanation;

    const ticket = document.getElementById('ticket');
    ticket.style.animation = 'none';
    void ticket.offsetWidth;
    ticket.style.animation = '';
  }

  /* ============ MAP ============ */
  function jitter(coord){
    return [coord[0] + (Math.random() - 0.5) * 0.008, coord[1] + (Math.random() - 0.5) * 0.008];
  }

  function markerIcon(pClass){
    const cls = pClass || 'p3';
    return L.divIcon({
      className:'',
      html:`<div class="civic-marker ${cls}"><div class="ring"></div><div class="core"></div></div>`,
      iconSize:[18,18],
      iconAnchor:[9,9]
    });
  }

  function popupHtml({ icon, label, dept, priority, score }){
    return `<div class="civic-popup">
      <div class="pp-title">${icon} ${label}</div>
      <div class="pp-row"><span>Priority</span><span>${priority}</span></div>
      <div class="pp-row"><span>Score</span><span>${score}/100</span></div>
      <div class="pp-row"><span>Dept</span><span>${dept}</span></div>
    </div>`;
  }

  function plotMarker(report){
    if(!map || !markersLayer) return null;
    const base = LOCATION_COORDS[report.loc] || CHENNAI_CENTER;
    const pos = jitter(base);
    const marker = L.marker(pos, { icon: markerIcon(report.pClass) });
    marker.bindPopup(popupHtml(report));
    marker.addTo(markersLayer);
    return marker;
  }

  function initMap(){
    if(!window.L || !document.getElementById('reportMap')) return;
    map = L.map('reportMap', { scrollWheelZoom:false }).setView(CHENNAI_CENTER, 12);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution:'&copy; OpenStreetMap contributors &copy; CARTO',
      subdomains:'abcd',
      maxZoom:19
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
    SEED_MARKERS.forEach(plotMarker);
  }

  /* ============ SUBMIT ============ */
  function submitComplaint(){
    if(!currentAnalysis) return;
    const a = currentAnalysis;

    reportCount += 1;
    if(a.priority === 'P1') critical += 1;
    else if(a.priority === 'P2') high += 1;
    else medium += 1;

    document.getElementById('totalReports').textContent = reportCount;
    document.getElementById('criticalCount').textContent = critical;
    document.getElementById('highCount').textContent = high;
    document.getElementById('mediumCount').textContent = medium;
    document.getElementById('pulseTotal').textContent = reportCount;

    const list = document.getElementById('priorityList');
    const row = document.createElement('div');
    row.className = 'issue-row new-row';
    row.setAttribute('data-score', a.score);
    const locLabel = a.location ? ` — ${a.location}` : '';
    row.innerHTML = `
      <span>${a.type.icon} ${a.type.label}${locLabel}</span>
      <strong class="${a.pClass}">${a.priority}</strong>
      <div class="score-wrap"><div class="score-bar"><i style="width:0%"></i></div>${a.score}/100</div>
    `;
    list.insertBefore(row, list.children[1]);
    requestAnimationFrame(() => {
      const bar = row.querySelector('.score-bar i');
      if(bar) bar.style.width = a.score + '%';
    });

    plotMarker({ icon:a.type.icon, label:a.type.label, dept:a.type.dept, loc:a.location, priority:a.priority, pClass:a.pClass, score:a.score });
    if(map && a.location && LOCATION_COORDS[a.location]){
      map.flyTo(LOCATION_COORDS[a.location], 14, { duration:1.2 });
    }

    showToast(`Complaint filed — Ticket ${document.getElementById('ticketNum').textContent} routed to ${a.type.dept}.`);

    document.getElementById('description').value = '';
    document.getElementById('location').value = '';
    document.getElementById('imagePreview').innerHTML = '';
    document.getElementById('fileDrop').classList.remove('has-file');
    document.getElementById('fileDropLabel').textContent = 'Tap to choose a photo, or drop it here';
    document.getElementById('issueImage').value = '';
    currentAnalysis = null;
  }

  function showToast(message){
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('show'), 3800);
  }

  /* ============ INIT: animate seed bars on view ============ */
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.score-bar i').forEach(bar => {
      const w = bar.style.width;
      bar.style.width = '0%';
      requestAnimationFrame(() => setTimeout(() => bar.style.width = w, 200));
    });
    initMap();
  });
