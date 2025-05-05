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
     if (!enabled) {
          // Call stopSelectingROI only if it's defined, otherwise causes error on initial load
          if (typeof stopSelectingROI === 'function') {
               stopSelectingROI();
          }
     }
}

function stopSelectingROI() {
    if (roiBeingSelected) { roiCanvas.style.cursor = 'default'; }
    roiBeingSelected = null;
    selectReactionBtn.classList.remove('active');
    selectBackgroundBtn.classList.remove('active');
     // console.log("Stopped ROI selection mode."); // Optional log
}

function clearROIs(doRedraw = true) {
    console.log("clearROIs called. doRedraw =", doRedraw);
    reactionROI = null;
    backgroundROI = null;
    reactionCoordsSpan.textContent = "No definida";
    backgroundCoordsSpan.textContent = "No definida";
    if (doRedraw && roiCtx && roiCanvas.width > 0 && roiCanvas.height > 0) {
        try { roiCtx.clearRect(0, 0, roiCanvas.width, roiCanvas.height); console.log("ROI Canvas cleared."); }
        catch (e) { console.error("Error clearing ROI canvas:", e); }
    } else if (doRedraw) { console.warn("Skipped clearing ROI canvas (no context or zero dimensions)."); }
    if (typeof checkEnableAnalyzeButton === 'function') { checkEnableAnalyzeButton(); }
}

function resetAnalysis() {
    analysisData = [];
    analysisProgress.style.display = 'none'; analysisProgress.value = 0;
    analysisStatus.textContent = ''; analysisStatus.style.color = '';
    chartContainer.style.display = 'none'; downloadCsvBtn.disabled = true;
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
                            openCvStatus.textContent = 'OpenCV.js ¡Listo!'; openCvStatus.style.color = 'green';
                            cvReady = true; initializeAppOpenCvDependent();
                        } else { onOpenCvErrorInternal("Objeto final de OpenCV inválido."); }
                    }).catch((err) => { onOpenCvErrorInternal("Error resolviendo promesa de OpenCV."); });
                } else if (cv.imread) {
                     console.log('OpenCV.js is fully ready (Direct object).');
                     openCvStatus.textContent = 'OpenCV.js ¡Listo!'; openCvStatus.style.color = 'green';
                     cvReady = true; initializeAppOpenCvDependent();
                } else { onOpenCvErrorInternal("Objeto cv encontrado pero incompleto."); }
            } else { onOpenCvErrorInternal("Variable global cv no definida."); }
        }, 50);
    },
    print: function(text) { /* ... */ }, printErr: function(text) { /* ... */ }, setStatus: function(text) { /* ... */ }, totalDependencies: 0, monitorRunDependencies: function(left) { /* ... */ }
};
function onOpenCvErrorInternal(errorMessage) { /* ... */ }
openCvStatus.textContent = 'Cargando OpenCV.js...'; openCvStatus.style.color = 'orange';
Module.setStatus('Cargando OpenCV.js...');

// --- Event Listeners ---
selectReactionBtn.addEventListener('click', () => {
    // --- DEBUG ---
    console.log("Select Reaction ROI button CLICKED.");
    // --- END DEBUG ---
    startSelectingROI('reaction'); // Llama a startSelectingROI definida más abajo
});
selectBackgroundBtn.addEventListener('click', () => {
    // --- DEBUG ---
    console.log("Select Background ROI button CLICKED.");
    // --- END DEBUG ---
    startSelectingROI('background'); // Llama a startSelectingROI definida más abajo
});
clearRoisBtn.addEventListener('click', () => clearROIs(true));
analyzeBtn.addEventListener('click', startAnalysis);
downloadCsvBtn.addEventListener('click', downloadCSV);
startRecordBtn.addEventListener('click', startRecording);
stopRecordBtn.addEventListener('click', stopRecording);
roiCanvas.addEventListener('mousedown', handleMouseDown); // Definida más abajo
roiCanvas.addEventListener('mousemove', handleMouseMove); // Definida más abajo
roiCanvas.addEventListener('mouseup', handleMouseUp);     // Definida más abajo
roiCanvas.addEventListener('mouseout', handleMouseOut);   // Definida más abajo


