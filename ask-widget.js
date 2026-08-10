/* San Mateo Local — "Ask a Local" floating chat widget.
   Drop-in launcher (bottom-right) that talks to /api/concierge, the same grounded
   guide as /ask. Include on CONSUMER/guide pages only, NOT the business pages
   (those get the GHL lead-capture chat). Usage: <script src="/ask-widget.js" defer></script> */
(function () {
  if (window.__smlAsk) return; window.__smlAsk = true;

  var API = '/api/concierge';
  var messages = [], userCoords = null, busy = false, greeted = false;
  var SM = { latMin: 37.50, latMax: 37.61, lngMin: -122.40, lngMax: -122.24 };

  var css =
  '.smlw *{box-sizing:border-box}' +
  '.smlw-launch{position:fixed;right:20px;bottom:20px;z-index:2147483000;width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;background:#221D16;color:#fff;box-shadow:0 8px 24px -6px rgba(34,29,22,.55);display:flex;align-items:center;justify-content:center;transition:transform .15s}' +
  '.smlw-launch:hover{transform:scale(1.06)}' +
  '.smlw-launch svg{width:28px;height:28px}' +
  '.smlw-launch .smlw-dot{position:absolute;top:-2px;right:-2px;width:14px;height:14px;background:#C25B3A;border:2px solid #fff;border-radius:50%}' +
  '.smlw-panel{position:fixed;right:20px;bottom:20px;z-index:2147483001;width:376px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 40px);background:#FAF6EC;border:1.5px solid #221D16;border-radius:16px;box-shadow:0 18px 50px -12px rgba(34,29,22,.5);display:none;flex-direction:column;overflow:hidden;font-family:Inter,system-ui,-apple-system,sans-serif}' +
  '.smlw-panel.open{display:flex}' +
  '.smlw-head{background:#221D16;color:#fff;padding:.85rem 1rem;display:flex;align-items:center;justify-content:space-between;flex:none}' +
  '.smlw-head b{font-family:Fraunces,Georgia,serif;font-size:1.05rem;font-weight:600}' +
  '.smlw-head .smlw-x{background:none;border:none;color:#fff;cursor:pointer;font-size:1.25rem;line-height:1;opacity:.85;padding:.1rem .3rem}' +
  '.smlw-head .smlw-x:hover{opacity:1}' +
  '.smlw-msgs{flex:1;overflow-y:auto;padding:1rem;display:flex;flex-direction:column;gap:.7rem;background:#FAF6EC}' +
  '.smlw-b{max-width:88%;padding:.65rem .85rem;border-radius:14px;font-size:.95rem;line-height:1.5;white-space:normal;word-wrap:break-word}' +
  '.smlw-b.bot{background:#F2E9D4;color:#221D16;border-bottom-left-radius:4px;align-self:flex-start}' +
  '.smlw-b.me{background:#C25B3A;color:#fff;border-bottom-right-radius:4px;align-self:flex-end}' +
  '.smlw-b a{color:inherit;font-weight:600}' +
  '.smlw-b.bot a{color:#A5492B}' +
  '.smlw-typing{align-self:flex-start;color:#5E5446;font-size:.9rem;font-style:italic;padding:.2rem .3rem}' +
  '.smlw-foot{flex:none;border-top:1.5px solid #E3D6BC;background:#FAF6EC;padding:.6rem .7rem;padding-bottom:calc(.6rem + env(safe-area-inset-bottom))}' +
  '.smlw-locrow{display:flex;justify-content:center;margin-bottom:.5rem}' +
  '.smlw-loc{background:#FFFDF7;border:1.5px solid #E3D6BC;border-radius:999px;padding:.35rem .8rem;font:inherit;font-size:.8rem;font-weight:600;color:#5E5446;cursor:pointer}' +
  '.smlw-loc:hover{border-color:#C25B3A;color:#221D16}.smlw-loc.on{background:#C25B3A;border-color:#C25B3A;color:#fff}.smlw-loc:disabled{opacity:.6}' +
  '.smlw-form{display:flex;gap:.4rem;align-items:center}' +
  '.smlw-in{flex:1;min-width:0;border:1.5px solid #E3D6BC;border-radius:999px;padding:.65rem .9rem;font:inherit;font-size:.95rem;background:#fff;color:#221D16}' +
  '.smlw-in:focus{outline:2px solid #C25B3A;border-color:transparent}' +
  '.smlw-go{flex:none;background:#C25B3A;color:#fff;border:none;border-radius:999px;width:40px;height:40px;cursor:pointer;font-size:1.1rem;display:flex;align-items:center;justify-content:center}' +
  '.smlw-go:hover{background:#A5492B}.smlw-go:disabled{opacity:.55}' +
  '.smlw-pb{font-size:.68rem;color:#5E5446;text-align:center;margin-top:.45rem}' +
  '@media (max-width:520px){.smlw-panel{right:0;bottom:0;width:100vw;max-width:100vw;height:100dvh;max-height:100dvh;border-radius:0;border:none}.smlw-launch{right:16px;bottom:16px}}';

  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  var root = document.createElement('div'); root.className = 'smlw';
  root.innerHTML =
    '<button class="smlw-launch" aria-label="Ask a Local, the San Mateo guide"><span class="smlw-dot"></span>' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8 8.38 8.38 0 0 1 8.5-8.5 8.5 8.5 0 0 1 8.5 8.5z"/></svg></button>' +
    '<div class="smlw-panel" role="dialog" aria-label="Ask a Local">' +
      '<div class="smlw-head"><b>Ask a Local</b><button class="smlw-x" aria-label="Close">&#10005;</button></div>' +
      '<div class="smlw-msgs"></div>' +
      '<div class="smlw-foot">' +
        '<div class="smlw-locrow"><button type="button" class="smlw-loc">&#128205; Use my location</button></div>' +
        '<form class="smlw-form"><input class="smlw-in" type="text" placeholder="e.g. tacos near me, or a plumber" autocomplete="off" /><button class="smlw-go" type="submit" aria-label="Send">&#8593;</button></form>' +
        '<div class="smlw-pb">Real local picks from San Mateo Local</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(root);

  var launch = root.querySelector('.smlw-launch');
  var panel = root.querySelector('.smlw-panel');
  var msgs = root.querySelector('.smlw-msgs');
  var form = root.querySelector('.smlw-form');
  var input = root.querySelector('.smlw-in');
  var go = root.querySelector('.smlw-go');
  var locBtn = root.querySelector('.smlw-loc');
  var closeBtn = root.querySelector('.smlw-x');

  function esc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function render(t){
    var h = esc(t);
    h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    return h.replace(/\n/g, '<br>');
  }
  function bubble(role, text){
    var d = document.createElement('div');
    d.className = 'smlw-b ' + (role === 'me' ? 'me' : 'bot');
    d.innerHTML = render(text);
    msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight;
    return d;
  }
  function open(){
    panel.classList.add('open'); launch.style.display = 'none';
    if (!greeted){ greeted = true; bubble('bot', "Hi! I'm your San Mateo Local guide. Tell me what you need, a place to eat, a local service, or something to do, and I'll point you to the closest real spot."); }
    setTimeout(function(){ input.focus(); }, 60);
  }
  function close(){ panel.classList.remove('open'); launch.style.display = 'flex'; }
  launch.addEventListener('click', open);
  closeBtn.addEventListener('click', close);

  function ask(text){
    text = (text || '').trim();
    if (busy || !text) return;
    busy = true; go.disabled = true;
    bubble('me', text);
    messages.push({ role: 'user', content: text });
    var typing = document.createElement('div'); typing.className = 'smlw-typing'; typing.textContent = 'Looking...';
    msgs.appendChild(typing); msgs.scrollTop = msgs.scrollHeight;
    fetch(API, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ messages: messages, coords: userCoords }) })
      .then(function(r){ return r.json(); })
      .then(function(data){
        typing.remove();
        var reply = data.reply || data.error || "Sorry, I had trouble there. Try again.";
        bubble('bot', reply);
        if (data.reply) messages.push({ role: 'assistant', content: data.reply });
      })
      .catch(function(){ typing.remove(); bubble('bot', "Sorry, I couldn't reach the guide just now. Try again in a moment."); })
      .then(function(){ busy = false; go.disabled = false; });
  }
  form.addEventListener('submit', function(e){ e.preventDefault(); var t = input.value; input.value = ''; ask(t); });

  locBtn.addEventListener('click', function(){
    if (userCoords){ userCoords = null; locBtn.classList.remove('on'); locBtn.innerHTML = '&#128205; Use my location'; return; }
    if (!navigator.geolocation){ bubble('bot', "Your browser can't share location. Just tell me a cross street or neighborhood."); return; }
    locBtn.disabled = true; locBtn.innerHTML = '&#128205; Locating...';
    navigator.geolocation.getCurrentPosition(function(pos){
      locBtn.disabled = false;
      var la = pos.coords.latitude, ln = pos.coords.longitude;
      if (la < SM.latMin || la > SM.latMax || ln < SM.lngMin || ln > SM.lngMax){
        locBtn.innerHTML = '&#128205; Use my location';
        bubble('bot', "Looks like you're outside San Mateo. Tell me a neighborhood here and I'll help.");
        return;
      }
      userCoords = { lat: la, lng: ln };
      locBtn.classList.add('on'); locBtn.innerHTML = '&#128205; Using your location';
      bubble('bot', "Got it, I'll use your location to find the closest spots. What are you looking for?");
    }, function(){
      locBtn.disabled = false; locBtn.innerHTML = '&#128205; Use my location';
      bubble('bot', "No problem. Just tell me a cross street or neighborhood.");
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });
})();
