// --- DOM Elements ---
const videoInput = document.getElementById('video-input');
const videoPlayer = document.getElementById('video-player');
const roiCanvas = document.getElementById('roi-canvas');
const processCanvas = document.getElementById('process-canvas'); // Hidden canvas
const selectReactionBtn = document.getElementById('select-reaction-roi-btn');
const selectBackgroundBtn = document.getElementById('select-background-roi-btn');
const clearRoisBtn = document.getElementById('clear-rois-btn');
const reactionCoordsSpan = document.getElementById('reaction-roi-coords');
const backgroundCoordsSpan = document.getElementById('background-roi-coords');
const analyzeBtn = document.getElementById('analyze-btn');
const analysisProgress = document.getElementById('analysis-progress');
const analysisStatus = document.getElementById('analysis-status');
const chartContainer = document.getElementById('chart-container');
const resultsChartCanvas = document.getElementById('results-chart').getContext('2d');
const downloadCsvBtn = document.getElementById('download-csv-btn');
const openCvStatus = document.getElementById('opencv-status');
// --- DOM Elements for Recording ---
const livePreview = document.getElementById('live-preview');
const startRecordBtn = document.getElementById('start-record-btn');
const stopRecordBtn = document.getElementById('stop-record-btn');
const recordingStatus = document.getElementById('recording-status');

// --- State Variables ---
let cvReady = false; // Flag to check if OpenCV is fully loaded
let videoFile = null; // Can be File object or Blob from recording
let videoDuration = 0;
let reactionROI = null; // { x, y, width, height } in relative % coordinates
let backgroundROI = null; // { x, y, width, height } in relative % coordinates
let roiBeingSelected = null; // 'reaction' or 'background'
let drawing = false;
let startX, startY, currentX, currentY;
let analysisData = []; // Array of { time, hueReaction, hueBackground }
let chartInstance = null;
const roiCtx = roiCanvas.getContext('2d');
const processCtx = processCanvas.getContext('2d');
// --- State Variables for Recording ---
let mediaRecorder = null;
let recordedChunks = [];
let mediaStream = null; // To hold the camera stream


// --- OpenCV Loading & Initialization ---
// Variable global Module para que opencv.js la encuentre y use sus callbacks
var Module = {
    preRun: [],
    postRun: [],
    onRuntimeInitialized: () => {
        // ESTE es el punto seguro donde 'cv' está listo para usar
        if (typeof cv !== 'undefined' && cv.imread) { // Check if cv exists and has a key function
            console.log('OpenCV.js Runtime Initialized and ready.');
            openCvStatus.textContent = 'OpenCV.js ¡Listo!';
            openCvStatus.style.color = 'green';
            cvReady = true;
            // Habilitar funcionalidades que dependen de OpenCV
            initializeAppOpenCvDependent();
        } else {
            onOpenCvErrorInternal("Objeto cv no encontrado o incompleto después de onRuntimeInitialized.");
        }
    },
    // Opcional: para ver el progreso de carga del WASM y otros mensajes
    print: function(text) {
        if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' ');
        console.log("OpenCV print:", text);
    },
    printErr: function(text) {
        if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' ');
        console.error("OpenCV printErr:", text);
        onOpenCvErrorInternal("Error durante inicialización de OpenCV: " + text);
    },
    setStatus: function(text) {
        if (!Module.setStatus.last) Module.setStatus.last = { time: Date.now(), text: '' };
        if (text === Module.setStatus.last.text) return;
        var m = text.match(/([^(]+)\((\d+(\.\d+)?)\/(\d+)\)/);
        var now = Date.now();
        if (m && now - Module.setStatus.last.time < 30) return; // Reduce log spam
        Module.setStatus.last.time = now;
        Module.setStatus.last.text = text;
        if (m) {
            text = m[1];
            const progress = Math.round(parseInt(m[2]) / parseInt(m[4]) * 100);
            console.log(`OpenCV Load Progress: ${parseInt(m[2])}/${m[4]} (${progress}%)`);
            openCvStatus.textContent = `Cargando OpenCV... ${progress}%`;
        } else {
            console.log('OpenCV Status:', text);
             // Mostrar mensajes clave en la UI
             if (text.includes("downloading") || text.includes("preparing")) {
                  openCvStatus.textContent = 'OpenCV: ' + text;
             }
        }
    },
    totalDependencies: 0,
    monitorRunDependencies: function(left) {
        this.totalDependencies = Math.max(this.totalDependencies, left);
        const statusText = left ? 'Preparando... (' + (this.totalDependencies - left) + '/' + this.totalDependencies + ')' : 'Todas las dependencias listas.';
        Module.setStatus(statusText);
        console.log("OpenCV monitorRunDependencies:", statusText);
    }
};

