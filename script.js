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
        console.log('OpenCV.js Runtime Initialized - Callback received.');
        // Esperar un ciclo de eventos para asegurar que todo esté estable
        setTimeout(() => {
            console.log('Checking for cv object after short delay...');
            if (typeof cv !== 'undefined') {
                // Comprobar si cv es una Promesa
                if (typeof cv.then === 'function') {
                    console.log('cv object is a Promise. Waiting for it to resolve...');
                    openCvStatus.textContent = 'OpenCV: Finalizando inicialización...';
                    cv.then((finalCvObject) => {
                        console.log('OpenCV Promise resolved.');
                        if (finalCvObject && finalCvObject.imread) {
                            cv = finalCvObject; // Actualizar la variable global
                            console.log('OpenCV.js is fully ready (Promise resolved). Global cv object updated.');
                            openCvStatus.textContent = 'OpenCV.js ¡Listo!';
                            openCvStatus.style.color = 'green';
                            cvReady = true;
                            initializeAppOpenCvDependent();
                        } else {
                            console.error('OpenCV Promise resolved, but the result is not the expected cv object:', finalCvObject);
                            onOpenCvErrorInternal("El objeto final de OpenCV no es válido después de resolver la promesa.");
                        }
                    }).catch((err) => {
                        console.error('OpenCV Promise was rejected:', err);
                        onOpenCvErrorInternal("Error al finalizar la inicialización de OpenCV (Promesa rechazada).");
                    });
                }
                // Comprobación original (fallback)
                else if (cv.imread) {
                    console.log('OpenCV.js is fully ready (Direct object).');
                    openCvStatus.textContent = 'OpenCV.js ¡OK!';
                    openCvStatus.style.color = 'green';
                    cvReady = true;
                    initializeAppOpenCvDependent();
                } else {
                     console.error('cv object exists but is incomplete and not a Promise:', cv);
                    onOpenCvErrorInternal("Objeto cv encontrado pero incompleto.");
                }
            } else {
                console.error('cv object is undefined even after delay.');
                onOpenCvErrorInternal("Variable global cv no definida.");
            }
        }, 50); // Retraso ligero
    },
     // Funciones print, printErr, setStatus, etc. (sin cambios, puedes copiarlas de versiones anteriores si las necesitas)
    print: function(text) { if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' '); console.log("OpenCV print:", text); },
    printErr: function(text) { if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' '); console.error("OpenCV printErr:", text); onOpenCvErrorInternal("Error durante inicialización de OpenCV: " + text); },
    setStatus: function(text) { /* ... (código de setStatus para progreso) ... */ },
    totalDependencies: 0,
    monitorRunDependencies: function(left) { /* ... (código de monitorRunDependencies) ... */ }
};

// Función interna para manejar errores de OpenCV consistentemente
function onOpenCvErrorInternal(errorMessage) {
    console.error('OpenCV Error:', errorMessage);
    openCvStatus.textContent = `Error de OpenCV. El análisis no funcionará. Recarga la página.`;
    openCvStatus.style.color = 'red';
    cvReady = false;
    analyzeBtn.disabled = true;
}

// Indicar estado inicial de carga de OpenCV
openCvStatus.textContent = 'Cargando OpenCV.js...';
openCvStatus.style.color = 'orange';
Module.setStatus('Cargando OpenCV.js...');


// --- Event Listeners ---
videoInput.addEventListener('change', handleVideoUpload);
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
        mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
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
        analyzeBtn.disabled = true;
        enableRoiButtons(false); // <-- Asegurar que estén deshabilitados al grabar
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
    if (event.data.size > 0) { recordedChunks.push(event.data); }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        console.log('MediaRecorder stopping...');
    } else {
        if (mediaStream) { mediaStream.getTracks().forEach(track => track.stop()); }
        livePreview.srcObject = null;
        startRecordBtn.disabled = false;
        stopRecordBtn.disabled = true;
        recordingStatus.textContent = '';
        videoInput.style.display = 'block';
        checkEnableAnalyzeButton();
    }
}

