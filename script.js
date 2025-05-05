// --- DOM Elements ---
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
let videoFile = null; // Blob from recording
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

// --- Function Definitions (Importante definir antes de usar) ---

function enableRoiButtons(enabled) {
    const reason = enabled ? "Enabling" : "Disabling";
    if (selectReactionBtn.disabled === enabled) { // Log only on change
        console.log(`${reason} ROI buttons. Enabled = ${enabled}`);
    }
    selectReactionBtn.disabled = !enabled;
    selectBackgroundBtn.disabled = !enabled;
    clearRoisBtn.disabled = !enabled;
    roiCanvas.style.cursor = enabled ? 'default' : 'not-allowed';
     if (!enabled) { stopSelectingROI(); } // Call stopSelectingROI if defined
}

function stopSelectingROI() {
    if (roiBeingSelected) { roiCanvas.style.cursor = 'default'; }
    roiBeingSelected = null;
    selectReactionBtn.classList.remove('active');
    selectBackgroundBtn.classList.remove('active');
}

// *** DEFINICIÓN DE clearROIs ***
function clearROIs(doRedraw = true) {
    console.log("clearROIs called. doRedraw =", doRedraw); // Log para depuración
    reactionROI = null;
    backgroundROI = null;
    reactionCoordsSpan.textContent = "No definida";
    backgroundCoordsSpan.textContent = "No definida";
    if (doRedraw && roiCtx && roiCanvas.width > 0 && roiCanvas.height > 0) { // Check context and dimensions
        try {
            roiCtx.clearRect(0, 0, roiCanvas.width, roiCanvas.height);
            console.log("ROI Canvas cleared.");
        } catch (e) {
             console.error("Error clearing ROI canvas:", e);
        }
    } else if (doRedraw) {
         console.warn("Skipped clearing ROI canvas (no context or zero dimensions).");
    }
    if (typeof checkEnableAnalyzeButton === 'function') { // Check if function exists before calling
         checkEnableAnalyzeButton(); // Re-evaluate analyze button state
    }
}


function resetAnalysis() {
    analysisData = [];
    analysisProgress.style.display = 'none';
    analysisProgress.value = 0;
    analysisStatus.textContent = '';
    analysisStatus.style.color = '';
    chartContainer.style.display = 'none';
    downloadCsvBtn.disabled = true;
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
}

function checkEnableAnalyzeButton() {
    const canAnalyze = cvReady && videoFile && reactionROI && backgroundROI;
    const recorderActive = mediaRecorder && mediaRecorder.state === 'recording';
    analyzeBtn.disabled = !canAnalyze || recorderActive;
    // console.log(`Checking analyze button: cvReady=${cvReady}, videoFile=${!!videoFile}, reactionROI=${!!reactionROI}, backgroundROI=${!!backgroundROI}, recorderActive=${recorderActive}. Result disabled=${analyzeBtn.disabled}`);
}

// --- OpenCV Loading & Initialization ---
var Module = {
    preRun: [], postRun: [],
    onRuntimeInitialized: () => {
        console.log('OpenCV.js Runtime Initialized - Callback received.');
        setTimeout(() => {
            console.log('Checking for cv object after short delay...');
            if (typeof cv !== 'undefined') {
                if (typeof cv.then === 'function') {
                    console.log('cv object is a Promise. Waiting for it to resolve...');
                    openCvStatus.textContent = 'OpenCV: Finalizando inicialización...';
                    cv.then((finalCvObject) => {
                        if (finalCvObject && finalCvObject.imread) {
                            cv = finalCvObject; console.log('OpenCV.js is fully ready (Promise resolved).');
                            openCvStatus.textContent = 'OpenCV.js ¡OKs!'; openCvStatus.style.color = 'green';
                            cvReady = true;
                            // LLAMAR A initializeAppOpenCvDependent DESPUÉS DE QUE CV ESTÉ LISTO
                            initializeAppOpenCvDependent();
                        } else { onOpenCvErrorInternal("Objeto final de OpenCV inválido."); }
                    }).catch((err) => { onOpenCvErrorInternal("Error resolviendo promesa de OpenCV."); });
                } else if (cv.imread) {
                     console.log('OpenCV.js is fully ready (Direct object).');
                     openCvStatus.textContent = 'OpenCV.js ¡OKs!'; openCvStatus.style.color = 'green';
                     cvReady = true;
                     // LLAMAR A initializeAppOpenCvDependent DESPUÉS DE QUE CV ESTÉ LISTO
                     initializeAppOpenCvDependent();
                } else { onOpenCvErrorInternal("Objeto cv encontrado pero incompleto."); }
            } else { onOpenCvErrorInternal("Variable global cv no definida."); }
        }, 50);
    },
    // ... (print, printErr, setStatus, etc.) ...
    print: function(text) { /* ... */ }, printErr: function(text) { /* ... */ }, setStatus: function(text) { /* ... */ }, totalDependencies: 0, monitorRunDependencies: function(left) { /* ... */ }
};
function onOpenCvErrorInternal(errorMessage) {
    console.error('OpenCV Error:', errorMessage);
    openCvStatus.textContent = `Error de OpenCV. El análisis no funcionará. Recarga la página.`;
    openCvStatus.style.color = 'red';
    cvReady = false; analyzeBtn.disabled = true;
}
openCvStatus.textContent = 'Cargando OpenCV.js...'; openCvStatus.style.color = 'orange';
Module.setStatus('Cargando OpenCV.js...');

