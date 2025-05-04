// --- DOM Elements ---
// const videoInput = document.getElementById('video-input'); // Eliminado
const videoPlayer = document.getElementById('video-player');
const roiCanvas = document.getElementById('roi-canvas');
const processCanvas = document.getElementById('process-canvas');
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
const livePreview = document.getElementById('live-preview');
const startRecordBtn = document.getElementById('start-record-btn');
const stopRecordBtn = document.getElementById('stop-record-btn');
const recordingStatus = document.getElementById('recording-status');

// --- State Variables ---
let cvReady = false;
let videoFile = null; // <-- Sigue siendo útil para saber si hay video listo (ahora solo viene de grabación)
let videoDuration = 0;
let reactionROI = null;
let backgroundROI = null;
let roiBeingSelected = null;
let drawing = false;
let startX, startY, currentX, currentY;
let analysisData = [];
let chartInstance = null;
const roiCtx = roiCanvas.getContext('2d');
const processCtx = processCanvas.getContext('2d');
let mediaRecorder = null;
let recordedChunks = [];
let mediaStream = null;

// --- OpenCV Loading & Initialization ---
var Module = { // <-- Mismo código de inicialización de OpenCV con Promesa
    preRun: [], postRun: [],
    onRuntimeInitialized: () => {
        console.log('OpenCV.js Runtime Initialized - Callback received.');
        setTimeout(() => {
            console.log('Checking for cv object after short delay...');
            if (typeof cv !== 'undefined') {
                if (typeof cv.then === 'function') { /* ... Manejo de Promesa ... */
                    console.log('cv object is a Promise. Waiting for it to resolve...');
                     openCvStatus.textContent = 'OpenCV: Finalizando inicialización...';
                    cv.then((finalCvObject) => {
                        if (finalCvObject && finalCvObject.imread) {
                            cv = finalCvObject; console.log('OpenCV.js is fully ready (Promise resolved).');
                            openCvStatus.textContent = 'OpenCV.js ¡Listo!'; openCvStatus.style.color = 'green';
                            cvReady = true; initializeAppOpenCvDependent();
                        } else { onOpenCvErrorInternal("Objeto final de OpenCV inválido."); }
                    }).catch((err) => { onOpenCvErrorInternal("Error resolviendo promesa de OpenCV."); });
                } else if (cv.imread) { /* ... Manejo directo ... */
                     console.log('OpenCV.js is fully ready (Direct object).');
                     openCvStatus.textContent = 'OpenCV.js ¡Listo!'; openCvStatus.style.color = 'green';
                     cvReady = true; initializeAppOpenCvDependent();
                } else { onOpenCvErrorInternal("Objeto cv encontrado pero incompleto."); }
            } else { onOpenCvErrorInternal("Variable global cv no definida."); }
        }, 50);
    },
    // ... (print, printErr, setStatus, etc. pueden mantenerse para logs) ...
     print: function(text) { if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' '); console.log("OpenCV print:", text); },
     printErr: function(text) { if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' '); console.error("OpenCV printErr:", text); onOpenCvErrorInternal("Error durante inicialización de OpenCV: " + text); },
     setStatus: function(text) { /* ... */ }, totalDependencies: 0, monitorRunDependencies: function(left) { /* ... */ }
};
function onOpenCvErrorInternal(errorMessage) { /* ... (igual que antes) ... */ }
openCvStatus.textContent = 'Cargando OpenCV.js...'; openCvStatus.style.color = 'orange';
Module.setStatus('Cargando OpenCV.js...');

// --- Event Listeners ---
// videoInput.addEventListener('change', handleVideoUpload); // Eliminado
selectReactionBtn.addEventListener('click', () => startSelectingROI('reaction'));
selectBackgroundBtn.addEventListener('click', () => startSelectingROI('background'));
clearRoisBtn.addEventListener('click', clearROIs);
analyzeBtn.addEventListener('click', startAnalysis);
downloadCsvBtn.addEventListener('click', downloadCSV);
startRecordBtn.addEventListener('click', startRecording);
stopRecordBtn.addEventListener('click', stopRecording);
roiCanvas.addEventListener('mousedown', handleMouseDown);
roiCanvas.addEventListener('mousemove', handleMouseMove);
roiCanvas.addEventListener('mouseup', handleMouseUp);
roiCanvas.addEventListener('mouseout', handleMouseOut);