// Función interna para manejar errores de OpenCV consistentemente
function onOpenCvErrorInternal(errorMessage) {
    console.error('OpenCV Error:', errorMessage);
    openCvStatus.textContent = `Error de OpenCV. El análisis no funcionará. Recarga la página.`;
    openCvStatus.style.color = 'red';
    cvReady = false; // Asegurarse de que esté en false
    // Deshabilitar botones cruciales si OpenCV falla permanentemente
    analyzeBtn.disabled = true;
    // Podrías deshabilitar más cosas aquí si es necesario
}

// Indicar estado inicial de carga de OpenCV
openCvStatus.textContent = 'Cargando OpenCV.js...';
openCvStatus.style.color = 'orange';
Module.setStatus('Cargando OpenCV.js...'); // Iniciar status


// --- Event Listeners ---
videoInput.addEventListener('change', handleVideoUpload);
selectReactionBtn.addEventListener('click', () => startSelectingROI('reaction'));
selectBackgroundBtn.addEventListener('click', () => startSelectingROI('background'));
clearRoisBtn.addEventListener('click', clearROIs);
analyzeBtn.addEventListener('click', startAnalysis);
downloadCsvBtn.addEventListener('click', downloadCSV);
// -- Recording Listeners --
startRecordBtn.addEventListener('click', startRecording);
stopRecordBtn.addEventListener('click', stopRecording);
// ROI Canvas Mouse Events
roiCanvas.addEventListener('mousedown', handleMouseDown);
roiCanvas.addEventListener('mousemove', handleMouseMove);
roiCanvas.addEventListener('mouseup', handleMouseUp);
roiCanvas.addEventListener('mouseout', handleMouseOut);


// --- Recording Functions ---

async function startRecording() {
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
            audio: false
        });
        livePreview.srcObject = mediaStream;
        livePreview.captureStream = livePreview.captureStream || livePreview.mozCaptureStream;
        videoInput.style.display = 'none';

        recordedChunks = [];
        const options = { mimeType: 'video/webm; codecs=vp9' };
        try { mediaRecorder = new MediaRecorder(mediaStream, options); }
        catch (e1) {
            console.warn(`Codec ${options.mimeType} no soportado, intentando vp8...`);
            const options2 = { mimeType: 'video/webm; codecs=vp8' };
            try { mediaRecorder = new MediaRecorder(mediaStream, options2); }
            catch (e2) {
                console.warn(`Codec ${options2.mimeType} no soportado, intentando default...`);
                mediaRecorder = new MediaRecorder(mediaStream);
            }
        }

        mediaRecorder.ondataavailable = handleDataAvailable;
        mediaRecorder.onstop = handleStop;
        mediaRecorder.start();
        console.log('MediaRecorder started:', mediaRecorder);
        recordingStatus.textContent = 'Grabando...';
        startRecordBtn.disabled = true;
        stopRecordBtn.disabled = false;
        analyzeBtn.disabled = true; // Disable analysis during recording
        enableRoiButtons(false); // Disable ROI selection during recording

    } catch (err) {
        console.error("Error accessing camera or starting recording:", err);
        alert(`Could not access camera: ${err.name} - ${err.message}\nPlease grant permission.`);
        if (mediaStream) { mediaStream.getTracks().forEach(track => track.stop()); }
        livePreview.srcObject = null;
        startRecordBtn.disabled = false;
        stopRecordBtn.disabled = true;
        recordingStatus.textContent = '';
        videoInput.style.display = 'block';
        checkEnableAnalyzeButton();
    }
}

function handleDataAvailable(event) {
    if (event.data.size > 0) {
        recordedChunks.push(event.data);
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop(); // This will trigger 'onstop' event
        console.log('MediaRecorder stopping...');
    } else {
        // Cleanup if already stopped or never started properly
        if (mediaStream) { mediaStream.getTracks().forEach(track => track.stop()); }
        livePreview.srcObject = null;
        startRecordBtn.disabled = false;
        stopRecordBtn.disabled = true;
        recordingStatus.textContent = '';
        videoInput.style.display = 'block';
        checkEnableAnalyzeButton(); // Check if analysis can be enabled now
    }
}

