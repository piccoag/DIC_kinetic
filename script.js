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

// --- State Variables ---
let cvReady = false;
let videoFile = null;
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

// --- OpenCV Loading ---
function onOpenCvReady() {
    console.log('OpenCV.js is ready.');
    openCvStatus.textContent = 'OpenCV.js cargado.';
    openCvStatus.style.color = 'green';
    cvReady = true;
    checkEnableAnalyzeButton(); // Check if we can enable analyze now
}

function onOpenCvError() {
    console.error('Error loading OpenCV.js');
    openCvStatus.textContent = 'Error al cargar OpenCV.js. El análisis no funcionará.';
    openCvStatus.style.color = 'red';
}

// --- Event Listeners ---
videoInput.addEventListener('change', handleVideoUpload);
selectReactionBtn.addEventListener('click', () => startSelectingROI('reaction'));
selectBackgroundBtn.addEventListener('click', () => startSelectingROI('background'));
clearRoisBtn.addEventListener('click', clearROIs);
analyzeBtn.addEventListener('click', startAnalysis);
downloadCsvBtn.addEventListener('click', downloadCSV);

// ROI Canvas Mouse Events
roiCanvas.addEventListener('mousedown', handleMouseDown);
roiCanvas.addEventListener('mousemove', handleMouseMove);
roiCanvas.addEventListener('mouseup', handleMouseUp);
roiCanvas.addEventListener('mouseout', handleMouseOut); // Handle leaving canvas while drawing


// --- Functions ---

function handleVideoUpload(event) {
    videoFile = event.target.files[0];
    if (!videoFile) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        videoPlayer.src = e.target.result;
    }
    reader.readAsDataURL(videoFile); // Load video data

    // Reset previous state
    resetAnalysis();
    clearROIs(false); // Clear ROIs but don't redraw yet
    reactionROI = null;
    backgroundROI = null;
    reactionCoordsSpan.textContent = "No definida";
    backgroundCoordsSpan.textContent = "No definida";


    videoPlayer.onloadedmetadata = () => {
        videoDuration = videoPlayer.duration;
        // Set canvas size to match video aspect ratio for correct drawing
        const videoWidth = videoPlayer.videoWidth;
        const videoHeight = videoPlayer.videoHeight;
        const displayWidth = videoPlayer.clientWidth; // Actual display size
        roiCanvas.width = displayWidth;
        roiCanvas.height = (videoHeight / videoWidth) * displayWidth;
        // Also set the hidden process canvas size (crucial for OpenCV)
        processCanvas.width = videoWidth;
        processCanvas.height = videoHeight;

        console.log(`Video cargado: Duración ${videoDuration.toFixed(2)}s, Dimensiones ${videoWidth}x${videoHeight}`);
        enableRoiButtons(true);
        checkEnableAnalyzeButton();
    };

    videoPlayer.onseeked = () => {
        // Redraw ROIs if they exist when seeking
        if (reactionROI || backgroundROI) {
            redrawROIs();
        }
    };
}

function enableRoiButtons(enabled) {
    selectReactionBtn.disabled = !enabled;
    selectBackgroundBtn.disabled = !enabled;
    clearRoisBtn.disabled = !enabled;
}

function startSelectingROI(type) {
    roiBeingSelected = type;
    selectReactionBtn.classList.toggle('active', type === 'reaction');
    selectBackgroundBtn.classList.toggle('active', type === 'background');
    console.log(`Seleccionando ROI: ${type}`);
    roiCanvas.style.cursor = 'crosshair';
}

function stopSelectingROI() {
    roiBeingSelected = null;
    selectReactionBtn.classList.remove('active');
    selectBackgroundBtn.classList.remove('active');
    roiCanvas.style.cursor = 'default';
}

function handleMouseDown(event) {
    if (!roiBeingSelected || drawing) return;
    drawing = true;
    const rect = roiCanvas.getBoundingClientRect();
    startX = event.clientX - rect.left;
    startY = event.clientY - rect.top;
    currentX = startX;
    currentY = startY;
    // console.log(`Mouse Down: ${startX}, ${startY}`);
}

