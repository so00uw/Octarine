(() => {
  const SCREENS = ["start", "consent", "scan", "analyze", "result"];

  const els = {
    topbar: document.getElementById("topbar"),
    bgVideo: document.getElementById("bgVideo"),
    btnStart: document.getElementById("btnStart"),
    btnToScan: document.getElementById("btnToScan"),
    btnRestart: document.getElementById("btnRestart"),
    btnRestartFinal: document.getElementById("btnRestartFinal"),
    consentChecks: Array.from(document.querySelectorAll("input.consent")),
    stepIcons: {
      consent: document.getElementById("step-consent"),
      scan: document.getElementById("step-scan"),
      analyze: document.getElementById("step-analyze"),
      result: document.getElementById("step-result"),
    },
    screens: Object.fromEntries(
      SCREENS.map((k) => [k, document.querySelector(`[data-screen="${k}"]`)])
    ),
  };

  // ---- Step icon opacity rules ----
  // One icon is darker by original image -> we give it 0.5, others 0.4
  // (We don't auto-detect darkness; we hard-assign to "result" as the 0.5 one by default.
  //  If your darker asset is different, change DARK_ICON_KEY.)
  const DARK_ICON_KEY = "result";
  const DIM = 0.40;
  const DIM_DARK = 0.50;

  // ---- Projection window reuse ----
  const PROJECTION_NAME = "EXHIBITION_PROJECTION";
  let projectionWin = null;

  function ensureProjectionWindow() {
    // Try reuse existing named window
    try {
      projectionWin = window.open("projection.html", PROJECTION_NAME, "width=320,height=180,left=20,top=20");
    } catch (e) {
      projectionWin = null;
    }
    // If blocked, we will open it on user gesture (Start click) as fallback.
    return projectionWin;
  }

  function postToProjection(type, payload = {}) {
    if (!projectionWin || projectionWin.closed) return;
    projectionWin.postMessage({ type, payload }, "*");
  }

  // ---- SPA navigation ----
  function setScreen(next) {
    if (!SCREENS.includes(next)) return;

    for (const k of SCREENS) {
      els.screens[k].classList.toggle("is-active", k === next);
    }

    // Start screen: topbar still exists but you wanted icons from consent step
    // We'll keep topbar visible always, but dim icons appropriately.
    updateStepIcons(next);

    document.body.dataset.screen = next;
    

    // When entering start, try ensure projection window (won't reopen multiple tabs because name fixed)
    if (next === "start") {
      resetConsent();
      ensureProjectionWindow();
      postToProjection("CLEAR"); // keep black
    }
    // scan 화면 들어가면 카메라 시작, 나가면 중지
if (next === "scan") startScan();
else stopScan();

if (next === "analyze") startAnalyze();
else stopAnalyze();

if(next==="result") renderResult();


  }

  function updateStepIcons(screen) {
    // Icons should be meaningful from consent to result. On start, keep them dim.
    const activeKey =
      screen === "consent" ? "consent" :
      screen === "scan" ? "scan" :
      screen === "analyze" ? "analyze" :
      screen === "result" ? "result" : null;

    for (const [key, img] of Object.entries(els.stepIcons)) {
      if (!img) continue;
      if (activeKey === key) {
        img.style.opacity = "1";
      } else {
        img.style.opacity = (key === DARK_ICON_KEY ? String(DIM_DARK) : String(DIM));
      }
    }
  }

  // ---- Consent button enable ----
  function updateConsentButton() {
    const ok = els.consentChecks.every((c) => c.checked);
    els.btnToScan.disabled = !ok;
  }
  function resetConsent() {
  els.consentChecks.forEach(c => (c.checked = false));
  updateConsentButton(); // 버튼 disabled 상태도 같이 갱신
}

// =========================
// Scan (Camera + FaceMesh) lifecycle
// =========================
let scanStarted = false;
let faceMesh = null;
let camera = null;
let lastLandmarks = null;
let stableFrames = 0;
let capturedImageDataUrl = null;
let capturedLandmarks = null;


const SCAN = {
  camW: 805,
  camH: 672,
  snapW: 1600,
  snapH: 1336,
  stableNeed: 10,
  // guide frame (absolute on page) -> camera-box relative
  guideAbs: { left: 815, top: 351, width: 289, height: 301 },
  camAbs: { left: 558, top: 191 }
};

function getScanEls() {
  return {
    video: document.getElementById("video"),
    overlay: document.getElementById("overlay"),
    hint: document.getElementById("scanHint"),
    btn: document.getElementById("btnCapture")
  };
}

function setCaptureState(active, msg) {
  const { btn, hint } = getScanEls();
  if (!btn || !hint) return;

  if (active) {
    btn.disabled = false;
    btn.classList.add("active");
    hint.textContent = "촬영 가능";
  } else {
    btn.disabled = true;
    btn.classList.remove("active");
    hint.textContent = msg || "얼굴을 네모 안에 맞춰줘";
  }
}

async function startScan() {
  if (scanStarted) return;
  scanStarted = true;

  const { video, overlay, btn } = getScanEls();
  if (!video || !overlay || !btn) {
    console.error("[SCAN] elements missing. Check screen-scan HTML.");
    return;
  }

  // overlay는 고정 크기(시안 기준)로 쓰는 게 안정적
  overlay.width = SCAN.camW;
  overlay.height = SCAN.camH;

  stableFrames = 0;
  lastLandmarks = null;
  setCaptureState(false, "얼굴을 네모 안에 맞춰줘");

  // FaceMesh init (once)
  if (!faceMesh) {
    faceMesh = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
    faceMesh.onResults(onFaceResults);
  }

  // Camera init (once)
  if (!camera) {
    camera = new Camera(video, {
      onFrame: async () => {
        await faceMesh.send({ image: video });
      },
      width: SCAN.camW,
      height: SCAN.camH
    });
  }

  try {
    await camera.start();
  } catch (e) {
    console.error("[SCAN] camera start failed:", e);
    setCaptureState(false, "카메라 권한을 허용해줘");
  }

  // capture click (중복 바인딩 방지)
  if (!btn.dataset.bound) {
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      if (!lastLandmarks) return;

      // 스냅샷(저장 X, 메모리용 DataURL)
      const temp = document.createElement("canvas");
      temp.width = SCAN.snapW;
      temp.height = SCAN.snapH;
      const tctx = temp.getContext("2d");
      tctx.drawImage(video, 0, 0, SCAN.snapW, SCAN.snapH);
capturedLandmarks = (window.structuredClone)
  ? structuredClone(lastLandmarks)
  : JSON.parse(JSON.stringify(lastLandmarks));

      capturedImageDataUrl = temp.toDataURL("image/png");
      // 다음 스텝에서 analyze/result에 이 이미지를 쓸 거야.
      setScreen("analyze");
    });
  }
}