function handleStop() {
    console.log("MediaRecorder 'stop' event received.");
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        console.log("Camera tracks stopped.");
    }
    livePreview.srcObject = null;
    startRecordBtn.disabled = false;
    stopRecordBtn.disabled = true;
    recordingStatus.textContent = '';
    videoInput.style.display = 'block';

    if (recordedChunks.length === 0) {
        console.warn("No data was recorded.");
        // alert("Recording produced no data."); // Avoid alert if possible
        checkEnableAnalyzeButton();
        return;
    }

    const blob = new Blob(recordedChunks, { type: recordedChunks[0]?.type || 'video/webm' });
    const videoURL = URL.createObjectURL(blob);

    if (videoPlayer.src.startsWith('blob:')) { URL.revokeObjectURL(videoPlayer.src); }
    videoPlayer.src = videoURL;
    videoFile = blob;

    resetAnalysis();
    clearROIs(false);
    reactionROI = null;
    backgroundROI = null;
    reactionCoordsSpan.textContent = "No definida";
    backgroundCoordsSpan.textContent = "No definida";

    videoPlayer.onloadedmetadata = () => {
        videoDuration = videoPlayer.duration;
        const videoWidth = videoPlayer.videoWidth;
        const videoHeight = videoPlayer.videoHeight;
        const displayWidth = videoPlayer.clientWidth || 640; // Fallback width
        const displayHeight = (videoHeight / videoWidth) * displayWidth;
        roiCanvas.width = displayWidth;
        roiCanvas.height = displayHeight;
        processCanvas.width = videoWidth;
        processCanvas.height = videoHeight;
        console.log(`RECORDED video loaded: Duration ${videoDuration.toFixed(2)}s, Dimensions ${videoWidth}x${videoHeight}`);
        enableRoiButtons(true);
        checkEnableAnalyzeButton();
        clearROIs(true);
    };
    videoPlayer.onerror = (e) => {
        console.error("Error loading recorded video into player:", e);
        alert("Error trying to load recorded video.");
        enableRoiButtons(false);
        checkEnableAnalyzeButton();
    };
     videoPlayer.onseeked = () => { if (reactionROI || backgroundROI) { redrawROIs(); } };

    console.log("Recorded video ready. URL:", videoURL);
    recordedChunks = [];
    checkEnableAnalyzeButton(); // Check again after loading recorded video
}


// --- Video Upload Function ---
function handleVideoUpload(event) {
    stopRecording(); // Stop any active recording first

    videoFile = event.target.files[0];
    if (!videoFile) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        if (videoPlayer.src.startsWith('blob:')) { URL.revokeObjectURL(videoPlayer.src); }
        videoPlayer.src = e.target.result;
    }
    reader.readAsDataURL(videoFile);

    resetAnalysis();
    clearROIs(false);
    reactionROI = null;
    backgroundROI = null;
    reactionCoordsSpan.textContent = "No definida";
    backgroundCoordsSpan.textContent = "No definida";

    videoPlayer.onloadedmetadata = () => {
        videoDuration = videoPlayer.duration;
        const videoWidth = videoPlayer.videoWidth;
        const videoHeight = videoPlayer.videoHeight;
        const displayWidth = videoPlayer.clientWidth || 640; // Fallback width
        const displayHeight = (videoHeight / videoWidth) * displayWidth;
        roiCanvas.width = displayWidth;
        roiCanvas.height = displayHeight;
        processCanvas.width = videoWidth;
        processCanvas.height = videoHeight;
        console.log(`UPLOADED video loaded: Duration ${videoDuration.toFixed(2)}s, Dimensions ${videoWidth}x${videoHeight}`);
        enableRoiButtons(true);
        checkEnableAnalyzeButton();
        clearROIs(true);
    };
     videoPlayer.onerror = (e) => {
        console.error("Error loading uploaded video:", e);
        alert("Error loading uploaded video.");
        enableRoiButtons(false);
        checkEnableAnalyzeButton();
    };
     videoPlayer.onseeked = () => { if (reactionROI || backgroundROI) { redrawROIs(); } };
    checkEnableAnalyzeButton(); // Check after selecting file
}