function handleMouseMove(event) {
    if (!drawing || !roiBeingSelected) return;
    const rect = roiCanvas.getBoundingClientRect();
    currentX = event.clientX - rect.left;
    currentY = event.clientY - rect.top;

    // Clear previous drawing and redraw existing ROIs + current selection
    redrawROIs(true); // Pass true to indicate we are currently drawing
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

    // Only save if area is significant
    if (width > 5 && height > 5) {
        // Store ROI coordinates relative to canvas size (%)
        const relativeROI = {
            x: x / roiCanvas.width,
            y: y / roiCanvas.height,
            width: width / roiCanvas.width,
            height: height / roiCanvas.height
        };

        if (roiBeingSelected === 'reaction') {
            reactionROI = relativeROI;
            reactionCoordsSpan.textContent = `(${Math.round(x)}, ${Math.round(y)}) - ${Math.round(width)}x${Math.round(height)}px`;
            console.log("Reaction ROI set:", reactionROI);
        } else if (roiBeingSelected === 'background') {
            backgroundROI = relativeROI;
            backgroundCoordsSpan.textContent = `(${Math.round(x)}, ${Math.round(y)}) - ${Math.round(width)}x${Math.round(height)}px`;
             console.log("Background ROI set:", backgroundROI);
        }
        checkEnableAnalyzeButton();
    } else {
         console.log("ROI demasiado pequeño, ignorado.");
    }


    redrawROIs(); // Redraw final state
    stopSelectingROI();
}

function handleMouseOut(event) {
    // If drawing and mouse leaves canvas, treat as mouse up
    if (drawing) {
        handleMouseUp(event);
    }
}

function redrawROIs(isDrawingSelection = false) {
    roiCtx.clearRect(0, 0, roiCanvas.width, roiCanvas.height);
    roiCtx.lineWidth = 2;

    // Draw defined Reaction ROI
    if (reactionROI) {
        roiCtx.strokeStyle = 'rgba(255, 0, 0, 0.8)'; // Red
        const absCoords = getAbsoluteCoords(reactionROI);
        roiCtx.strokeRect(absCoords.x, absCoords.y, absCoords.width, absCoords.height);
    }

    // Draw defined Background ROI
    if (backgroundROI) {
        roiCtx.strokeStyle = 'rgba(0, 0, 255, 0.8)'; // Blue
        const absCoords = getAbsoluteCoords(backgroundROI);
        roiCtx.strokeRect(absCoords.x, absCoords.y, absCoords.width, absCoords.height);
    }

    // Draw the rectangle currently being selected
    if (isDrawingSelection && drawing && roiBeingSelected) {
        const currentWidth = currentX - startX;
        const currentHeight = currentY - startY;
        roiCtx.strokeStyle = (roiBeingSelected === 'reaction') ? 'rgba(255, 0, 0, 0.5)' : 'rgba(0, 0, 255, 0.5)';
        roiCtx.setLineDash([5, 5]); // Dashed line while drawing
        roiCtx.strokeRect(startX, startY, currentWidth, currentHeight);
        roiCtx.setLineDash([]); // Reset dash pattern
    }
}

// Helper to convert relative ROI coordinates to absolute pixel coordinates for drawing
function getAbsoluteCoords(relativeROI) {
    if (!relativeROI) return null;
    return {
        x: relativeROI.x * roiCanvas.width,
        y: relativeROI.y * roiCanvas.height,
        width: relativeROI.width * roiCanvas.width,
        height: relativeROI.height * roiCanvas.height
    };
}

function clearROIs(doRedraw = true) {
    reactionROI = null;
    backgroundROI = null;
    reactionCoordsSpan.textContent = "No definida";
    backgroundCoordsSpan.textContent = "No definida";
    if (doRedraw) {
        roiCtx.clearRect(0, 0, roiCanvas.width, roiCanvas.height);
    }
    checkEnableAnalyzeButton();
    console.log("ROIs cleared.");
}