// Modificado para usar FileReader y Data URL Y ASEGURAR HABILITACIÓN DE BOTONES
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
        enableRoiButtons(false); // Asegurar deshabilitación si no hay datos
        checkEnableAnalyzeButton();
        return;
    }

    const blob = new Blob(recordedChunks, { type: recordedChunks[0]?.type || 'video/webm' });
    videoFile = blob; // Store blob

    console.log("Recorded Blob created, size:", blob.size, "type:", blob.type);
    console.log("Now converting Blob to Data URL for analysis...");

    const reader = new FileReader();
    reader.onload = function(e) {
        console.log("Blob successfully read as Data URL.");
        const dataUrl = e.target.result;
        if (videoPlayer.src.startsWith('blob:')) { URL.revokeObjectURL(videoPlayer.src); }
        videoPlayer.src = dataUrl; // Asignar Data URL

        // Configuración DESPUÉS de que la Data URL está en el player
        resetAnalysis();
        clearROIs(false); // No redibujar aún
        reactionROI = null; backgroundROI = null;
        reactionCoordsSpan.textContent = "No definida"; backgroundCoordsSpan.textContent = "No definida";
        enableRoiButtons(false); // Mantener deshabilitado hasta que carguen metadatos

        videoPlayer.onloadedmetadata = () => {
            console.log("onloadedmetadata for recorded video triggered."); // Log clave
            videoDuration = videoPlayer.duration;
            const videoWidth = videoPlayer.videoWidth;
            const videoHeight = videoPlayer.videoHeight;

            if (!videoWidth || !videoHeight || videoWidth <= 0 || videoHeight <= 0) { // Check robusto
                console.error("ERROR: Invalid video dimensions on loadedmetadata for recorded video:", videoWidth, videoHeight);
                alert("Error: No se pudieron obtener dimensiones válidas del video grabado.");
                enableRoiButtons(false); // Asegurar deshabilitación
                checkEnableAnalyzeButton();
                return;
            }

            const displayWidth = videoPlayer.clientWidth || 640;
            const displayHeight = (videoHeight / videoWidth) * displayWidth;
            // Validar dimensiones del canvas antes de asignar
            if (displayWidth > 0 && displayHeight > 0) {
                 roiCanvas.width = displayWidth; roiCanvas.height = displayHeight;
                 processCanvas.width = videoWidth; processCanvas.height = videoHeight;
                 console.log(`RECORDED video loaded: D=${videoDuration.toFixed(1)}s, Dim=${videoWidth}x${videoHeight}, Display=${displayWidth}x${displayHeight.toFixed(0)}`);

                // *** HABILITAR BOTONES AQUÍ ***
                console.log("Attempting to enable ROI buttons...");
                enableRoiButtons(true); // <--- Habilitar AHORA
                console.log("ROI buttons should be enabled now.");

                 clearROIs(true); // Limpiar y redibujar canvas ahora que tiene tamaño
            } else {
                 console.error("ERROR: Invalid calculated display dimensions:", displayWidth, displayHeight);
                 alert("Error: Dimensiones de visualización inválidas.");
                 enableRoiButtons(false);
            }
            checkEnableAnalyzeButton(); // Revisar estado del botón de análisis
        };

        videoPlayer.onerror = (e) => {
            console.error("Error loading recorded video (DataURL) into player:", e);
            alert("Error trying to load recorded video from Data URL.");
            enableRoiButtons(false);
            checkEnableAnalyzeButton();
        };
        videoPlayer.onseeked = () => { if (reactionROI || backgroundROI) { redrawROIs(); } };

        // No llamar a checkEnableAnalyzeButton aquí directamente, esperar a onloadedmetadata
    };
    reader.onerror = function(e) {
        console.error("FileReader error reading Blob:", e);
        alert("Error reading the recorded video data.");
        enableRoiButtons(false);
        checkEnableAnalyzeButton();
    };
    reader.readAsDataURL(blob);
    recordedChunks = [];
}


