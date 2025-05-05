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

// --- Function Definitions (Order Matters for Clarity and Potential Hoisting Issues) ---

function enableRoiButtons(enabled) {
    const reason = enabled ? "Enabling" : "Disabling";
    if (selectReactionBtn.disabled === enabled) { console.log(`${reason} ROI buttons. Enabled = ${enabled}`); }
    selectReactionBtn.disabled = !enabled;
    selectBackgroundBtn.disabled = !enabled;
    clearRoisBtn.disabled = !enabled;
    roiCanvas.style.cursor = enabled ? 'default' : 'not-allowed';
     if (!enabled && typeof stopSelectingROI === 'function') { stopSelectingROI(); }
}

function stopSelectingROI() {
    if (roiBeingSelected) { roiCanvas.style.cursor = 'default'; }
    roiBeingSelected = null;
    selectReactionBtn.classList.remove('active');
    selectBackgroundBtn.classList.remove('active');
}

function clearROIs(doRedraw = true) {
    console.log("clearROIs called. doRedraw =", doRedraw);
    reactionROI = null; backgroundROI = null;
    reactionCoordsSpan.textContent = "No definida"; backgroundCoordsSpan.textContent = "No definida";
    if (doRedraw && roiCtx && roiCanvas.width > 0 && roiCanvas.height > 0) {
        try { roiCtx.clearRect(0, 0, roiCanvas.width, roiCanvas.height); console.log("ROI Canvas cleared."); }
        catch (e) { console.error("Error clearing ROI canvas:", e); }
    } else if (doRedraw) { console.warn("Skipped clearing ROI canvas."); }
    if (typeof checkEnableAnalyzeButton === 'function') { checkEnableAnalyzeButton(); }
}

function resetAnalysis() {
    analysisData = []; analysisProgress.style.display = 'none'; analysisProgress.value = 0;
    analysisStatus.textContent = ''; analysisStatus.style.color = '';
    chartContainer.style.display = 'none'; downloadCsvBtn.disabled = true;
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
}

function checkEnableAnalyzeButton() {
    const recorderActive = mediaRecorder && mediaRecorder.state === 'recording';
    const conditionsMet = cvReady && videoFile && reactionROI && backgroundROI;
    const canAnalyze = conditionsMet && !recorderActive;
    analyzeBtn.disabled = !canAnalyze;
    // Optional detailed log:
    // console.log(`Checking analyze button: cvR=${cvReady}, vF=${!!videoFile}, rROI=${!!reactionROI}, bROI=${!!backgroundROI}, recA=${recorderActive}. Result disabled=${analyzeBtn.disabled}`);
}

function redrawROIs(isDrawingSelection = false) {
    // console.log(`redrawROIs called. isDrawingSelection = ${isDrawingSelection}, drawing = ${drawing}`);
    if (!roiCtx || roiCanvas.width <= 0 || roiCanvas.height <= 0) { return; }
    try { roiCtx.clearRect(0, 0, roiCanvas.width, roiCanvas.height); } catch (e) { console.error("Error clearing ROI canvas:", e); return; }
    roiCtx.lineWidth = 2;
    if (reactionROI) { /* ... draw reaction ROI ... */
        roiCtx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
        const absCoords = getAbsoluteCoords(reactionROI);
        if (absCoords && absCoords.width > 0 && absCoords.height > 0) { roiCtx.strokeRect(absCoords.x, absCoords.y, absCoords.width, absCoords.height); }
    }
    if (backgroundROI) { /* ... draw background ROI ... */
        roiCtx.strokeStyle = 'rgba(0, 0, 255, 0.8)';
        const absCoords = getAbsoluteCoords(backgroundROI);
         if (absCoords && absCoords.width > 0 && absCoords.height > 0) { roiCtx.strokeRect(absCoords.x, absCoords.y, absCoords.width, absCoords.height); }
    }
    if (isDrawingSelection && drawing && roiBeingSelected) { /* ... draw current selection ... */
        const currentWidth = currentX - startX; const currentHeight = currentY - startY;
        roiCtx.strokeStyle = (roiBeingSelected === 'reaction') ? 'rgba(255, 0, 0, 0.5)' : 'rgba(0, 0, 255, 0.5)';
        roiCtx.setLineDash([5, 5]); roiCtx.strokeRect(startX, startY, currentWidth, currentHeight); roiCtx.setLineDash([]);
    }
}