function checkEnableAnalyzeButton() {
    // Enable Analyze button only if OpenCV is ready, video loaded, and both ROIs defined
    analyzeBtn.disabled = !(cvReady && videoFile && reactionROI && backgroundROI);
}

function resetAnalysis() {
    analysisData = [];
    analysisProgress.style.display = 'none';
    analysisProgress.value = 0;
    analysisStatus.textContent = '';
    chartContainer.style.display = 'none';
    downloadCsvBtn.disabled = true;
    if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
    }
}

async function startAnalysis() {
    if (!cvReady || !videoFile || !reactionROI || !backgroundROI) {
        alert("Asegúrate de que OpenCV esté cargado, hayas subido un video y definido ambos ROIs.");
        return;
    }

    console.log("Iniciando análisis...");
    resetAnalysis();
    analyzeBtn.disabled = true;
    enableRoiButtons(false); // Disable ROI buttons during analysis
    analysisProgress.style.display = 'block';
    analysisStatus.textContent = 'Analizando...';

    // Define processing interval (e.g., every 0.5 seconds)
    const intervalSeconds = 0.5;
    let currentTime = 0;
    const totalFramesToProcess = Math.ceil(videoDuration / intervalSeconds);
    let framesProcessed = 0;

    // Use a recursive function with async/await for seeking
    async function processNextFrame() {
        if (currentTime > videoDuration) {
            analysisFinished();
            return;
        }

        // Seek to the desired time
        videoPlayer.currentTime = currentTime;

        // Wait for the 'seeked' event
        await new Promise(resolve => {
            const seekedListener = () => {
                videoPlayer.removeEventListener('seeked', seekedListener);
                resolve();
            };
            videoPlayer.addEventListener('seeked', seekedListener);
        });

        // Draw current frame onto the hidden processing canvas
        processCtx.drawImage(videoPlayer, 0, 0, processCanvas.width, processCanvas.height);

        // Process with OpenCV
        try {
            let frameMat = cv.imread(processCanvas); // Read RGBA frame
            if (frameMat.empty()) {
                console.warn(`Frame vacío en tiempo ${currentTime.toFixed(2)}s`);
                frameMat.delete();
                scheduleNext(); // Skip frame, continue
                return;
            }

            let rgbFrameMat = new cv.Mat();
            cv.cvtColor(frameMat, rgbFrameMat, cv.COLOR_RGBA2RGB); // Convert to RGB for HSV

            // Process Reaction ROI
            const reactionAbs = getAbsoluteCoordsForProcessing(reactionROI);
            let reactionRect = new cv.Rect(reactionAbs.x, reactionAbs.y, reactionAbs.width, reactionAbs.height);
            let reactionRoiMat = rgbFrameMat.roi(reactionRect);
            let reactionHsvMat = new cv.Mat();
            cv.cvtColor(reactionRoiMat, reactionHsvMat, cv.COLOR_RGB2HSV);
            let reactionMean = cv.mean(reactionHsvMat);
            const avgHueReaction = reactionMean[0]; // Hue is the first channel

            // Process Background ROI
            const backgroundAbs = getAbsoluteCoordsForProcessing(backgroundROI);
            let backgroundRect = new cv.Rect(backgroundAbs.x, backgroundAbs.y, backgroundAbs.width, backgroundAbs.height);
            let backgroundRoiMat = rgbFrameMat.roi(backgroundRect);
            let backgroundHsvMat = new cv.Mat();
            cv.cvtColor(backgroundRoiMat, backgroundHsvMat, cv.COLOR_RGB2HSV);
            let backgroundMean = cv.mean(backgroundHsvMat);
            const avgHueBackground = backgroundMean[0]; // Hue is the first channel


            // Store data
            analysisData.push({
                time: currentTime.toFixed(2),
                hueReaction: avgHueReaction.toFixed(2),
                hueBackground: avgHueBackground.toFixed(2)
            });

            // --- IMPORTANT: Clean up OpenCV Mats ---
            reactionRoiMat.delete();
            reactionHsvMat.delete();
            backgroundRoiMat.delete();
            backgroundHsvMat.delete();
            rgbFrameMat.delete();
            frameMat.delete();


        } catch (error) {
            console.error(`Error procesando frame en ${currentTime.toFixed(2)}s:`, error);
            analysisStatus.textContent = `Error en el análisis: ${error.message}`;
            analysisStatus.style.color = 'red';
            analyzeBtn.disabled = false; // Re-enable on error
            enableRoiButtons(true);
            return; // Stop analysis on error
        }

        framesProcessed++;
        analysisProgress.value = (framesProcessed / totalFramesToProcess) * 100;

        // Schedule the next frame processing
        scheduleNext();
    }

    function scheduleNext() {
        currentTime += intervalSeconds;
        // Use setTimeout to yield to the browser event loop, preventing freezing
        setTimeout(processNextFrame, 0);
    }

    // Start the first frame processing
    processNextFrame();
}