// --- Video Upload Function ---
// ASEGURAR HABILITACIÓN DE BOTONES AQUÍ TAMBIÉN
function handleVideoUpload(event) {
    stopRecording();
    videoFile = event.target.files[0];
    if (!videoFile) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        if (videoPlayer.src.startsWith('blob:')) { URL.revokeObjectURL(videoPlayer.src); }
        videoPlayer.src = e.target.result; // Asignar Data URL
    }
    reader.readAsDataURL(videoFile);

    resetAnalysis();
    clearROIs(false);
    reactionROI = null; backgroundROI = null;
    reactionCoordsSpan.textContent = "No definida"; backgroundCoordsSpan.textContent = "No definida";
    enableRoiButtons(false); // Deshabilitar hasta que carguen metadatos

    videoPlayer.onloadedmetadata = () => {
        console.log("onloadedmetadata for uploaded video triggered."); // Log clave
        videoDuration = videoPlayer.duration;
        const videoWidth = videoPlayer.videoWidth;
        const videoHeight = videoPlayer.videoHeight;

        if (!videoWidth || !videoHeight || videoWidth <= 0 || videoHeight <= 0) { // Check robusto
            console.error("ERROR: Invalid video dimensions on loadedmetadata for uploaded video:", videoWidth, videoHeight);
            alert("Error: No se pudieron obtener dimensiones válidas del video subido.");
            enableRoiButtons(false);
            checkEnableAnalyzeButton();
            return;
        }

        const displayWidth = videoPlayer.clientWidth || 640;
        const displayHeight = (videoHeight / videoWidth) * displayWidth;
        // Validar dimensiones del canvas antes de asignar
        if(displayWidth > 0 && displayHeight > 0) {
            roiCanvas.width = displayWidth; roiCanvas.height = displayHeight;
            processCanvas.width = videoWidth; processCanvas.height = videoHeight;
            console.log(`UPLOADED video loaded: D=${videoDuration.toFixed(1)}s, Dim=${videoWidth}x${videoHeight}, Display=${displayWidth}x${displayHeight.toFixed(0)}`);

            // *** HABILITAR BOTONES AQUÍ ***
            console.log("Attempting to enable ROI buttons...");
            enableRoiButtons(true); // <--- Habilitar AHORA
            console.log("ROI buttons should be enabled now.");

            clearROIs(true); // Limpiar y redibujar canvas ahora
        } else {
            console.error("ERROR: Invalid calculated display dimensions for upload:", displayWidth, displayHeight);
            alert("Error: Dimensiones de visualización inválidas.");
            enableRoiButtons(false);
        }
        checkEnableAnalyzeButton(); // Revisar estado del botón de análisis
    };

    videoPlayer.onerror = (e) => {
        console.error("Error loading uploaded video:", e);
        alert("Error loading uploaded video.");
        enableRoiButtons(false);
        checkEnableAnalyzeButton();
    };
    videoPlayer.onseeked = () => { if (reactionROI || backgroundROI) { redrawROIs(); } };

    // No llamar checkEnableAnalyzeButton aquí, esperar a onloadedmetadata
}


// --- ROI Selection Functions ---
// Revisión de esta función para claridad
function enableRoiButtons(enabled) {
    const reason = enabled ? "Enabling" : "Disabling";
    console.log(`${reason} ROI buttons. Enabled = ${enabled}`); // Log aquí también
    selectReactionBtn.disabled = !enabled;
    selectBackgroundBtn.disabled = !enabled;
    clearRoisBtn.disabled = !enabled;
    // Actualizar cursor del canvas de ROI
    roiCanvas.style.cursor = enabled ? 'default' : 'not-allowed';
     if (!enabled) {
         stopSelectingROI(); // Asegurarse de detener el modo selección si se deshabilitan
     }
}

function startSelectingROI(type) { /* ... (sin cambios) ... */ }
function stopSelectingROI() { /* ... (sin cambios) ... */ }
function handleMouseDown(event) { /* ... (sin cambios) ... */ }
function handleMouseMove(event) { /* ... (sin cambios) ... */ }
function handleMouseUp(event) { /* ... (sin cambios) ... */ }
function handleMouseOut(event) { /* ... (sin cambios) ... */ }
function redrawROIs(isDrawingSelection = false) { /* ... (sin cambios) ... */ }
function getAbsoluteCoords(relativeROI) { /* ... (sin cambios) ... */ }
function clearROIs(doRedraw = true) { /* ... (sin cambios) ... */ }


