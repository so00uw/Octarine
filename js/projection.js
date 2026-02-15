(() => {
  const stage = document.getElementById("stage");
  
  // --- [여기서부터 새로 추가된 변수 선언부] ---
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 1920;
  canvas.height = 1080;
  stage.appendChild(canvas);

  const vfxOverlay = new Image();
  vfxOverlay.src = 'assets/img/vfx_grid.png';

  const videoInput = document.createElement('video');
  videoInput.autoplay = true;
  videoInput.playsinline = true;

  async function initProjectionCamera() {
      try {
          const stream = await navigator.mediaDevices.getUserMedia({ 
              video: { width: 1920, height: 1080 } 
          });
          videoInput.srcObject = stream;
      } catch (e) {
          console.error("프로젝터 창 카메라 접근 실패:", e);
      }
  }
  initProjectionCamera();
  // --- [여기까지] ---

  function clearStage() {
    stage.innerHTML = "";
    stage.style.background = "#000";
    // 캔버스를 다시 붙여주기 위해 stage.appendChild(canvas);를 여기에 넣어도 좋습니다.
  }
window.addEventListener("message", (ev) => {
    const msg = ev.data || {};
    if (!msg.type) return;

    if (msg.type === "CLEAR") {
        clearStage();
        // 다시 캔버스를 붙여줌 (청소 후 재생성)
        stage.appendChild(canvas);
    }

    // [중요] 실시간 얼굴 업데이트 (app.js에서 좌표만 보냄)
    if (msg.type === "UPDATE_FACE") {
        // 기존에 넣어둔 drawProjection 함수를 실행
        // videoElement 자리에 위에서 만든 videoInput을 넣어줌
        drawProjection(msg.payload.landmarks, videoInput);
    }

    if (msg.type === "SHOW_RESULT_FRAME") {
        clearStage();
        const img = document.createElement("img");
        img.src = msg.payload.image;
        img.className = "fade-in"; // 연출용 클래스
        img.style.cssText = "position:absolute; width:100%; height:100%; object-fit:cover;";
        stage.appendChild(img);
        
    }
});
function drawProjection(faceLandmarks, videoElement) {
    // 배경을 검정색으로 채움 (마네킹 이외 영역 차단)
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!faceLandmarks) return;

    ctx.save();
    
    // 얼굴 외곽선 좌표 (MediaPipe Face Mesh 기준 외곽 인덱스 사용)
    const outlineIndices = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 10];

    ctx.beginPath();
    outlineIndices.forEach((idx, i) => {
        const point = faceLandmarks[idx];
        if (i === 0) ctx.moveTo(point.x * canvas.width, point.y * canvas.height);
        else ctx.lineTo(point.x * canvas.width, point.y * canvas.height);
    });
    ctx.closePath();

    // 마스킹 영역 지정
    ctx.clip();

    // 1. 얼굴 원본 영상 투사
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

    // 2. VFX 오버레이 (Nuke 그리드/입자 효과)
    ctx.globalAlpha = 0.5; // 투명도 조절
    ctx.drawImage(vfxOverlay, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1.0;

    ctx.restore();
}
/** [END: 3단계] **/

  clearStage();
})();
if (msg.type === "SHOW_RESULT_FRAME") {
  clearStage();
  const img=document.createElement("img");
  img.src=msg.payload.image;
  img.style.position="absolute";
  img.style.width="100%";
  img.style.height="100%";
  img.style.objectFit="cover";
  stage.appendChild(img);

  const frame=document.createElement("div");
  frame.style.position="absolute";
  frame.style.left="900px";
  frame.style.top="420px";
  frame.style.width="120px";
  frame.style.height="60px";
  frame.style.border="3px solid #00ff5a";
  stage.appendChild(frame);
}