// --- Recording Functions ---
async function startRecording() {
    console.log("startRecording called.");
    try {
        resetAnalysis();
        clearROIs(true); // Limpiar estado anterior
        videoFile = null;
        if (videoPlayer.src) { /* ... limpiar src ... */ }
        enableRoiButtons(false); checkEnableAnalyzeButton();

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
        startRecordBtn.disabled = true; stopRecordBtn.disabled = false; analyzeBtn.disabled = true;
    } catch (err) { /* ... error handling ... */ }
}

function handleDataAvailable(event) { if (event.data.size > 0) { recordedChunks.push(event.data); } }

// *** stopRecording con DEBUG LOGS ***
function stopRecording() {
    console.log("stopRecording function CALLED.");
    console.log("Current mediaRecorder:", mediaRecorder);
    console.log("Current mediaRecorder state:", mediaRecorder ? mediaRecorder.state : 'N/A');

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        console.log("Condition MET (recorder exists and is not inactive). Calling mediaRecorder.stop()...");
        try {
            mediaRecorder.stop();
            console.log('mediaRecorder.stop() called successfully. Waiting for onstop event...');
        } catch (e) {
            console.error("Error calling mediaRecorder.stop():", e);
            // Manual cleanup on error
             if (mediaStream) { mediaStream.getTracks().forEach(track => track.stop()); }
             livePreview.srcObject = null; startRecordBtn.disabled = false; stopRecordBtn.disabled = true;
             recordingStatus.textContent = ''; enableRoiButtons(false); checkEnableAnalyzeButton();
        }
    } else {
        console.log("Condition NOT MET (recorder is null or already inactive). Performing direct cleanup.");
        // Cleanup if already stopped
        if (mediaStream) { mediaStream.getTracks().forEach(track => track.stop()); console.log("Camera tracks stopped directly."); }
        livePreview.srcObject = null; startRecordBtn.disabled = false; stopRecordBtn.disabled = true;
        recordingStatus.textContent = ''; enableRoiButtons(false); checkEnableAnalyzeButton();
    }
}

// *** handleStop con DEBUG LOGS ***
function handleStop() {
    console.log("handleStop (onstop event handler) TRIGGERED."); // <<< DEBUG LOG
    console.log("MediaRecorder 'stop' event received.");
    // ... (resto del código para detener cámara, limpiar UI, etc.) ...
     if (mediaStream) { mediaStream.getTracks().forEach(track => track.stop()); console.log("Camera tracks stopped."); }
     livePreview.srcObject = null; startRecordBtn.disabled = false; stopRecordBtn.disabled = true; recordingStatus.textContent = '';

    if (recordedChunks.length === 0) { /* ... (manejar caso sin datos) ... */ return; }
    const blob = new Blob(recordedChunks, { type: recordedChunks[0]?.type || 'video/webm' });
    videoFile = blob;
    console.log("Recorded Blob created. Converting to Data URL...");
    const reader = new FileReader();
    reader.onload = function(e) {
        console.log("Blob read as Data URL.");
        const dataUrl = e.target.result;
        if (videoPlayer.src.startsWith('blob:') || videoPlayer.src.startsWith('data:')) { URL.revokeObjectURL(videoPlayer.src); }
        videoPlayer.src = dataUrl;
        resetAnalysis();
        reactionROI = null; backgroundROI = null;
        reactionCoordsSpan.textContent = "No definida"; backgroundCoordsSpan.textContent = "No definida";
        enableRoiButtons(false); // Deshabilitar hasta onloadedmetadata

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
                 clearROIs(true); // Limpiar canvas AHORA
                 console.log("Attempting to enable ROI buttons...");
                 enableRoiButtons(true); // Habilitar botones AHORA
                 console.log("ROI buttons should be enabled now.");
            } else { /* ... error handling ... */ enableRoiButtons(false); }
            checkEnableAnalyzeButton();
        };
        videoPlayer.onerror = (e) => { /* ... */ }; videoPlayer.onseeked = () => { /* ... */ };
    };
    reader.onerror = (e) => { /* ... */ };
    reader.readAsDataURL(blob);
    recordedChunks = [];
}


// --- ROI Selection Functions ---
// *** startSelectingROI con DEBUG LOGS ***
function startSelectingROI(type) {
    console.log(`startSelectingROI called with type: ${type}`); // <<< DEBUG LOG
    if (selectReactionBtn.disabled) {
         console.log("ROI selection prevented because buttons are disabled."); // <<< DEBUG LOG
        return;
    }
    roiBeingSelected = type;
    console.log(`roiBeingSelected state is now: ${roiBeingSelected}`); // <<< DEBUG LOG
    selectReactionBtn.classList.toggle('active', type === 'reaction');
    selectBackgroundBtn.classList.toggle('active', type === 'background');
    roiCanvas.style.cursor = 'crosshair';
    console.log(`ROI canvas cursor set to 'crosshair'.`); // <<< DEBUG LOG
}