// Helper to get absolute coordinates for the *original video dimensions*
function getAbsoluteCoordsForProcessing(relativeROI) {
    if (!relativeROI) return null;
    return {
        x: Math.max(0, Math.round(relativeROI.x * processCanvas.width)),
        y: Math.max(0, Math.round(relativeROI.y * processCanvas.height)),
        width: Math.max(1, Math.round(relativeROI.width * processCanvas.width)),
        height: Math.max(1, Math.round(relativeROI.height * processCanvas.height))
    };
}


function analysisFinished() {
    console.log("Análisis completado.");
    analysisStatus.textContent = 'Análisis completado.';
    analysisProgress.style.display = 'none';
    analyzeBtn.disabled = false; // Re-enable analyze button
    enableRoiButtons(true); // Re-enable ROI buttons
    if (analysisData.length > 0) {
        drawChart();
        downloadCsvBtn.disabled = false;
        chartContainer.style.display = 'block';
    } else {
        analysisStatus.textContent = 'Análisis completado, pero no se generaron datos.';
    }
}

function drawChart() {
    if (chartInstance) {
        chartInstance.destroy();
    }

    const labels = analysisData.map(d => d.time);
    const reactionData = analysisData.map(d => parseFloat(d.hueReaction));
    const backgroundData = analysisData.map(d => parseFloat(d.hueBackground));

    chartInstance = new Chart(resultsChartCanvas, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Hue Promedio Reacción',
                    data: reactionData,
                    borderColor: 'rgb(255, 99, 132)', // Red
                    backgroundColor: 'rgba(255, 99, 132, 0.5)',
                    tension: 0.1
                },
                {
                    label: 'Hue Promedio Fondo',
                    data: backgroundData,
                    borderColor: 'rgb(54, 162, 235)', // Blue
                    backgroundColor: 'rgba(54, 162, 235, 0.5)',
                    tension: 0.1
                }
            ]
        },
        options: {
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Tiempo (s)'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Hue Promedio (0-179)' // OpenCV HSV Hue range
                    },
                    min: 0,
                    max: 180 // OpenCV's Hue range is 0-179
                }
            },
            responsive: true,
            maintainAspectRatio: false // Adjust chart size better
        }
    });
}

function downloadCSV() {
    if (analysisData.length === 0) return;

    let csvContent = "data:text/csv;charset=utf-8,";
    // Header row
    csvContent += "Tiempo(s),Hue_Reaccion,Hue_Fondo\n";
    // Data rows
    analysisData.forEach(row => {
        csvContent += `${row.time},${row.hueReaction},${row.hueBackground}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "analisis_reaccion.csv");
    document.body.appendChild(link); // Required for Firefox
    link.click();
    document.body.removeChild(link);
}

// Initial setup
enableRoiButtons(false); // Disable ROI buttons initially
analyzeBtn.disabled = true;
downloadCsvBtn.disabled = true;