function stopScan() {
  // MediaPipe Camera는 stop()이 버전에 따라 없을 수 있어.
  // 그래서 "scanStarted"만 내리고, onResults가 더 와도 무시하도록 처리.
  scanStarted = false;
  stableFrames = 0;
  lastLandmarks = null;
  setCaptureState(false, "");
}

function onFaceResults(results) {
  if (!scanStarted) return;

  const { overlay } = getScanEls();
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  const faces = results.multiFaceLandmarks || [];
  if (faces.length === 0) {
    stableFrames = 0;
    setCaptureState(false, "얼굴을 인식하지 못함");
    return;
  }

  const lm = faces[0];
  lastLandmarks = lm;

  // 얼굴 bbox in normalized coords
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const p of lm) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const faceW = (maxX - minX) * SCAN.camW;
  const cx = ((minX + maxX) / 2) * SCAN.camW;
  const cy = ((minY + maxY) / 2) * SCAN.camH;

  // guide frame relative to camera box
  const guide = {
    left: SCAN.guideAbs.left - SCAN.camAbs.left,
    top: SCAN.guideAbs.top - SCAN.camAbs.top,
    width: SCAN.guideAbs.width,
    height: SCAN.guideAbs.height
  };

  const inside =
    cx > guide.left &&
    cx < guide.left + guide.width &&
    cy > guide.top &&
    cy < guide.top + guide.height;

  const tooSmall = faceW < guide.width * 0.40;
  const tooBig = faceW > guide.width * 0.75;
  const sizeOK = !tooSmall && !tooBig;

  if (inside && sizeOK) stableFrames++;
  else stableFrames = 0;

  if (stableFrames >= SCAN.stableNeed) {
    setCaptureState(true, "");
  } else {
    if (!inside) setCaptureState(false, "얼굴을 네모 안에 맞춰줘");
    else if (tooSmall) setCaptureState(false, "더 가까이 와!");
    else if (tooBig) setCaptureState(false, "멀어져라");
    else setCaptureState(false, "잠시만 고정해줘");
  }
}
// =========================
// Analyze (5s scan line + logs) lifecycle
// =========================
let analyzeTimer = null;
let analyzeRAF = null;