// --- Recording Functions ---
async function startRecording() {
    try {
        // Resetear estado anterior si lo hubiera
        resetAnalysis();
        clearROIs(true);
        videoFile = null; // Indicar que no hay video listo
        if (videoPlayer.src) { // Limpiar reproductor anterior
             if (videoPlayer.src.startsWith('blob:') || videoPlayer.src.startsWith('data:')) {
                  URL.revokeObjectURL(videoPlayer.src); // Revocar si es blob o data url
             }
             videoPlayer.src = '';
             videoPlayer.removeAttribute('src'); // Quitar atributo src
             videoPlayer.load(); // Forzar recarga del elemento vacío
             console.log("Previous video player source cleared.");
        }
        enableRoiButtons(false); // Asegurar que ROI estén deshabilitados
        checkEnableAnalyzeButton(); // Actualizar botón de análisis

        mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        livePreview.srcObject = mediaStream;
        livePreview.captureStream = livePreview.captureStream || livePreview.mozCaptureStream;
        recordedChunks = [];
        const options = { mimeType: 'video/webm; codecs=vp9' };
        try { mediaRecorder = new MediaRecorder(mediaStream, options); }
        catch (e1) { /* ... fallback codecs ... */ mediaRecorder = new MediaRecorder(mediaStream); }
        mediaRecorder.ondataavailable = handleDataAvailable;
        mediaRecorder.onstop = handleStop; // handleStop ahora carga el video para análisis
        mediaRecorder.start();
        console.log('MediaRecorder started.');
        recordingStatus.textContent = 'Grabando...';
        startRecordBtn.disabled = true;
        stopRecordBtn.disabled = false;
        analyzeBtn.disabled = true; // Deshabilitar análisis mientras se graba
        enableRoiButtons(false);
    } catch (err) { /* ... (manejo de error igual que antes) ... */ }
}

function handleDataAvailable(event) {
    if (event.data.size > 0) { recordedChunks.push(event.data); }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop(); console.log('MediaRecorder stopping...');
    } else { /* ... (cleanup si ya estaba detenido) ... */ }
}

// handleStop AHORA es el responsable de cargar el video en el reproductor principal
function handleStop() {
    console.log("MediaRecorder 'stop' event received.");
    if (mediaStream) { mediaStream.getTracks().forEach(track => track.stop()); console.log("Camera tracks stopped."); }
    livePreview.srcObject = null;
    startRecordBtn.disabled = false; // Habilitar para nueva grabación
    stopRecordBtn.disabled = true;
    recordingStatus.textContent = '';

    if (recordedChunks.length === 0) {
        console.warn("No data was recorded.");
        videoFile = null; // Asegurar que no hay video
        enableRoiButtons(false); checkEnableAnalyzeButton(); return;
    }

    const blob = new Blob(recordedChunks, { type: recordedChunks[0]?.type || 'video/webm' });
    videoFile = blob; // <-- ¡Importante! Marcar que tenemos un video listo (como Blob)

    console.log("Recorded Blob created. Converting to Data URL...");
    const reader = new FileReader();
    reader.onload = function(e) {
        console.log("Blob read as Data URL.");
        const dataUrl = e.target.result;
        if (videoPlayer.src.startsWith('blob:') || videoPlayer.src.startsWith('data:')) { URL.revokeObjectURL(videoPlayer.src); }
        videoPlayer.src = dataUrl; // <-- Cargar Data URL en el reproductor

        resetAnalysis(); // Resetear datos de análisis anteriores
        clearROIs(false); // Limpiar ROIs visualmente (sin redibujar aún)
        reactionROI = null; backgroundROI = null;
        reactionCoordsSpan.textContent = "No definida"; backgroundCoordsSpan.textContent = "No definida";
        enableRoiButtons(false); // <-- Mantener deshabilitado hasta onloadedmetadata

        videoPlayer.onloadedmetadata = () => {
            console.log("onloadedmetadata for recorded video triggered.");
            videoDuration = videoPlayer.duration;
            const videoWidth = videoPlayer.videoWidth; const videoHeight = videoPlayer.videoHeight;
            if (!videoWidth || !videoHeight || videoWidth <= 0 || videoHeight <= 0) { /* ... error handling ... */ return; }

            const displayWidth = videoPlayer.clientWidth || 640;
            const displayHeight = (videoHeight / videoWidth) * displayWidth;
            if (displayWidth > 0 && displayHeight > 0) {
                 roiCanvas.width = displayWidth; roiCanvas.height = displayHeight;
                 processCanvas.width = videoWidth; processCanvas.height = videoHeight;
                 console.log(`RECORDED video loaded: D=${videoDuration.toFixed(1)}s, Dim=${videoWidth}x${videoHeight}`);
                 console.log("Attempting to enable ROI buttons...");
                 enableRoiButtons(true); // <-- Habilitar botones ROI AHORA
                 console.log("ROI buttons should be enabled now.");
                 clearROIs(true); // Redibujar canvas vacío
            } else { /* ... error handling ... */ enableRoiButtons(false); }
            checkEnableAnalyzeButton(); // Revisar si se puede analizar
        };
        videoPlayer.onerror = (e) => { console.error("Error loading recorded video:", e); enableRoiButtons(false); checkEnableAnalyzeButton(); };
        videoPlayer.onseeked = () => { if (reactionROI || backgroundROI) { redrawROIs(); } };
    };
    reader.onerror = (e) => { console.error("FileReader error:", e); videoFile = null; enableRoiButtons(false); checkEnableAnalyzeButton(); };
    reader.readAsDataURL(blob);
    recordedChunks = [];
}