// --- Event Listeners ---
selectReactionBtn.addEventListener('click', () => startSelectingROI('reaction'));
selectBackgroundBtn.addEventListener('click', () => startSelectingROI('background'));
clearRoisBtn.addEventListener('click', () => clearROIs(true)); // Llamada correcta aquí
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
    console.log("startRecording called.");
    try {
        resetAnalysis();
        // LLAMAR clearROIs aquí, DESPUÉS de asegurarnos que está definida
        clearROIs(true); // Limpiar ROIs y canvas de la ejecución anterior
        videoFile = null;
        if (videoPlayer.src) {
             if (videoPlayer.src.startsWith('blob:') || videoPlayer.src.startsWith('data:')) {
                  URL.revokeObjectURL(videoPlayer.src);
             }
             videoPlayer.src = ''; videoPlayer.removeAttribute('src'); videoPlayer.load();
             console.log("Previous video player source cleared.");
        }
        enableRoiButtons(false); // Deshabilitar ROI hasta que termine grabación y cargue video
        checkEnableAnalyzeButton();

        mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        livePreview.srcObject = mediaStream;
        livePreview.captureStream = livePreview.captureStream || livePreview.mozCaptureStream;
        recordedChunks = [];
        const options = { mimeType: 'video/webm; codecs=vp9' };
        try { mediaRecorder = new MediaRecorder(mediaStream, options); }
        catch (e1) { /* ... fallback ... */ mediaRecorder = new MediaRecorder(mediaStream); }
        mediaRecorder.ondataavailable = handleDataAvailable;
        mediaRecorder.onstop = handleStop;
        mediaRecorder.start();
        console.log('MediaRecorder started.');
        recordingStatus.textContent = 'Grabando...';
        startRecordBtn.disabled = true;
        stopRecordBtn.disabled = false;
        analyzeBtn.disabled = true;
    } catch (err) {
         console.error("Error in startRecording:", err);
         alert(`Could not access camera: ${err.name} - ${err.message}`);
         if (mediaStream) { mediaStream.getTracks().forEach(track => track.stop()); }
         livePreview.srcObject = null;
         startRecordBtn.disabled = false; stopRecordBtn.disabled = true;
         recordingStatus.textContent = '';
         enableRoiButtons(false); checkEnableAnalyzeButton();
    }
}

function handleDataAvailable(event) { if (event.data.size > 0) { recordedChunks.push(event.data); } }