function getAbsoluteCoords(relativeROI) {
    if (!relativeROI || !roiCanvas.width || !roiCanvas.height || roiCanvas.width <= 0 || roiCanvas.height <= 0) { return null; }
    return { x: relativeROI.x * roiCanvas.width, y: relativeROI.y * roiCanvas.height, width: relativeROI.width * roiCanvas.width, height: relativeROI.height * roiCanvas.height };
}

function getAbsoluteCoordsForProcessing(relativeROI) {
    if (!relativeROI || !processCanvas.width || !processCanvas.height) return null;
    const x = Math.max(0, Math.round(relativeROI.x * processCanvas.width)); const y = Math.max(0, Math.round(relativeROI.y * processCanvas.height));
    const w = Math.max(1, Math.round(relativeROI.width * processCanvas.width)); const h = Math.max(1, Math.round(relativeROI.height * processCanvas.height));
    const clampedW = Math.min(w, processCanvas.width - x); const clampedH = Math.min(h, processCanvas.height - y);
    if (clampedW <= 0 || clampedH <= 0) { return null; }
    return { x: x, y: y, width: clampedW, height: clampedH };
}

function analysisFinished(errorOccurred = false) {
    console.log(`Analysis finished. ${errorOccurred ? 'With errors.' : 'Successfully.'}`);
    analysisProgress.style.display = 'none';
    analyzeBtn.disabled = false;
    enableRoiButtons(!!videoFile);
    startRecordBtn.disabled = false; stopRecordBtn.disabled = true;
    if (!errorOccurred && analysisData.length > 0) { /* ... show chart ... */ drawChart(); downloadCsvBtn.disabled = false; chartContainer.style.display = 'block'; }
    else if (!errorOccurred) { /* ... msg no data ... */ analysisStatus.textContent = 'Análisis completado, sin datos generados.'; analysisStatus.style.color = 'orange'; }
    else { /* ... msg error (already set) ... */ chartContainer.style.display = 'none'; downloadCsvBtn.disabled = true; }
    checkEnableAnalyzeButton();
}

function drawChart() {
    if (chartInstance) { chartInstance.destroy(); }
    const labels = analysisData.map(d => d.time);
    const reactionData = analysisData.map(d => parseFloat(d.hueReaction));
    const backgroundData = analysisData.map(d => parseFloat(d.hueBackground));
    chartInstance = new Chart(resultsChartCanvas, {
        type: 'line', data: { labels: labels, datasets: [
            { label: 'Hue Promedio Reacción', data: reactionData, borderColor: 'rgb(255, 99, 132)', backgroundColor: 'rgba(255, 99, 132, 0.5)', tension: 0.1 },
            { label: 'Hue Promedio Fondo', data: backgroundData, borderColor: 'rgb(54, 162, 235)', backgroundColor: 'rgba(54, 162, 235, 0.5)', tension: 0.1 }
        ]}, options: { scales: { x: { title: { display: true, text: 'Tiempo (s)' } }, y: { title: { display: true, text: 'Hue Promedio (0-179)' }, min: 0, max: 180 } }, responsive: true, maintainAspectRatio: false }
    });
}

function downloadCSV() {
    if (analysisData.length === 0) return;
    let csvContent = "data:text/csv;charset=utf-8,Tiempo(s),Hue_Reaccion,Hue_Fondo\n";
    analysisData.forEach(row => { csvContent += `${row.time},${row.hueReaction},${row.hueBackground}\n`; });
    const encodedUri = encodeURI(csvContent); const link = document.createElement("a");
    link.setAttribute("href", encodedUri); link.setAttribute("download", "analisis_reaccion.csv");
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
}