function getAnalyzeEls(){
  return {
    photo: document.getElementById("analyzePhoto"),
    line: document.getElementById("scanLine"),
    clean: document.getElementById("logClean"),
    integ: document.getElementById("logInteg"),
    diagn: document.getElementById("logDiagn"),
  };
}

function makeLogLine(){
  // 읽히는 게 목적이 아니라 "시스템 느낌"이 목표
  const tokens = [
    "0x" + Math.floor(Math.random()*0xffffff).toString(16).padStart(6,"0"),
    Math.random().toString(16).slice(2, 10),
    "IDX:" + Math.floor(Math.random()*9999).toString().padStart(4,"0"),
    "Z=" + (Math.random()*4-2).toFixed(3),
    "Δ=" + (Math.random()*1.2).toFixed(4),
    "RMS=" + (Math.random()*0.9).toFixed(4),
    "N=" + (200 + Math.floor(Math.random()*800)),
  ];
  const pick = [];
  const n = 3 + Math.floor(Math.random()*3);
  for(let i=0;i<n;i++){
    pick.push(tokens[Math.floor(Math.random()*tokens.length)]);
  }
  return pick.join("  ");
}

function fillLogStream(el, linesCount){
  if(!el) return;
  const lines = [];
  for(let i=0;i<linesCount;i++){
    lines.push(makeLogLine());
  }
  el.textContent = lines.join("\n");
}

function startAnalyze(){
  const { photo, line, clean, integ, diagn } = getAnalyzeEls();
  if (!photo || !line) return;

  // 촬영 이미지가 없으면(예외) 그냥 결과로 넘기지 않고 start로 리셋하는 게 안전하지만,
  // 지금은 analyze가 scan 후에만 오도록 되어있으니 기본은 그대로 진행.
  if (!capturedImageDataUrl) {
    // 안전 fallback
    setScreen("start");
    return;
  }

  // 이미지 세팅
  photo.src = capturedImageDataUrl;
  photo.style.display = "block";

  // 로그 채우기 (박스마다 밀도 조금 다르게)
  fillLogStream(clean, 90);
  fillLogStream(integ, 110);
  fillLogStream(diagn, 220);

  // 로그 스크롤 초기화
  const logScroll = {
    t0: performance.now(),
    speedA: 90,   // px/s (좌상)
    speedB: 110,  // px/s (좌하)
    speedC: 140,  // px/s (우측)
  };

  function step(now){
    const dt = (now - logScroll.t0) / 1000;
    if (clean) clean.style.transform = `translateY(${-dt*logScroll.speedA}px)`;
    if (integ) integ.style.transform = `translateY(${-dt*logScroll.speedB}px)`;
    if (diagn) diagn.style.transform = `translateY(${-dt*logScroll.speedC}px)`;
    analyzeRAF = requestAnimationFrame(step);
  }

  // 스캔 라인 5초 애니메이션 시작
  line.style.display = "block";
  line.style.transition = "none";
  line.style.transform = "translateY(-10px)";
  // 다음 프레임에 transition 적용
  requestAnimationFrame(() => {
    line.style.transition = "transform 5s linear";
    line.style.transform = `translateY(${672 + 10}px)`; // camera-box 높이(672) + 여유
  });

  // 로그 스크롤 시작
  if (analyzeRAF) cancelAnimationFrame(analyzeRAF);
  logScroll.t0 = performance.now();
  analyzeRAF = requestAnimationFrame(step);

  // 5초 후 자동으로 result로 이동
  if (analyzeTimer) clearTimeout(analyzeTimer);
  analyzeTimer = setTimeout(() => {
    setScreen("result");
  }, 5000);
}

function stopAnalyze(){
  const { line } = getAnalyzeEls();

  if (analyzeTimer) {
    clearTimeout(analyzeTimer);
    analyzeTimer = null;
  }
  if (analyzeRAF) {
    cancelAnimationFrame(analyzeRAF);
    analyzeRAF = null;
  }
  if (line) {
    line.style.display = "none";
    line.style.transition = "none";
    line.style.transform = "translateY(-10px)";
  }
}
// ---평균 얼굴 데이터 로드 ---
let averageFace = null;

