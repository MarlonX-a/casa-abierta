export async function setupWebcam(constraints = {}) {
  const video = document.getElementById("video");
  if (!video) throw new Error("Video element not found");

  // Verificar soporte de getUserMedia
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("getUserMedia no está soportado en este navegador");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: constraints.width ?? 640 },
      height: { ideal: constraints.height ?? 480 },
      frameRate: { ideal: constraints.frameRate ?? 30, max: 30 },
      facingMode: "user",
    },
    audio: false,
  });

  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  video.muted = true;

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = (e) => reject(new Error("Error cargando video: " + e.message));
    // Timeout de seguridad
    setTimeout(() => reject(new Error("Timeout cargando video")), 10000);
  });

  await video.play();

  // Importante: establecer dimensiones correctas para MediaPipe
  video.width = video.videoWidth || constraints.width || 640;
  video.height = video.videoHeight || constraints.height || 480;

  console.log(`Webcam iniciada: ${video.width}x${video.height}`);

  return video;
}

export async function teardownWebcam(video) {
  if (!video?.srcObject) return;

  for (const track of video.srcObject.getTracks()) {
    track.stop();
  }

  video.srcObject = null;
}