// --- ROI Selection Functions ---
function enableRoiButtons(enabled) {
    selectReactionBtn.disabled = !enabled;
    selectBackgroundBtn.disabled = !enabled;
    clearRoisBtn.disabled = !enabled;
    roiCanvas.style.cursor = enabled ? 'default' : 'not-allowed';
     if (!enabled) {
         stopSelectingROI(); // Ensure selection mode is off if disabled
     }
}

function startSelectingROI(type) {
    if (selectReactionBtn.disabled) return; // Prevent if buttons are disabled
    roiBeingSelected = type;
    selectReactionBtn.classList.toggle('active', type === 'reaction');
    selectBackgroundBtn.classList.toggle('active', type === 'background');
    console.log(`Selecting ROI: ${type}`);
    roiCanvas.style.cursor = 'crosshair';
}

function stopSelectingROI() {
    if (roiBeingSelected) { // Only reset cursor if actively selecting
         roiCanvas.style.cursor = 'default';
    }
    roiBeingSelected = null;
    selectReactionBtn.classList.remove('active');
    selectBackgroundBtn.classList.remove('active');
}

function handleMouseDown(event) {
    if (!roiBeingSelected || drawing || selectReactionBtn.disabled) return;
    drawing = true;
    const rect = roiCanvas.getBoundingClientRect();
    startX = event.clientX - rect.left;
    startY = event.clientY - rect.top;
    currentX = startX;
    currentY = startY;
}

function handleMouseMove(event) {
    if (!drawing || !roiBeingSelected) return;
    const rect = roiCanvas.getBoundingClientRect();
    currentX = event.clientX - rect.left;
    currentY = event.clientY - rect.top;
    redrawROIs(true);
}

function handleMouseUp(event) {
    if (!drawing || !roiBeingSelected) return;
    drawing = false;
    const rect = roiCanvas.getBoundingClientRect();
    const finalX = event.clientX - rect.left;
    const finalY = event.clientY - rect.top;
    const x = Math.min(startX, finalX);
    const y = Math.min(startY, finalY);
    const width = Math.abs(finalX - startX);
    const height = Math.abs(finalY - startY);

    if (width > 5 && height > 5) {
        const relativeROI = {
            x: x / roiCanvas.width, y: y / roiCanvas.height,
            width: width / roiCanvas.width, height: height / roiCanvas.height
        };
        if (roiBeingSelected === 'reaction') {
            reactionROI = relativeROI;
            reactionCoordsSpan.textContent = `(${Math.round(x)}, ${Math.round(y)}) ${Math.round(width)}x${Math.round(height)}px`;
        } else if (roiBeingSelected === 'background') {
            backgroundROI = relativeROI;
            backgroundCoordsSpan.textContent = `(${Math.round(x)}, ${Math.round(y)}) ${Math.round(width)}x${Math.round(height)}px`;
        }
        checkEnableAnalyzeButton();
    } else { console.log("ROI too small, ignored."); }
    redrawROIs();
    stopSelectingROI();
}

function handleMouseOut(event) {
    if (drawing) { handleMouseUp(event); }
}

function redrawROIs(isDrawingSelection = false) {
    // Ensure canvas context is valid
     if (!roiCtx) return;
    roiCtx.clearRect(0, 0, roiCanvas.width, roiCanvas.height);
    roiCtx.lineWidth = 2;
    if (reactionROI) {
        roiCtx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
        const absCoords = getAbsoluteCoords(reactionROI);
        if (absCoords) roiCtx.strokeRect(absCoords.x, absCoords.y, absCoords.width, absCoords.height);
    }
    if (backgroundROI) {
        roiCtx.strokeStyle = 'rgba(0, 0, 255, 0.8)';
        const absCoords = getAbsoluteCoords(backgroundROI);
         if (absCoords) roiCtx.strokeRect(absCoords.x, absCoords.y, absCoords.width, absCoords.height);
    }
    if (isDrawingSelection && drawing && roiBeingSelected) {
        const currentWidth = currentX - startX;
        const currentHeight = currentY - startY;
        roiCtx.strokeStyle = (roiBeingSelected === 'reaction') ? 'rgba(255, 0, 0, 0.5)' : 'rgba(0, 0, 255, 0.5)';
        roiCtx.setLineDash([5, 5]);
        roiCtx.strokeRect(startX, startY, currentWidth, currentHeight);
        roiCtx.setLineDash([]);
    }
}

