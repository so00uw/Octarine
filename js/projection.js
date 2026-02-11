(() => {
  const stage = document.getElementById("stage");

  function clearStage() {
    stage.innerHTML = "";
    stage.style.background = "#000";
  }

  window.addEventListener("message", (ev) => {
    const msg = ev.data || {};
    if (!msg.type) return;

    if (msg.type === "CLEAR") clearStage();
    if (msg.type === "PING") {
      // no-op, but could be used for handshake later
    }

    // 다음 스텝에서:
    // - "SHOW_RESULT_FRAME" 같은 메시지로 얼굴 이미지 + 프레임만 렌더하도록 확장
  });

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