async function loadAverageFace(){
  const res = await fetch("assets/data/average_face.json");
  averageFace = await res.json();
}
loadAverageFace();
// ---지능 계산 ---
function calcIntelligence(landmarks){
if(!landmarks) {
  return {
    grade:"보통",
    score:0.5,
    details:[
      `상정 비율 ........ 0.50`,
      `미간 폭 .......... 0.50`,
      `안구 개방도 ...... 0.50`,
      `대칭성 ............ 0.50`,
      `종합 지표 ........ 0.50`
    ]
  };
}

  // 대칭성 계산
  let asym = 0;
  for(let i=0;i<landmarks.length;i++){
    const p = landmarks[i];
    const mirror = landmarks[landmarks.length-1-i];
    asym += Math.abs(p.x - (1-mirror.x));
  }
  asym /= landmarks.length;

  const symmetry = 1 - asym;

  const eyeOpen = Math.random()*0.5 + 0.5; // 연출용
  const forehead = Math.random()*0.5 + 0.5;
  const glabella = Math.random()*0.5 + 0.5;

  const score = (symmetry + eyeOpen + forehead + glabella)/4;

  let grade="보통";
  if(score>0.85) grade="천재";
  else if(score>0.7) grade="우수";
  else if(score<0.45) grade="평균 이하";

  return {
    grade,
    score,
    details:[
      `상정 비율 ........ ${forehead.toFixed(2)}`,
      `미간 폭 .......... ${glabella.toFixed(2)}`,
      `안구 개방도 ...... ${eyeOpen.toFixed(2)}`,
      `대칭성 ............ ${symmetry.toFixed(2)}`,
      `종합 지표 ........ ${score.toFixed(2)}`
    ]
  };
}
// ---범죄 점수 계산 ---
function calcCrime(intelScore){
  const types=[
    "살인범","절도범","성범죄자",
    "강도","사기/위조범","방화범"
  ];

  const scores={};

  types.forEach(t=>{
    let base=Math.random()*0.7;
    scores[t]=base;
  });

  // 지능 연동
  scores["방화범"] += (1-intelScore)*0.4;
  scores["사기/위조범"] += intelScore*0.4;

  // 정규화 0~100
  Object.keys(scores).forEach(k=>{
    scores[k]=Math.round(Math.min(1,scores[k])*100);
  });

  return scores;
}
// ---렌더링 함수 ---
function renderResult(){
  const photo=document.getElementById("resultPhoto");
  photo.src=capturedImageDataUrl;

const intel=calcIntelligence(capturedLandmarks);
  const crimes=calcCrime(intel.score);

  document.getElementById("intelGrade").textContent=intel.grade;
  document.getElementById("intelDetails").innerHTML=
    intel.details.map(d=>`<div>${d}</div>`).join("");

  const crimeList=document.getElementById("crimeScores");
  crimeList.innerHTML="";
  Object.entries(crimes).forEach(([k,v])=>{
    crimeList.innerHTML+=`<div>${k} ...... ${v}점</div>`;
  });

  const top=Object.entries(crimes)
    .sort((a,b)=>b[1]-a[1])[0];

  document.getElementById("crimeTop").textContent=
    `범죄 예정 유형: ${top[0]}`;

  // 프로젝터 창으로 얼굴+프레임만 전송
  postToProjection("SHOW_RESULT_FRAME",{
    image:capturedImageDataUrl
  });
}



  // ---- Video cover/contain toggle support (for later) ----
  function setVideoFit(mode /* "cover" | "contain" */) {
    if (!els.bgVideo) return;
    els.bgVideo.style.objectFit = mode;
  }
  // Default cover
  setVideoFit("cover");

  // ---- Events ----
  // Try open projection on load (may be blocked by popup policy)
  ensureProjectionWindow();

  els.btnStart.addEventListener("click", () => {
    // If popup blocked earlier, user gesture will allow it now.
    if (!projectionWin || projectionWin.closed) ensureProjectionWindow();
    setScreen("consent");
  });

  els.consentChecks.forEach((c) => c.addEventListener("change", updateConsentButton));
  updateConsentButton();

  els.btnToScan.addEventListener("click", () => setScreen("scan"));

  els.btnRestart?.addEventListener("click", () => setScreen("start"));

  // ✅ Result 화면 '다시하기' 버튼
els.btnRestartFinal?.addEventListener("click", () => {
  // analyze/scan 동작 정리(있으면 정리, 없으면 무시)
  try { stopAnalyze(); } catch(e) {}
  try { stopScan(); } catch(e) {}

  // 촬영 데이터 리셋
  capturedImageDataUrl = null;

  // start로 이동 (start에서 resetConsent()도 호출되게 해둔 상태)
  setScreen("start");
});

  // Keep safe if projection window is reloaded: re-clear
  window.addEventListener("focus", () => postToProjection("PING"));

  // Start at start screen
  setScreen("start");
})();