function getAbsoluteCoords(relativeROI) { // For drawing on display canvas
    if (!relativeROI || !roiCanvas.width || !roiCanvas.height) return null; // Add checks
    return {
        x: relativeROI.x * roiCanvas.width, y: relativeROI.y * roiCanvas.height,
        width: relativeROI.width * roiCanvas.width, height: relativeROI.height * roiCanvas.height
    };
}

function clearROIs(doRedraw = true) {
    reactionROI = null;
    backgroundROI = null;
    reactionCoordsSpan.textContent = "No definida";
    backgroundCoordsSpan.textContent = "No definida";
    if (doRedraw && roiCtx) { // Check roiCtx
        roiCtx.clearRect(0, 0, roiCanvas.width, roiCanvas.height);
    }
    checkEnableAnalyzeButton();
    console.log("ROIs cleared.");
}


// --- Analysis Functions ---
function checkEnableAnalyzeButton() {
    const canAnalyze = cvReady && videoFile && reactionROI && backgroundROI && (!mediaRecorder || mediaRecorder.state === 'inactive');
    analyzeBtn.disabled = !canAnalyze;
}

function resetAnalysis() {
    analysisData = [];
    analysisProgress.style.display = 'none';
    analysisProgress.value = 0;
    analysisStatus.textContent = '';
    analysisStatus.style.color = ''; // Reset color
    chartContainer.style.display = 'none';
    downloadCsvBtn.disabled = true;
    if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
    }
}

