document.addEventListener('DOMContentLoaded', () => {
  // ====== Canvas setup ======
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  function setCanvasSize(){
    const maxWidth = 900, aspect = 16/9;
    const cssW = Math.min(maxWidth, canvas.parentElement.clientWidth);
    const cssH = cssW / aspect;
    canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW);  canvas.height = Math.round(cssH);
  }
  window.addEventListener('resize', setCanvasSize); setCanvasSize();
  const ro = new ResizeObserver(() => setCanvasSize());
  ro.observe(document.getElementById('gameContainer'));

  // ====== Colors from CSS ======
  const cssVar = (n)=>getComputedStyle(document.documentElement).getPropertyValue(n).trim()||'#000';
  const BASE_COLOR = { player:cssVar('--player'), obstacle:cssVar('--obstacle'), coin:cssVar('--coin'), ground:cssVar('--ground') };

  // ====== Themes ======
  const THEMES = [
    { name:'Kota', sky:'#8ed0ff', ground:'#27ae60', obstacle:'#c0392b', mountain:'#5ba3d4' },
    { name:'Hutan', sky:'#b8e2c8', ground:'#2f855a', obstacle:'#2b6f3a', mountain:'#7dcfa6' },
    { name:'Gurun', sky:'#ffe4a3', ground:'#d4a373', obstacle:'#9c6644', mountain:'#f1c27d' },
  ];
  let themeIndex = 0;
  function currentTheme(){ return THEMES[themeIndex]; }

  // ====== Simple Web Audio (beeps) ======
  let audioCtx=null, soundOn=true;
  function ensureAudio(){ if(!audioCtx){ try{ audioCtx=new (window.AudioContext||window.webkitAudioContext)(); }catch{} } }
  function beep(freq=440, dur=0.08, type='sine', vol=0.2){
    if(!soundOn) return;
    ensureAudio(); if(!audioCtx) return;
    const o=audioCtx.createOscillator(), g=audioCtx.createGain();
    o.type=type; o.frequency.value=freq;
    g.gain.value=vol; o.connect(g); g.connect(audioCtx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.stop(audioCtx.currentTime + dur + 0.01);
  }

  // ====== UI elements ======
  const screens = { mainMenu:byId('mainMenu'), game:byId('gameContainer'), gameOver:byId('gameOverScreen'), leaderboard:byId('leaderboardScreen') };
  const playerNameInput = byId('playerNameInput');
  const startButton = byId('startButton'); const leaderboardButton=byId('leaderboardButton'); const backToMenuFromLB=byId('backToMenuFromLB');
  const restartButton=byId('restartButton'); const saveScoreButton=byId('saveScoreButton'); const resetLeaderboardButton=byId('resetLeaderboardButton');
  const jumpButton=byId('jumpButton'); const scoreDisplay=byId('scoreDisplay'); const coinsDisplay=byId('coinsDisplay'); const finalScoreDisplay=byId('finalScore'); const leaderboardBody=byId('leaderboardBody');
  const btnPause=byId('btnPause'), btnTheme=byId('btnTheme'), btnSound=byId('btnSound'), btnDebug=byId('btnDebug');

  // ====== Game state ======
  let player, gravity, speedPxPerSec, gameSpeed, score, coinsCount, obstacles, coins, raf, isGameOver, lastTime, spawnElapsed, spawnInterval;
  let paused=false, showDebug=false;
  const MIN_INTERVAL = 0.55;

  // ====== Player with simple running animation ======
  class Player{
    constructor(x,y,w,h,c){ this.x=x; this.y=y; this.w=w; this.h=h; this.c=c; this.dy=0; this.jumpForce=16; this.grounded=false; this.animT=0; }
    draw(){
      // Body
      ctx.fillStyle=this.c;
      ctx.fillRect(this.x, this.y, this.w, this.h);
      // Head
      ctx.fillStyle='#fff';
      ctx.fillRect(this.x+this.w*0.15, this.y-12, this.w*0.7, 12);
      // Legs (simple run cycle)
      const t = (this.animT%0.3)/0.3; // 0..1
      const legOffset = (t<0.5? t : 1-t)*8; // ping-pong
      ctx.fillStyle=this.c;
      ctx.fillRect(this.x+4, this.y+this.h, 6, 12+legOffset);
      ctx.fillRect(this.x+this.w-10, this.y+this.h, 6, 12+(8-legOffset));
    }
    jump(){ if(this.grounded){ this.dy=-this.jumpForce; this.grounded=false; beep(600,0.06,'triangle',0.25); } }
    update(dt){
      this.dy += gravity;
      this.y += this.dy;
      this.animT += dt;
      const gy = canvas.height - this.h - 22;
      if(this.y>gy){ this.y=gy; this.dy=0; this.grounded=true; }
      this.draw();
    }
  }

  class Obstacle{ constructor(x,y,w,h,c){ this.x=x; this.y=y; this.w=w; this.h=h; this.c=c; } update(){ this.x -= gameSpeed; this.draw(); } draw(){ ctx.fillStyle=this.c; ctx.fillRect(this.x,this.y,this.w,this.h); } }
  class Coin{ constructor(x,y,r,c){ this.x=x; this.y=y; this.r=r; this.c=c; } update(){ this.x -= gameSpeed; this.draw(); } draw(){ ctx.beginPath(); ctx.arc(this.x,this.y,this.r,0,Math.PI*2); ctx.fillStyle=this.c; ctx.fill(); } }

  // ====== Core functions ======
  function init(){
    isGameOver=false; paused=false; lastTime=0;
    score=0; coinsCount=0; gravity=0.8; speedPxPerSec=240; gameSpeed=0; spawnElapsed=0; spawnInterval=1.2;
    obstacles=[]; coins=[];
    player=new Player(50,0,40,50, BASE_COLOR.player);
    updateHUD(); saveScoreButton.disabled=false;
  }

  function drawBackground(){
    const th = currentTheme();
    // Sky
    ctx.fillStyle = th.sky; ctx.fillRect(0,0,canvas.width,canvas.height);
    // Mountains (parallax)
    ctx.fillStyle = th.mountain;
    for(let i=0;i<3;i++){
      const base = (i*200 + (score%200))% (canvas.width+200) - 200;
      ctx.beginPath();
      ctx.moveTo(base, canvas.height-40);
      ctx.lineTo(base+120, canvas.height-140);
      ctx.lineTo(base+240, canvas.height-40);
      ctx.closePath();
      ctx.fill();
    }
    // Ground
    ctx.fillStyle = th.ground;
    ctx.fillRect(0, canvas.height-20, canvas.width, 20);
  }

  function gameLoop(ts){
    if(isGameOver) return;
    raf = requestAnimationFrame(gameLoop);
    if(!lastTime) lastTime = ts;
    let dt = Math.min(0.05, (ts - lastTime)/1000);
    lastTime = ts;
    if(paused){ drawBackground(); // still render bg
      updateHUD();
      return;
    }

    ctx.clearRect(0,0,canvas.width,canvas.height);
    drawBackground();

    player.update(dt);
    handleObstacles();
    handleCoins();
    spawnManager(dt);

    score += Math.floor(60 * dt);
    speedPxPerSec += 4 * dt;
    gameSpeed = speedPxPerSec * dt;

    if(showDebug){
      ctx.fillStyle='#000a'; ctx.fillRect(8,8,170,58);
      ctx.fillStyle='#fff'; ctx.font='12px system-ui'; 
      ctx.fillText(`dt: ${dt.toFixed(3)}  spd: ${gameSpeed.toFixed(2)}`, 16, 28);
      ctx.fillText(`obs: ${obstacles.length} coin: ${coins.length}`, 16, 46);
    }

    updateHUD();
  }

  function spawnManager(dt){
    spawnElapsed += dt;
    while(spawnElapsed >= spawnInterval){
      spawnElapsed -= spawnInterval;
      spawnObstacle();
      if(Math.random() < 0.55) spawnCoin();
      spawnInterval = Math.max(MIN_INTERVAL, spawnInterval * 0.992);
    }
  }

  function spawnObstacle(){
    const th = currentTheme();
    const h = Math.random()*50 + 40;
    const w = Math.random()*24 + 30;
    obstacles.push(new Obstacle(canvas.width+16, canvas.height-h-20, w, h, th.obstacle));
  }
  function spawnCoin(){
    const y = canvas.height - (Math.random()*120 + 80);
    coins.push(new Coin(canvas.width+16, y, 14, BASE_COLOR.coin));
  }

  function handleObstacles(){
    for(let i=obstacles.length-1;i>=0;i--){
      const o = obstacles[i];
      o.update();
      if(collides(player,o)){ beep(220,0.15,'sawtooth',0.25); endGame(); return; }
      if(o.x + o.w < 0) obstacles.splice(i,1);
    }
  }
  function handleCoins(){
    for(let i=coins.length-1;i>=0;i--){
      const c = coins[i];
      c.update();
      const px = player.x + player.w/2, py = player.y + player.h/2;
      const d = Math.hypot(px - c.x, py - c.y);
      if(d < Math.max(player.w,player.h)/2 + c.r){ coinsCount++; coins.splice(i,1); beep(880,0.06,'square',0.18); continue; }
      if(c.x + c.r < 0) coins.splice(i,1);
    }
  }
  function collides(a,b){ return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

  // ====== UI & state ======
  function showScreen(n){ Object.values(screens).forEach(s=>s.classList.remove('active')); screens[n].classList.add('active'); }
  function startGame(){
    const nm = (playerNameInput.value || 'Pemain').trim() || 'Pemain';
    playerNameInput.value = nm; localStorage.setItem('runnerName', nm);
    ensureAudio(); // unlock context
    themeIndex = Number(localStorage.getItem('runnerTheme')||0);
    showScreen('game'); setCanvasSize(); init(); raf=requestAnimationFrame(gameLoop);
  }
  function endGame(){ isGameOver=true; cancelAnimationFrame(raf); const final=score+coinsCount*10; finalScoreDisplay.textContent=final; showScreen('gameOver'); }
  function updateHUD(){ scoreDisplay.textContent=`Skor: ${score}`; coinsDisplay.textContent=`Koin: ${coinsCount}`; }

  // ====== Leaderboard ======
  function getLeaderboard(){ return JSON.parse(localStorage.getItem('runnerLeaderboard')||'[]'); }
  function saveScore(){
    const final = score + coinsCount*10;
    const name = localStorage.getItem('runnerName') || (playerNameInput.value || 'Pemain');
    const lb = getLeaderboard(); lb.push({name, score:final, date:new Date().toLocaleString('id-ID')});
    lb.sort((a,b)=>b.score-a.score);
    localStorage.setItem('runnerLeaderboard', JSON.stringify(lb.slice(0,10)));
    saveScoreButton.disabled = true; alert('Skor tersimpan!');
  }
  function renderLeaderboard(){
    const lb=getLeaderboard();
    leaderboardBody.innerHTML = lb.length ? '' : '<tr><td colspan="4">Belum ada skor.</td></tr>';
    lb.forEach((e,i)=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${i+1}</td><td>${e.name}</td><td>${e.score}</td><td>${e.date}</td>`; leaderboardBody.appendChild(tr);});
    showScreen('leaderboard');
  }
  function resetLeaderboard(){ if(confirm('Reset semua skor?')){ localStorage.removeItem('runnerLeaderboard'); renderLeaderboard(); } }

  // ====== Buttons ======
  startButton.addEventListener('click', startGame);
  restartButton.addEventListener('click', startGame);
  leaderboardButton.addEventListener('click', renderLeaderboard);
  byId('leaderboardBackButton').addEventListener('click', ()=>showScreen('mainMenu'));
  resetLeaderboardButton.addEventListener('click', resetLeaderboard);
  byId('backToMenuFromLB').addEventListener('click', ()=>showScreen('mainMenu'));
  jumpButton.addEventListener('click', ()=> player && player.jump());

  // Pause / Theme / Sound / Debug
  btnPause.addEventListener('click', ()=>{ paused=!paused; btnPause.textContent = paused ? '▶' : '⏸'; });
  btnTheme.addEventListener('click', ()=>{ themeIndex=(themeIndex+1)%THEMES.length; localStorage.setItem('runnerTheme', themeIndex); });
  btnSound.addEventListener('click', ()=>{ soundOn=!soundOn; btnSound.textContent = soundOn ? '🔊' : '🔈'; });
  btnDebug.addEventListener('click', ()=>{ showDebug=!showDebug; });

  // Keyboard
  function onKey(e){
    if(e.code==='Space'||e.code==='ArrowUp'){ e.preventDefault(); player && player.jump(); }
    if(e.code==='KeyP'){ paused=!paused; btnPause.textContent = paused ? '▶' : '⏸'; }
    if(e.code==='KeyD'){ showDebug=!showDebug; }
  }
  document.addEventListener('keydown', onKey);

  // Load saved name
  const saved = localStorage.getItem('runnerName'); if(saved) playerNameInput.value=saved;

  function byId(id){ return document.getElementById(id); }
  function currentTheme(){ return THEMES[themeIndex]; }
});