// --- OpenCV Loading & Initialization ---
var Module = {
    preRun: [], postRun: [],
    onRuntimeInitialized: () => {
        console.log('OpenCV.js Runtime Initialized - Callback received.');
        setTimeout(() => {
            console.log('Checking for cv object after short delay...');
            if (typeof cv !== 'undefined') {
                if (typeof cv.then === 'function') { /* ... Promise handling ... */
                    console.log('cv object is a Promise...');
                    cv.then((finalCvObject) => {
                        if (finalCvObject && finalCvObject.imread) { cv = finalCvObject; cvReady = true; initializeAppOpenCvDependent(); /* ... update status ... */ }
                        else { onOpenCvErrorInternal("Objeto final de OpenCV inválido."); }
                    }).catch((err) => { onOpenCvErrorInternal("Error resolviendo promesa de OpenCV."); });
                } else if (cv.imread) { /* ... Direct object handling ... */
                     console.log('OpenCV.js is fully ready (Direct object).'); cvReady = true; initializeAppOpenCvDependent(); /* ... update status ... */
                } else { onOpenCvErrorInternal("Objeto cv encontrado pero incompleto."); }
            } else { onOpenCvErrorInternal("Variable global cv no definida."); }
        }, 50);
    },
    print: function(text) { /* ... */ }, printErr: function(text) { /* ... */ }, setStatus: function(text) { /* ... */ }, totalDependencies: 0, monitorRunDependencies: function(left) { /* ... */ }
};
function onOpenCvErrorInternal(errorMessage) { console.error('OpenCV Error:', errorMessage); /* ... update status ... */ }
openCvStatus.textContent = 'Cargando OpenCV.js...'; /* ... update status ... */

// --- Event Listeners ---
selectReactionBtn.addEventListener('click', () => { console.log("Select Reaction ROI button CLICKED."); startSelectingROI('reaction'); });
selectBackgroundBtn.addEventListener('click', () => { console.log("Select Background ROI button CLICKED."); startSelectingROI('background'); });
clearRoisBtn.addEventListener('click', () => clearROIs(true));
analyzeBtn.addEventListener('click', () => {
    console.log("Analyze button CLICKED."); console.log(` - Button disabled property at click time: ${analyzeBtn.disabled}`);
    if (!analyzeBtn.disabled) { startAnalysis(); } else { console.warn("Analyze button click ignored because button is disabled."); }
});
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
        resetAnalysis(); clearROIs(true); videoFile = null;
        if (videoPlayer.src) { /* ... clear src ... */ }
        enableRoiButtons(false); checkEnableAnalyzeButton();
        mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        livePreview.srcObject = mediaStream; livePreview.captureStream = livePreview.captureStream || livePreview.mozCaptureStream;
        recordedChunks = []; const options = { mimeType: 'video/webm; codecs=vp9' };
        try { mediaRecorder = new MediaRecorder(mediaStream, options); } catch (e1) { /* ... fallback ... */ mediaRecorder = new MediaRecorder(mediaStream); }
        mediaRecorder.ondataavailable = handleDataAvailable; mediaRecorder.onstop = handleStop;
        mediaRecorder.start(); console.log('MediaRecorder started.');
        recordingStatus.textContent = 'Grabando...';
        startRecordBtn.disabled = true; stopRecordBtn.disabled = false; analyzeBtn.disabled = true;
    } catch (err) { /* ... error handling ... */ }
}

function handleDataAvailable(event) { if (event.data.size > 0) { recordedChunks.push(event.data); } }

function stopRecording() {
    console.log("stopRecording function CALLED."); /* ... logs ... */
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        console.log("Condition MET... Calling mediaRecorder.stop()...");
        try { mediaRecorder.stop(); console.log('mediaRecorder.stop() called successfully...'); }
        catch (e) { console.error("Error calling stop():", e); /* ... manual cleanup ... */ }
    } else { console.log("Condition NOT MET... direct cleanup."); /* ... direct cleanup ... */ }
}