async function startAnalysis() {
    // Robust check at the very beginning
    if (!cvReady || typeof cv === 'undefined' || !cv.imread) {
         console.error("Analysis attempt failed: OpenCV is not ready or cv.imread is missing.");
         alert("Error: OpenCV no está completamente inicializado. Espera o recarga.");
         analysisFinished(true); // Reset button states on failure
         return;
    }
     if (analyzeBtn.disabled) {
         console.warn("Analysis button clicked while disabled.");
         return; // Don't proceed if button is logically disabled
     }

    console.log("Starting analysis...");
    resetAnalysis();
    analyzeBtn.disabled = true;
    enableRoiButtons(false);
    startRecordBtn.disabled = true; // Disable recording during analysis
    stopRecordBtn.disabled = true;

    analysisProgress.style.display = 'block';
    analysisStatus.textContent = 'Analizando...';
    analysisStatus.style.color = 'orange'; // Indicate processing

    const intervalSeconds = 0.5;
    let currentTime = 0;
    const analysisEndTime = videoDuration > 0.1 ? videoDuration - 0.01 : 0; // Handle short videos
    const totalFramesToProcess = Math.max(1, Math.ceil(analysisEndTime / intervalSeconds));
    let framesProcessed = 0;

    if (!videoPlayer.paused) { videoPlayer.pause(); }

    // Use requestAnimationFrame loop for smoother processing if possible
    // This might be more complex with async seeking, stick to setTimeout for now

    async function processNextFrame() {
        if (currentTime > analysisEndTime) {
            analysisFinished();
            return;
        }
         // Defend against invalid processCanvas dimensions
         if (!processCanvas.width || !processCanvas.height) {
              console.error("Invalid processing canvas dimensions.");
              analysisStatus.textContent = `Error: Dimensiones de canvas inválidas (${processCanvas.width}x${processCanvas.height}).`;
              analysisStatus.style.color = 'red';
              analysisFinished(true);
              return;
         }

        videoPlayer.currentTime = currentTime;

        try {
            await new Promise((resolve, reject) => {
                 const seekTimeout = 5000; // 5 seconds timeout for seek
                 let timeoutId = setTimeout(() => {
                     console.error(`Seek timed out at ${currentTime.toFixed(2)}s`);
                     reject(new Error(`Timeout esperando 'seeked' en ${currentTime.toFixed(2)}s`));
                 }, seekTimeout);

                const seekedListener = () => {
                    clearTimeout(timeoutId);
                    videoPlayer.removeEventListener('seeked', seekedListener);
                    videoPlayer.removeEventListener('error', errorListener);
                     // Short delay AFTER seeked often helps canvas drawImage stability
                     setTimeout(resolve, 60); // Increased delay slightly
                };
                const errorListener = (e) => {
                     clearTimeout(timeoutId);
                     console.error("Video element error during seek:", e);
                     reject(new Error("Error del elemento de video durante la búsqueda"));
                 };
                videoPlayer.addEventListener('seeked', seekedListener, { once: true });
                 videoPlayer.addEventListener('error', errorListener, { once: true });
            });
        } catch (error) {
             console.error("Stopping analysis due to seek error/timeout:", error);
             analysisStatus.textContent = `Error en análisis: ${error.message}`;
             analysisStatus.style.color = 'red';
             analysisFinished(true); // Indicate error finish
             return; // Stop processing chain
        }

         // Draw frame to hidden canvas for OpenCV
         try {
              processCtx.drawImage(videoPlayer, 0, 0, processCanvas.width, processCanvas.height);
         } catch(drawError) {
              console.error(`Error drawing video frame to canvas at ${currentTime.toFixed(2)}s:`, drawError);
              analysisStatus.textContent = `Error dibujando frame: ${drawError.message}`;
              analysisStatus.style.color = 'red';
              analysisFinished(true);
              return;
         }


        try {
            // console.log("Attempting cv.imread on processCanvas"); // Debug log
            let frameMat = cv.imread(processCanvas);
            if (frameMat.empty()) {
                console.warn(`Empty frame matrix read at time ${currentTime.toFixed(2)}s`);
                frameMat.delete(); // Clean up even if empty
                scheduleNext();
                return;
            }

            let rgbFrameMat = new cv.Mat();
            cv.cvtColor(frameMat, rgbFrameMat, cv.COLOR_RGBA2RGB);

            const reactionAbs = getAbsoluteCoordsForProcessing(reactionROI);
            const backgroundAbs = getAbsoluteCoordsForProcessing(backgroundROI);

            // Check if ROIs are valid before processing
            if (!reactionAbs || !backgroundAbs || reactionAbs.width <= 0 || reactionAbs.height <= 0 || backgroundAbs.width <= 0 || backgroundAbs.height <= 0) {
                 console.warn(`Invalid ROI dimensions at time ${currentTime.toFixed(2)}s. Reaction:`, reactionAbs, "Background:", backgroundAbs);
                 rgbFrameMat.delete(); frameMat.delete(); // Cleanup
                 scheduleNext(); // Skip this frame
                 return;
            }

            let reactionRect = new cv.Rect(reactionAbs.x, reactionAbs.y, reactionAbs.width, reactionAbs.height);
            let reactionRoiMat = rgbFrameMat.roi(reactionRect);
            let reactionHsvMat = new cv.Mat();
            cv.cvtColor(reactionRoiMat, reactionHsvMat, cv.COLOR_RGB2HSV);
            let reactionMean = cv.mean(reactionHsvMat); // Provides [H, S, V, Alpha]
            const avgHueReaction = reactionMean[0]; // Hue is channel 0

            let backgroundRect = new cv.Rect(backgroundAbs.x, backgroundAbs.y, backgroundAbs.width, backgroundAbs.height);
            let backgroundRoiMat = rgbFrameMat.roi(backgroundRect);
            let backgroundHsvMat = new cv.Mat();
            cv.cvtColor(backgroundRoiMat, backgroundHsvMat, cv.COLOR_RGB2HSV);
            let backgroundMean = cv.mean(backgroundHsvMat);
            const avgHueBackground = backgroundMean[0];

            analysisData.push({
                time: currentTime.toFixed(2),
                hueReaction: avgHueReaction.toFixed(2),
                hueBackground: avgHueBackground.toFixed(2)
            });

            // --- OpenCV Mat Cleanup --- MUST DO THIS
            reactionRoiMat.delete(); reactionHsvMat.delete();
            backgroundRoiMat.delete(); backgroundHsvMat.delete();
            rgbFrameMat.delete(); frameMat.delete();

        } catch (cvError) {
            console.error(`OpenCV processing error at ${currentTime.toFixed(2)}s:`, cvError);
            console.error("cv object at time of error:", cv); // Log cv object state on error
            analysisStatus.textContent = `Error de procesamiento: ${cvError.message || cvError}`;
            analysisStatus.style.color = 'red';
            analysisFinished(true);
            return; // Stop analysis
        }

        framesProcessed++;
        analysisProgress.value = Math.min(100, (framesProcessed / totalFramesToProcess) * 100);

        scheduleNext();
    }

    function scheduleNext() {
        currentTime += intervalSeconds;
        // Yield to browser event loop
        setTimeout(processNextFrame, 0); // Use shortest possible timeout
    }

    // Start the first frame processing
    processNextFrame();
}


