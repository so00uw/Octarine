(() => {
  const stage = document.getElementById("stage");
  
  // --- [캔버스 선언부] ---
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 1920;
  canvas.height = 1080;
  stage.appendChild(canvas);

  // --- [비디오 로드 및 설정] ---
  const vfxVideo = document.createElement('video');
  vfxVideo.src = 'assets/vfx/digital_scan_loop.mp4';
  vfxVideo.muted = true;    
  vfxVideo.loop = true;     
  vfxVideo.play().catch(e => console.log("VFX 비디오 자동재생 대기중...")); 

  const videoInput = document.createElement('video');
  videoInput.autoplay = true;
  videoInput.playsinline = true;
  videoInput.muted = true;

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

  function clearStage() {
    stage.innerHTML = "";
    stage.style.background = "#000";
    stage.appendChild(canvas); // 캔버스는 항상 유지
  }

  window.addEventListener("message", (ev) => {
      const msg = ev.data || {};
      if (!msg.type) return;

      if (msg.type === "CLEAR") {
          clearStage();
          ctx.clearRect(0, 0, canvas.width, canvas.height);
      }

      // [스캔/분석 단계] 실시간 얼굴 업데이트
      if (msg.type === "UPDATE_FACE") {
          drawProjection(msg.payload.landmarks, videoInput);
      }

      // [결과 단계] 결과 프레임 렌더링 (캔버스 위에 직접 그리기)
// [결과 단계] 결과 프레임 렌더링 (얼굴 윤곽선 마스킹 적용!)
      if (msg.type === "SHOW_RESULT_FRAME") {
          clearStage();
          
          const img = new Image();
          img.onload = () => {
              // 1. 전체 배경을 까맣게 칠하기
              ctx.fillStyle = '#000';
              ctx.fillRect(0, 0, canvas.width, canvas.height);

              // 랜드마크 데이터가 제대로 안 넘어왔을 때를 대비한 안전장치
              if (!msg.payload.landmarks) {
                  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                  return;
              }

              ctx.save();
              
              // 2. 마스킹 (MediaPipe 좌표 기반 얼굴 영역 따기)
              const faceLandmarks = msg.payload.landmarks;
              const outlineIndices = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 10];

              ctx.beginPath();
              outlineIndices.forEach((idx, i) => {
                  const point = faceLandmarks[idx];
                  if (i === 0) ctx.moveTo(point.x * canvas.width, point.y * canvas.height);
                  else ctx.lineTo(point.x * canvas.width, point.y * canvas.height);
              });
              ctx.closePath();
              ctx.clip(); // 👈 마법의 코드: 이 선 안쪽만 화면에 보여줘!

              // 3. 얼굴 원본 사진 그리기 (잘라낸 영역 안쪽에만 쏙 들어감)
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              
              ctx.restore(); // 마스킹 끄기 (이후에 그리는 건 다시 전체에 그려짐)

              /* (참고) 기존에 있던 초록색 네모는 얼굴만 남기기로 했으니 지우거나 주석 처리했습니다.
                 만약 여전히 필요하다면 아래 주석을 풀어주세요.
              ctx.strokeStyle = "#00ff5a";
              ctx.lineWidth = 5;
              ctx.strokeRect(900, 420, 120, 60); 
              */
          };
          img.src = msg.payload.image;
      }  });

  function drawProjection(faceLandmarks, videoElement) {
      // 1. 배경 초기화 (검정)
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (!faceLandmarks) return;

      ctx.save();
      
      // 2. 마스킹 (MediaPipe 좌표 기반 얼굴 영역 따기)
      const outlineIndices = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 10];

      ctx.beginPath();
      outlineIndices.forEach((idx, i) => {
          const point = faceLandmarks[idx];
          if (i === 0) ctx.moveTo(point.x * canvas.width, point.y * canvas.height);
          else ctx.lineTo(point.x * canvas.width, point.y * canvas.height);
      });
      ctx.closePath();
      ctx.clip(); 

      // 3. 얼굴 원본 영상 그리기
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

      // 4. VFX 루프 영상 합성 (안전장치 추가!)
      // 비디오가 로딩 완료(readyState >= 2)되었을 때만 그리도록 하여 에러 방지
      if (vfxVideo.readyState >= 2) {
          ctx.globalCompositeOperation = 'screen'; 
          ctx.globalAlpha = 0.7; 
          ctx.drawImage(vfxVideo, 0, 0, canvas.width, canvas.height);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1.0;
      }

      ctx.restore();
  }

  clearStage();
})();