function stopRecording() {
    // --- DEBUG ---
    console.log("stopRecording function CALLED.");
    console.log("Current mediaRecorder:", mediaRecorder);
    console.log("Current mediaRecorder state:", mediaRecorder ? mediaRecorder.state : 'N/A');
    // --- END DEBUG ---

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        // --- DEBUG ---
        console.log("Condition MET (recorder exists and is not inactive). Calling mediaRecorder.stop()...");
        // --- END DEBUG ---
        try {
            mediaRecorder.stop(); // <-- La llamada clave para detener la grabación
             // ¡Importante! No actualices la UI aquí directamente.
             // Espera a que el evento 'onstop' (handleStop) se dispare.
             // El evento onstop se encargará de detener los tracks, limpiar la UI, etc.
            console.log('mediaRecorder.stop() called successfully. Waiting for onstop event...');
        } catch (e) {
            console.error("Error calling mediaRecorder.stop():", e);
            // Si stop() falla, intentar limpiar manualmente
             if (mediaStream) { mediaStream.getTracks().forEach(track => track.stop()); }
             livePreview.srcObject = null;
             startRecordBtn.disabled = false;
             stopRecordBtn.disabled = true;
             recordingStatus.textContent = '';
             enableRoiButtons(false); // Asegurar que ROI estén deshabilitados
             checkEnableAnalyzeButton();
        }
    } else {
        // --- DEBUG ---
        console.log("Condition NOT MET (recorder is null or already inactive). Performing direct cleanup.");
        // --- END DEBUG ---
        // Si no hay grabadora activa, simplemente limpiar
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            console.log("Camera tracks stopped directly (no active recorder).");
        }
        livePreview.srcObject = null;
        startRecordBtn.disabled = false;
        stopRecordBtn.disabled = true;
        recordingStatus.textContent = '';
        enableRoiButtons(false); // Asegurar que ROI estén deshabilitados
        checkEnableAnalyzeButton();
    }
}
function handleStop() {
    // --- DEBUG ---
    console.log("handleStop (onstop event handler) TRIGGERED.");
    // --- END DEBUG ---
    
    console.log("MediaRecorder 'stop' event received.");
    // ... (resto de la función handleStop igual que antes) ...
     if (mediaStream) { /* ... stop tracks ... */ }
     livePreview.srcObject = null;
     startRecordBtn.disabled = false;
     stopRecordBtn.disabled = true;
     recordingStatus.textContent = '';
     // ... (resto: crear Blob, leer con FileReader, etc.) ...
    console.log("MediaRecorder 'stop' event received.");
    // ... (detener cámara, limpiar UI grabación) ...
    if (recordedChunks.length === 0) { /* ... (manejar caso sin datos) ... */ return; }
    const blob = new Blob(recordedChunks, { type: recordedChunks[0]?.type || 'video/webm' });
    videoFile = blob; // <-- Marcar que hay video
    console.log("Recorded Blob created. Converting to Data URL...");
    const reader = new FileReader();
    reader.onload = function(e) {
        console.log("Blob read as Data URL.");
        const dataUrl = e.target.result;
        if (videoPlayer.src.startsWith('blob:') || videoPlayer.src.startsWith('data:')) { URL.revokeObjectURL(videoPlayer.src); }
        videoPlayer.src = dataUrl;
        resetAnalysis();
        // NO llamar clearROIs aquí, se llamará en onloadedmetadata si las dimensiones son válidas
        reactionROI = null; backgroundROI = null;
        reactionCoordsSpan.textContent = "No definida"; backgroundCoordsSpan.textContent = "No definida";
        enableRoiButtons(false); // Mantener deshabilitado hasta onloadedmetadata
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
                 clearROIs(true); // <-- Llamar clearROIs AHORA que el canvas está listo
                 console.log("Attempting to enable ROI buttons...");
                 enableRoiButtons(true); // <-- Habilitar AHORA
                 console.log("ROI buttons should be enabled now.");
            } else { /* ... error handling ... */ enableRoiButtons(false); }
            checkEnableAnalyzeButton();
        };
        videoPlayer.onerror = (e) => { /* ... */ };
        videoPlayer.onseeked = () => { /* ... */ };
    };
    reader.onerror = (e) => { /* ... */ };
    reader.readAsDataURL(blob);
    recordedChunks = [];
}

// --- ROI Selection Functions ---
// startSelectingROI, mouseDown, mouseMove, mouseUp, mouseOut, redrawROIs, getAbsoluteCoords
// (Sin cambios en estas funciones)
function startSelectingROI(type) { /* ... */ }
function handleMouseDown(event) { /* ... */ }
function handleMouseMove(event) { /* ... */ }
function handleMouseUp(event) { /* ... */ }
function handleMouseOut(event) { /* ... */ }
function redrawROIs(isDrawingSelection = false) { /* ... */ }
function getAbsoluteCoords(relativeROI) { /* ... */ }

// --- Analysis Functions ---
// startAnalysis con DEBUG LOGS (Sin cambios, ya estaba completo)
async function startAnalysis() {
    // ... (Todo el código de startAnalysis con logs que ya tenías) ...
     async function processNextFrame() { /* ... */ }
     function scheduleNext() { /* ... */ }
     processNextFrame();
}

function getAbsoluteCoordsForProcessing(relativeROI) { /* ... (sin cambios) ... */ }
function analysisFinished(errorOccurred = false) { /* ... (sin cambios) ... */ }
function drawChart() { /* ... (sin cambios) ... */ }
function downloadCSV() { /* ... (sin cambios) ... */ }

// --- Initial Page Setup ---
function initializeApp() {
    // Asegurarse de que las funciones estén definidas antes de llamarlas aquí
    enableRoiButtons(false);
    analyzeBtn.disabled = true;
    downloadCsvBtn.disabled = true;
    stopRecordBtn.disabled = true;
    startRecordBtn.disabled = false;
    console.log("Initial app state set (buttons disabled).");
}
function initializeAppOpenCvDependent() {
    console.log("OpenCV ready. Checking analyze button status.");
    // NO llamar clearROIs aquí
    checkEnableAnalyzeButton();
}

// Run initial setup
initializeApp(); // Llamar después de definir todas las funciones necesarias