function handleStop() {
    console.log("handleStop (onstop event handler) TRIGGERED.");
    if (mediaStream) { /* ... stop tracks ... */ }
    /* ... clean UI ... */
    if (recordedChunks.length === 0) { /* ... return ... */ }
    const blob = new Blob(recordedChunks, { type: recordedChunks[0]?.type || 'video/webm' });
    videoFile = blob;
    console.log("Recorded Blob created. Converting to Data URL...");
    const reader = new FileReader();
    reader.onload = function(e) {
        console.log("Blob read as Data URL."); const dataUrl = e.target.result;
        if (videoPlayer.src.startsWith('blob:') || videoPlayer.src.startsWith('data:')) { URL.revokeObjectURL(videoPlayer.src); }
        videoPlayer.src = dataUrl;
        resetAnalysis(); /* ... clear ROIs state ... */ enableRoiButtons(false);
        videoPlayer.onloadedmetadata = () => {
            console.log("onloadedmetadata for recorded video triggered.");
            videoDuration = videoPlayer.duration; const videoWidth = videoPlayer.videoWidth; const videoHeight = videoPlayer.videoHeight;
            if (!videoWidth || !videoHeight || videoWidth <= 0 || videoHeight <= 0) { /* ... */ return; }
            const displayWidth = videoPlayer.clientWidth || 640; const displayHeight = (videoHeight / videoWidth) * displayWidth;
            if (displayWidth > 0 && displayHeight > 0) {
                 roiCanvas.width = displayWidth; roiCanvas.height = displayHeight; processCanvas.width = videoWidth; processCanvas.height = videoHeight;
                 console.log(`RECORDED video loaded: D=${videoDuration.toFixed(1)}s, Dim=${videoWidth}x${videoHeight}`);
                 clearROIs(true); // Limpiar canvas AHORA
                 console.log("Attempting to enable ROI buttons..."); enableRoiButtons(true); console.log("ROI buttons should be enabled now.");
            } else { /* ... error handling ... */ enableRoiButtons(false); }
            checkEnableAnalyzeButton();
        };
        videoPlayer.onerror = (e) => { /* ... */ }; videoPlayer.onseeked = () => { /* ... */ };
    };
    reader.onerror = (e) => { /* ... */ }; reader.readAsDataURL(blob); recordedChunks = [];
}

// --- ROI Selection Functions ---
function startSelectingROI(type) {
    console.log(`startSelectingROI called with type: ${type}`);
    if (selectReactionBtn.disabled) { console.log("ROI selection prevented..."); return; }
    roiBeingSelected = type; console.log(`roiBeingSelected state is now: ${roiBeingSelected}`);
    selectReactionBtn.classList.toggle('active', type === 'reaction'); selectBackgroundBtn.classList.toggle('active', type === 'background');
    roiCanvas.style.cursor = 'crosshair'; console.log(`ROI canvas cursor set to 'crosshair'.`);
}

function handleMouseDown(event) {
    console.log("handleMouseDown triggered."); /* ... logs ... */
    if (!roiBeingSelected || drawing || selectReactionBtn.disabled) return;
    drawing = true; const rect = roiCanvas.getBoundingClientRect();
    startX = event.clientX - rect.left; startY = event.clientY - rect.top;
    currentX = startX; currentY = startY; console.log(`  - Drawing started at: (${startX.toFixed(0)}, ${startY.toFixed(0)})`);
}

function handleMouseMove(event) {
    if (!drawing || !roiBeingSelected) return;
    const rect = roiCanvas.getBoundingClientRect(); currentX = event.clientX - rect.left; currentY = event.clientY - rect.top;
    redrawROIs(true);
}

function handleMouseUp(event) {
    console.log("handleMouseUp triggered."); /* ... logs ... */
    if (!drawing || !roiBeingSelected) return;
    drawing = false; const rect = roiCanvas.getBoundingClientRect();
    const finalX = event.clientX - rect.left; const finalY = event.clientY - rect.top;
    const x = Math.min(startX, finalX); const y = Math.min(startY, finalY);
    const width = Math.abs(finalX - startX); const height = Math.abs(finalY - startY);
    if (width > 5 && height > 5) {
        const relativeROI = { x: x / roiCanvas.width, y: y / roiCanvas.height, width: width / roiCanvas.width, height: height / roiCanvas.height };
        if (roiBeingSelected === 'reaction') { reactionROI = relativeROI; reactionCoordsSpan.textContent = `(${Math.round(x)}, ${Math.round(y)}) ${Math.round(width)}x${Math.round(height)}px`; }
        else if (roiBeingSelected === 'background') { backgroundROI = relativeROI; backgroundCoordsSpan.textContent = `(${Math.round(x)}, ${Math.round(y)}) ${Math.round(width)}x${Math.round(height)}px`; }
        console.log(`  - Drawing ended. ROI calculated and saved for ${roiBeingSelected}.`);
        checkEnableAnalyzeButton();
    } else { console.log("  - Drawing ended. ROI too small, ignored."); }
    redrawROIs(); stopSelectingROI();
}