// --- Video Upload Function ---
// function handleVideoUpload(event) { ... } // ELIMINADA COMPLETAMENTE


// --- ROI Selection Functions ---
function enableRoiButtons(enabled) {
    const reason = enabled ? "Enabling" : "Disabling";
    // Solo loguear si el estado cambia para reducir ruido
    if (selectReactionBtn.disabled === enabled) { // Si el estado actual es opuesto a 'enabled'
        console.log(`${reason} ROI buttons. Enabled = ${enabled}`);
    }
    selectReactionBtn.disabled = !enabled;
    selectBackgroundBtn.disabled = !enabled;
    clearRoisBtn.disabled = !enabled;
    roiCanvas.style.cursor = enabled ? 'default' : 'not-allowed';
     if (!enabled) { stopSelectingROI(); }
}
// ... (startSelectingROI, stopSelectingROI, mouseDown, mouseMove, mouseUp, mouseOut, redrawROIs, getAbsoluteCoords, clearROIs sin cambios)...


// --- Analysis Functions ---
function checkEnableAnalyzeButton() {
    // Simplificado: Solo depende de CV, tener video (videoFile no es null), y ambos ROIs
    const canAnalyze = cvReady && videoFile && reactionROI && backgroundROI;
     // Deshabilitar si la grabación está activa (aunque ya se hace en startRecording)
     const recorderActive = mediaRecorder && mediaRecorder.state === 'recording';
    analyzeBtn.disabled = !canAnalyze || recorderActive;
    // Log detallado del estado
    // console.log(`Checking analyze button: cvReady=${cvReady}, videoFile=${!!videoFile}, reactionROI=${!!reactionROI}, backgroundROI=${!!backgroundROI}, recorderActive=${recorderActive}. Result disabled=${analyzeBtn.disabled}`);
}

function resetAnalysis() { /* ... (sin cambios) ... */ }

// Función startAnalysis CON LOS DEBUG LOGS (ya la tenías completa y correcta)
async function startAnalysis() {
    if (!cvReady || typeof cv === 'undefined' || !cv.imread) { /* ... error handling ... */ return; }
    if (analyzeBtn.disabled) { /* ... warning ... */ return; }
    console.log("Starting analysis...");
    // ... (resto de la función startAnalysis con logs, igual que antes) ...
     async function processNextFrame() {
         // ... (TODO el contenido de processNextFrame con logs, igual que antes) ...
          // --- INICIO DEBUG LOGS ---
          console.log(`[${currentTime.toFixed(2)}s] Entering processNextFrame.`);
          // --- FIN DEBUG LOGS ---
          // ... resto del código ...
     }
     function scheduleNext() { /* ... */ }
     console.log("[Analysis Start] Calling processNextFrame for the first time.");
     processNextFrame();
}

function getAbsoluteCoordsForProcessing(relativeROI) { /* ... (sin cambios) ... */ }
function analysisFinished(errorOccurred = false) {
     console.log(`Analysis finished. ${errorOccurred ? 'With errors.' : 'Successfully.'}`);
     analysisProgress.style.display = 'none';
     analyzeBtn.disabled = false; // Permitir reintentar
     enableRoiButtons(!!videoFile); // Habilitar ROI si hay video
     startRecordBtn.disabled = false; // Habilitar grabar de nuevo
     stopRecordBtn.disabled = true;
     if (!errorOccurred && analysisData.length > 0) { /* ... mostrar gráfico ... */ }
     else if (!errorOccurred) { /* ... msg sin datos ... */ }
     else { /* ... msg error ... */ }
     checkEnableAnalyzeButton(); // Revisión final
}
function drawChart() { /* ... (sin cambios) ... */ }
function downloadCSV() { /* ... (sin cambios) ... */ }

// --- Initial Page Setup ---
function initializeApp() {
    enableRoiButtons(false); // Iniciar con ROI deshabilitados
    analyzeBtn.disabled = true;
    downloadCsvBtn.disabled = true;
    stopRecordBtn.disabled = true;
    startRecordBtn.disabled = false;
    console.log("Initial app state set (buttons disabled).");
}
function initializeAppOpenCvDependent() {
    console.log("OpenCV ready. Checking analyze button status.");
    checkEnableAnalyzeButton(); // Revisar si se puede analizar (depende de si ya se grabó algo antes)
}

// Run initial setup
initializeApp();