function getAbsoluteCoordsForProcessing(relativeROI) { // For OpenCV on original video dimensions
    if (!relativeROI || !processCanvas.width || !processCanvas.height) return null;
    const x = Math.max(0, Math.round(relativeROI.x * processCanvas.width));
    const y = Math.max(0, Math.round(relativeROI.y * processCanvas.height));
    const w = Math.max(1, Math.round(relativeROI.width * processCanvas.width)); // Ensure width >= 1
    const h = Math.max(1, Math.round(relativeROI.height * processCanvas.height)); // Ensure height >= 1
    const clampedW = Math.min(w, processCanvas.width - x); // Clamp width
    const clampedH = Math.min(h, processCanvas.height - y); // Clamp height
     // Return null if clamped dimensions are invalid
     if (clampedW <= 0 || clampedH <= 0) {
          console.warn("Calculated processing ROI has zero or negative dimensions:", {x,y,clampedW,clampedH});
          return null;
     }
    return { x: x, y: y, width: clampedW, height: clampedH };
}

function analysisFinished(errorOccurred = false) {
    console.log(`Analysis finished. ${errorOccurred ? 'With errors.' : 'Successfully.'}`);
    analysisProgress.style.display = 'none';
    // Re-enable buttons carefully
    analyzeBtn.disabled = false; // Always re-enable analyze button? Or keep disabled on error? Re-enabling allows retry.
    enableRoiButtons(!!videoFile); // Re-enable ROI buttons ONLY if a video is loaded
    startRecordBtn.disabled = false; // Re-enable recording button
    stopRecordBtn.disabled = true;  // Stop button should be disabled

    if (!errorOccurred && analysisData.length > 0) {
        analysisStatus.textContent = 'Análisis completado.';
        analysisStatus.style.color = 'green';
        drawChart();
        downloadCsvBtn.disabled = false;
        chartContainer.style.display = 'block';
    } else if (!errorOccurred) {
        analysisStatus.textContent = 'Análisis completado, sin datos generados.';
        analysisStatus.style.color = 'orange';
    } else {
        // Error message should already be set
        chartContainer.style.display = 'none';
        downloadCsvBtn.disabled = true;
    }
    checkEnableAnalyzeButton(); // Final check of analyze button state
}

function drawChart() {
    if (chartInstance) { chartInstance.destroy(); }
    const labels = analysisData.map(d => d.time);
    const reactionData = analysisData.map(d => parseFloat(d.hueReaction));
    const backgroundData = analysisData.map(d => parseFloat(d.hueBackground));

    chartInstance = new Chart(resultsChartCanvas, {
        type: 'line',
        data: { labels: labels, datasets: [ /* ... datasets ... */
             { label: 'Hue Promedio Reacción', data: reactionData, borderColor: 'rgb(255, 99, 132)', backgroundColor: 'rgba(255, 99, 132, 0.5)', tension: 0.1 },
             { label: 'Hue Promedio Fondo', data: backgroundData, borderColor: 'rgb(54, 162, 235)', backgroundColor: 'rgba(54, 162, 235, 0.5)', tension: 0.1 }
        ]},
        options: { /* ... options ... */
             scales: { x: { title: { display: true, text: 'Tiempo (s)' } }, y: { title: { display: true, text: 'Hue Promedio (0-179)' }, min: 0, max: 180 } },
             responsive: true, maintainAspectRatio: false
        }
    });
}

function downloadCSV() {
    if (analysisData.length === 0) return;
    let csvContent = "data:text/csv;charset=utf-8,Tiempo(s),Hue_Reaccion,Hue_Fondo\n";
    analysisData.forEach(row => { csvContent += `${row.time},${row.hueReaction},${row.hueBackground}\n`; });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "analisis_reaccion.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// --- Initial Page Setup ---
function initializeApp() {
    // Initial state independent of OpenCV
    enableRoiButtons(false);
    analyzeBtn.disabled = true;
    downloadCsvBtn.disabled = true;
    stopRecordBtn.disabled = true;
    startRecordBtn.disabled = false;
    console.log("Initial app state set.");
}

// Called only when OpenCV is fully ready
function initializeAppOpenCvDependent() {
    console.log("OpenCV ready, enabling dependent features...");
    // Now check if analyze button can be enabled based on current state
    checkEnableAnalyzeButton();
}

// Run initial setup on script load
initializeApp();