function handleMouseOut(event) { if (drawing) { handleMouseUp(event); } }


// --- Analysis Functions ---
// *** ESTA ES LA VERSIÓN DE startAnalysis CON LA CORRECCIÓN PARA videoDuration ***
async function startAnalysis() {
    console.log(">>> Entering startAnalysis function...");

    if (!cvReady || typeof cv === 'undefined' || !cv.imread) {
         console.error("Analysis attempt failed inside startAnalysis: OpenCV is not ready.");
         alert("Error: OpenCV no está completamente inicializado. Espera o recarga.");
         analysisFinished(true); return;
    }
    if (analyzeBtn.disabled) {
         console.warn("startAnalysis called but button is disabled. Exiting."); return;
    }

    // *** Re-obtener y validar la duración AHORA ***
    videoDuration = videoPlayer.duration;
    console.log(`Re-checking video duration inside startAnalysis: ${videoDuration}`);

    if (!videoDuration || !isFinite(videoDuration) || videoDuration <= 0) {
        console.error("Invalid video duration detected before analysis:", videoDuration);
        alert("Error: No se pudo obtener una duración válida del video para el análisis. Intenta grabar de nuevo.");
        analysisFinished(true); return;
    }
    // *** FIN VALIDACIÓN ***

    console.log("Starting analysis process...");
    resetAnalysis();
    analyzeBtn.disabled = true;
    enableRoiButtons(false);
    startRecordBtn.disabled = true; stopRecordBtn.disabled = true;
    analysisProgress.style.display = 'block'; analysisStatus.textContent = 'Analizando...'; analysisStatus.style.color = 'orange';

    const intervalSeconds = 0.5; let currentTime = 0;
    const analysisEndTime = videoDuration - 0.01; // Usar duración validada
    console.log(` - Calculated analysisEndTime: ${analysisEndTime?.toFixed(2)}`);

    if (typeof analysisEndTime === 'undefined' || isNaN(analysisEndTime) || analysisEndTime < 0) {
         console.error("Invalid analysisEndTime calculated:", analysisEndTime);
         alert("Error: Cálculo de tiempo final inválido.");
         analysisFinished(true); return;
    }

    const totalFramesToProcess = Math.max(1, Math.ceil(analysisEndTime / intervalSeconds));
    let framesProcessed = 0;
    if (!videoPlayer.paused) { videoPlayer.pause(); }

    // Bucle principal (definición)
    async function processNextFrame() {
         console.log(`>>> TOP of processNextFrame [${currentTime?.toFixed(2)}s]`);
         console.log(`[${currentTime.toFixed(2)}s] Entering processNextFrame.`);
         if (currentTime > analysisEndTime) { analysisFinished(); return; }
         if (!processCanvas.width || !processCanvas.height) { /* ... error handling ... */ return; }
         console.log(`[${currentTime.toFixed(2)}s] Setting currentTime.`);
         videoPlayer.currentTime = currentTime;
         try {
             console.log(`[${currentTime.toFixed(2)}s] Waiting for 'seeked' event...`);
             await new Promise((resolve, reject) => { /* ... promise con timeout ... */
                const seekTimeout=5000; let timeoutId=setTimeout(()=>{console.error(`[${currentTime.toFixed(2)}s] Seek timed out!`); reject(new Error(`Timeout esperando 'seeked'...`));},seekTimeout);
                const seekedListener=()=>{clearTimeout(timeoutId); console.log(`[${currentTime.toFixed(2)}s] 'seeked' event received.`); videoPlayer.removeEventListener('seeked', seekedListener); videoPlayer.removeEventListener('error', errorListener); setTimeout(resolve, 60);};
                const errorListener=(e)=>{clearTimeout(timeoutId); console.error(`[${currentTime.toFixed(2)}s] Video error during seek:`, e); reject(new Error("Error del video durante búsqueda"));};
                videoPlayer.addEventListener('seeked', seekedListener, { once: true }); videoPlayer.addEventListener('error', errorListener, { once: true });
             });
             console.log(`[${currentTime.toFixed(2)}s] 'seeked' Promise resolved.`);
         } catch (error) { /* ... error handling ... */ return; }
         try {
             console.log(`[${currentTime.toFixed(2)}s] Calling drawImage.`);
             processCtx.drawImage(videoPlayer, 0, 0, processCanvas.width, processCanvas.height);
             console.log(`[${currentTime.toFixed(2)}s] drawImage finished.`);
         } catch(drawError) { /* ... error handling ... */ return; }
         try {
             console.log(`[${currentTime.toFixed(2)}s] Starting OpenCV processing...`);
             let frameMat = cv.imread(processCanvas);
             if (frameMat.empty()) { /* ... skip ... */ return; }
             let rgbFrameMat = new cv.Mat(); cv.cvtColor(frameMat, rgbFrameMat, cv.COLOR_RGBA2RGB);
             const reactionAbs = getAbsoluteCoordsForProcessing(reactionROI); const backgroundAbs = getAbsoluteCoordsForProcessing(backgroundROI);
             if (!reactionAbs || !backgroundAbs || reactionAbs.width <= 0 || reactionAbs.height <= 0 || backgroundAbs.width <= 0 || backgroundAbs.height <= 0) { /* ... skip ... */ return; }
             let reactionRect = new cv.Rect(reactionAbs.x, reactionAbs.y, reactionAbs.width, reactionAbs.height); let reactionRoiMat = rgbFrameMat.roi(reactionRect);
             let reactionHsvMat = new cv.Mat(); cv.cvtColor(reactionRoiMat, reactionHsvMat, cv.COLOR_RGB2HSV); let reactionMean = cv.mean(reactionHsvMat); const avgHueReaction = reactionMean[0];
             let backgroundRect = new cv.Rect(backgroundAbs.x, backgroundAbs.y, backgroundAbs.width, backgroundAbs.height); let backgroundRoiMat = rgbFrameMat.roi(backgroundRect);
             let backgroundHsvMat = new cv.Mat(); cv.cvtColor(backgroundRoiMat, backgroundHsvMat, cv.COLOR_RGB2HSV); let backgroundMean = cv.mean(backgroundHsvMat); const avgHueBackground = backgroundMean[0];
             console.log(`[${currentTime.toFixed(2)}s] OpenCV processing done. Hues: R=${avgHueReaction.toFixed(1)}, B=${avgHueBackground.toFixed(1)}`);
             analysisData.push({ time: currentTime.toFixed(2), hueReaction: avgHueReaction.toFixed(2), hueBackground: avgHueBackground.toFixed(2) });
             reactionRoiMat.delete(); reactionHsvMat.delete(); backgroundRoiMat.delete(); backgroundHsvMat.delete(); rgbFrameMat.delete(); frameMat.delete(); // Cleanup
         } catch (cvError) { /* ... error handling ... */ return; }
         framesProcessed++; analysisProgress.value = Math.min(100, (framesProcessed / totalFramesToProcess) * 100);
         console.log(`[${currentTime.toFixed(2)}s] Scheduling next frame.`);
         scheduleNext();
    } // Fin processNextFrame

    function scheduleNext() { currentTime += intervalSeconds; setTimeout(processNextFrame, 0); }

    // Llamada inicial
    console.log("[Analysis Start] ABOUT TO CALL processNextFrame for the first time.");
    try { processNextFrame(); console.log("[Analysis Start] Initial call to processNextFrame finished executing synchronously."); }
    catch (initialError) { console.error("Error DURING the very first call:", initialError); analysisFinished(true); }
} // Fin de startAnalysis


// --- Initial Page Setup ---
function initializeApp() {
    enableRoiButtons(false); analyzeBtn.disabled = true; downloadCsvBtn.disabled = true;
    stopRecordBtn.disabled = true; startRecordBtn.disabled = false;
    console.log("Initial app state set (buttons disabled).");
}
function initializeAppOpenCvDependent() {
    console.log("OpenCV ready. Checking analyze button status."); checkEnableAnalyzeButton();
}

// Run initial setup
initializeApp();