// *** handleMouseDown con DEBUG LOGS ***
function handleMouseDown(event) {
    console.log("handleMouseDown triggered."); // <<< DEBUG LOG
    console.log(`  - roiBeingSelected: ${roiBeingSelected}, drawing: ${drawing}, buttons disabled: ${selectReactionBtn.disabled}`); // <<< DEBUG LOG
    if (!roiBeingSelected || drawing || selectReactionBtn.disabled) return;
    drawing = true;
    const rect = roiCanvas.getBoundingClientRect();
    startX = event.clientX - rect.left; startY = event.clientY - rect.top;
    currentX = startX; currentY = startY;
    console.log(`  - Drawing started at: (${startX.toFixed(0)}, ${startY.toFixed(0)})`); // <<< DEBUG LOG
}

// *** handleMouseMove (sin logs por defecto para no ser ruidoso) ***
function handleMouseMove(event) {
    // console.log("handleMouseMove triggered."); // Descomentar si es necesario
    if (!drawing || !roiBeingSelected) return;
    const rect = roiCanvas.getBoundingClientRect();
    currentX = event.clientX - rect.left; currentY = event.clientY - rect.top;
    redrawROIs(true);
}

// *** handleMouseUp con DEBUG LOGS ***
function handleMouseUp(event) {
    console.log("handleMouseUp triggered."); // <<< DEBUG LOG
    console.log(`  - roiBeingSelected: ${roiBeingSelected}, drawing: ${drawing}`); // <<< DEBUG LOG
    if (!drawing || !roiBeingSelected) return;
    drawing = false;
    const rect = roiCanvas.getBoundingClientRect();
    const finalX = event.clientX - rect.left; const finalY = event.clientY - rect.top;
    const x = Math.min(startX, finalX); const y = Math.min(startY, finalY);
    const width = Math.abs(finalX - startX); const height = Math.abs(finalY - startY);

    if (width > 5 && height > 5) {
        const relativeROI = { x: x / roiCanvas.width, y: y / roiCanvas.height, width: width / roiCanvas.width, height: height / roiCanvas.height };
        if (roiBeingSelected === 'reaction') { reactionROI = relativeROI; reactionCoordsSpan.textContent = `(${Math.round(x)}, ${Math.round(y)}) ${Math.round(width)}x${Math.round(height)}px`; }
        else if (roiBeingSelected === 'background') { backgroundROI = relativeROI; backgroundCoordsSpan.textContent = `(${Math.round(x)}, ${Math.round(y)}) ${Math.round(width)}x${Math.round(height)}px`; }
        console.log(`  - Drawing ended. ROI calculated and saved for ${roiBeingSelected}.`); // <<< DEBUG LOG
        checkEnableAnalyzeButton();
    } else { console.log("  - Drawing ended. ROI too small, ignored."); } // <<< DEBUG LOG

    redrawROIs();
    stopSelectingROI(); // Llama a la función definida anteriormente
}

function handleMouseOut(event) { if (drawing) { handleMouseUp(event); } } // Sin cambios

function redrawROIs(isDrawingSelection = false) { /* ... (Sin cambios) ... */ } // Sin cambios
function getAbsoluteCoords(relativeROI) { /* ... (Sin cambios) ... */ } // Sin cambios

// --- Analysis Functions ---
// startAnalysis con DEBUG LOGS (Sin cambios, ya estaba completo)
async function startAnalysis() { /* ... */ }
function getAbsoluteCoordsForProcessing(relativeROI) { /* ... */ }
function analysisFinished(errorOccurred = false) { /* ... */ }
function drawChart() { /* ... */ }
function downloadCSV() { /* ... */ }

// --- Initial Page Setup ---
function initializeApp() {
    enableRoiButtons(false); analyzeBtn.disabled = true; downloadCsvBtn.disabled = true;
    stopRecordBtn.disabled = true; startRecordBtn.disabled = false;
    console.log("Initial app state set (buttons disabled).");
}
function initializeAppOpenCvDependent() {
    console.log("OpenCV ready. Checking analyze button status.");
    checkEnableAnalyzeButton();
}

// Run initial setup
initializeApp();