// --- Analysis Functions ---
function checkEnableAnalyzeButton() {
    const canAnalyze = cvReady && videoFile && reactionROI && backgroundROI && (!mediaRecorder || mediaRecorder.state === 'inactive');
    analyzeBtn.disabled = !canAnalyze;
    console.log(`Checking analyze button: cvReady=${cvReady}, videoFile=${!!videoFile}, reactionROI=${!!reactionROI}, backgroundROI=${!!backgroundROI}, recorderInactive=${!mediaRecorder || mediaRecorder.state === 'inactive'}. Result disabled=${analyzeBtn.disabled}`);
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

// Función startAnalysis con los logs de depuración (ya estaba completa)
async function startAnalysis() {
    // Robust check at the very beginning
    if (!cvReady || typeof cv === 'undefined' || !cv.imread) {
         console.error("Analysis attempt failed: OpenCV is not ready or cv.imread is missing.");
         alert("Error: OpenCV no está completamente inicializado. Espera o recarga.");
         analysisFinished(true);
         return;
    }
     if (analyzeBtn.disabled) {
         console.warn("Analysis button clicked while disabled.");
         return;
     }

    console.log("Starting analysis...");
    resetAnalysis();
    analyzeBtn.disabled = true;
    enableRoiButtons(false);
    startRecordBtn.disabled = true;
    stopRecordBtn.disabled = true;
    analysisProgress.style.display = 'block';
    analysisStatus.textContent = 'Analizando...';
    analysisStatus.style.color = 'orange';

    const intervalSeconds = 0.5;
    let currentTime = 0;
    const analysisEndTime = videoDuration > 0.1 ? videoDuration - 0.01 : 0;
    const totalFramesToProcess = Math.max(1, Math.ceil(analysisEndTime / intervalSeconds));
    let framesProcessed = 0;

    if (!videoPlayer.paused) { videoPlayer.pause(); }

    // Bucle principal de procesamiento
    async function processNextFrame() {
        // --- INICIO DEBUG LOGS ---
        console.log(`[${currentTime.toFixed(2)}s] Entering processNextFrame.`);
        // --- FIN DEBUG LOGS ---

        if (currentTime > analysisEndTime) {
            analysisFinished();
            return;
        }
        if (!processCanvas.width || !processCanvas.height) { /* ... error handling ... */ return; }

        // --- INICIO DEBUG LOGS ---
        console.log(`[${currentTime.toFixed(2)}s] Setting currentTime.`);
        // --- FIN DEBUG LOGS ---
        videoPlayer.currentTime = currentTime;

        try {
            // --- INICIO DEBUG LOGS ---
            console.log(`[${currentTime.toFixed(2)}s] Waiting for 'seeked' event...`);
            // --- FIN DEBUG LOGS ---
            await new Promise((resolve, reject) => { /* ... promise con timeout ... */
                 const seekTimeout = 5000;
                 let timeoutId = setTimeout(() => { console.error(`[${currentTime.toFixed(2)}s] Seek timed out!`); reject(new Error(`Timeout esperando 'seeked' en ${currentTime.toFixed(2)}s`)); }, seekTimeout);
                 const seekedListener = () => { clearTimeout(timeoutId); console.log(`[${currentTime.toFixed(2)}s] 'seeked' event received.`); videoPlayer.removeEventListener('seeked', seekedListener); videoPlayer.removeEventListener('error', errorListener); setTimeout(resolve, 60); };
                 const errorListener = (e) => { clearTimeout(timeoutId); console.error(`[${currentTime.toFixed(2)}s] Video element error during seek:`, e); reject(new Error("Error del elemento de video durante la búsqueda")); };
                 videoPlayer.addEventListener('seeked', seekedListener, { once: true });
                 videoPlayer.addEventListener('error', errorListener, { once: true });
            });
            // --- INICIO DEBUG LOGS ---
             console.log(`[${currentTime.toFixed(2)}s] 'seeked' Promise resolved.`);
            // --- FIN DEBUG LOGS ---
        } catch (error) { /* ... error handling ... */ return; }

        try {
             // --- INICIO DEBUG LOGS ---
             console.log(`[${currentTime.toFixed(2)}s] Calling drawImage.`);
             // --- FIN DEBUG LOGS ---
              processCtx.drawImage(videoPlayer, 0, 0, processCanvas.width, processCanvas.height);
             // --- INICIO DEBUG LOGS ---
             console.log(`[${currentTime.toFixed(2)}s] drawImage finished.`);
             // --- FIN DEBUG LOGS ---
         } catch(drawError) { /* ... error handling ... */ return; }

        try {
            // --- INICIO DEBUG LOGS ---
             console.log(`[${currentTime.toFixed(2)}s] Starting OpenCV processing...`);
            // --- FIN DEBUG LOGS ---
            let frameMat = cv.imread(processCanvas);
            if (frameMat.empty()) { /* ... skip frame ... */ return; }
            let rgbFrameMat = new cv.Mat();
            cv.cvtColor(frameMat, rgbFrameMat, cv.COLOR_RGBA2RGB);
            const reactionAbs = getAbsoluteCoordsForProcessing(reactionROI);
            const backgroundAbs = getAbsoluteCoordsForProcessing(backgroundROI);
            if (!reactionAbs || !backgroundAbs || reactionAbs.width <= 0 || reactionAbs.height <= 0 || backgroundAbs.width <= 0 || backgroundAbs.height <= 0) { /* ... skip frame ... */ return; }
            let reactionRect = new cv.Rect(reactionAbs.x, reactionAbs.y, reactionAbs.width, reactionAbs.height);
            let reactionRoiMat = rgbFrameMat.roi(reactionRect);
            let reactionHsvMat = new cv.Mat();
            cv.cvtColor(reactionRoiMat, reactionHsvMat, cv.COLOR_RGB2HSV);
            let reactionMean = cv.mean(reactionHsvMat); const avgHueReaction = reactionMean[0];
            let backgroundRect = new cv.Rect(backgroundAbs.x, backgroundAbs.y, backgroundAbs.width, backgroundAbs.height);
            let backgroundRoiMat = rgbFrameMat.roi(backgroundRect);
            let backgroundHsvMat = new cv.Mat();
            cv.cvtColor(backgroundRoiMat, backgroundHsvMat, cv.COLOR_RGB2HSV);
            let backgroundMean = cv.mean(backgroundHsvMat); const avgHueBackground = backgroundMean[0];
             // --- INICIO DEBUG LOGS ---
             console.log(`[${currentTime.toFixed(2)}s] OpenCV processing done. Hues: R=${avgHueReaction.toFixed(1)}, B=${avgHueBackground.toFixed(1)}`);
             // --- FIN DEBUG LOGS ---
             analysisData.push({ time: currentTime.toFixed(2), hueReaction: avgHueReaction.toFixed(2), hueBackground: avgHueBackground.toFixed(2) });
            // --- OpenCV Mat Cleanup ---
            reactionRoiMat.delete(); reactionHsvMat.delete(); backgroundRoiMat.delete(); backgroundHsvMat.delete(); rgbFrameMat.delete(); frameMat.delete();
        } catch (cvError) { /* ... error handling ... */ return; }

        framesProcessed++;
        analysisProgress.value = Math.min(100, (framesProcessed / totalFramesToProcess) * 100);
        // --- INICIO DEBUG LOGS ---
        console.log(`[${currentTime.toFixed(2)}s] Scheduling next frame.`);
        // --- FIN DEBUG LOGS ---
        scheduleNext();
    } // Fin de processNextFrame

    function scheduleNext() { currentTime += intervalSeconds; setTimeout(processNextFrame, 0); }

    console.log("[Analysis Start] Calling processNextFrame for the first time.");
    processNextFrame();
} // Fin de startAnalysis


function getAbsoluteCoordsForProcessing(relativeROI) { /* ... (sin cambios) ... */ }

function analysisFinished(errorOccurred = false) {
    console.log(`Analysis finished. ${errorOccurred ? 'With errors.' : 'Successfully.'}`);
    analysisProgress.style.display = 'none';
    // Re-enable buttons carefully based on state
    analyzeBtn.disabled = false; // Permitir reintentar análisis
    enableRoiButtons(!!videoFile); // Habilitar botones ROI si hay video cargado
    startRecordBtn.disabled = false;
    stopRecordBtn.disabled = true;

    if (!errorOccurred && analysisData.length > 0) { /* ... mostrar gráfico ... */ }
    else if (!errorOccurred) { /* ... mensaje sin datos ... */ }
    else { /* ... mensaje de error ... */ }
    checkEnableAnalyzeButton(); // Revisión final del botón de análisis
}

function drawChart() { /* ... (sin cambios) ... */ }
function downloadCSV() { /* ... (sin cambios) ... */ }

// --- Initial Page Setup ---
function initializeApp() {
    // Estado inicial donde TODO está deshabilitado hasta que se cargue video y OpenCV
    enableRoiButtons(false);
    analyzeBtn.disabled = true;
    downloadCsvBtn.disabled = true;
    stopRecordBtn.disabled = true;
    startRecordBtn.disabled = false;
    console.log("Initial app state set (buttons disabled).");
}

function initializeAppOpenCvDependent() {
    console.log("OpenCV ready. Checking analyze button status (ROI buttons depend on video load).");
    checkEnableAnalyzeButton(); // Solo afecta al botón de análisis
}

// Run initial setup on script load
initializeApp();
