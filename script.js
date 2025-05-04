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
let cvReady = false;
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

// --- OpenCV Loading ---
function onOpenCvReady() {
    console.log('OpenCV.js is ready.');
    openCvStatus.textContent = 'OpenCV.js cargado.';
    openCvStatus.style.color = 'green';
    cvReady = true;
    checkEnableAnalyzeButton();
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
        // Request camera access
        mediaStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' }, // Prefer rear camera
            audio: false // No audio needed
        });

        // Display preview
        livePreview.srcObject = mediaStream;
        // Required for some browsers to capture stream later
        livePreview.captureStream = livePreview.captureStream || livePreview.mozCaptureStream;

        videoInput.style.display = 'none'; // Hide file input during recording

        // Prepare MediaRecorder
        recordedChunks = []; // Clear previous chunks
        const options = { mimeType: 'video/webm; codecs=vp9' };
        try {
            mediaRecorder = new MediaRecorder(mediaStream, options);
        } catch (e1) {
            console.warn(`Codec ${options.mimeType} not supported, trying vp8...`, e1);
            const options2 = { mimeType: 'video/webm; codecs=vp8' };
             try {
                mediaRecorder = new MediaRecorder(mediaStream, options2);
            } catch (e2) {
                 console.warn(`Codec ${options2.mimeType} not supported, trying default...`, e2);
                 mediaRecorder = new MediaRecorder(mediaStream); // Use browser default
            }
        }

        mediaRecorder.ondataavailable = handleDataAvailable;
        mediaRecorder.onstop = handleStop;

        // Start recording
        mediaRecorder.start();
        console.log('MediaRecorder started:', mediaRecorder);
        recordingStatus.textContent = 'Grabando...';

        // Update UI
        startRecordBtn.disabled = true;
        stopRecordBtn.disabled = false;
        // Disable analysis button while recording
        analyzeBtn.disabled = true;
        enableRoiButtons(false); // Disable ROI selection while recording


    } catch (err) {
        console.error("Error accessing camera or starting recording:", err);
        alert(`Could not access camera: ${err.name} - ${err.message}\nPlease grant permission in your browser.`);
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
        }
        livePreview.srcObject = null;
        startRecordBtn.disabled = false;
        stopRecordBtn.disabled = true;
        recordingStatus.textContent = '';
        videoInput.style.display = 'block'; // Show file input again
        checkEnableAnalyzeButton(); // Re-check analyze button state
    }
}

function handleDataAvailable(event) {
    if (event.data.size > 0) {
        recordedChunks.push(event.data);
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        console.log('MediaRecorder stopped.');
        // The 'onstop' event will handle the rest
    } else {
        // If already stopped or never started, ensure cleanup
         if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
        }
        livePreview.srcObject = null;
        startRecordBtn.disabled = false;
        stopRecordBtn.disabled = true;
        recordingStatus.textContent = '';
        videoInput.style.display = 'block';
         checkEnableAnalyzeButton(); // Re-check analyze button state
    }
}

function handleStop() {
    console.log("MediaRecorder 'stop' event.");
    // Stop camera tracks *after* recorder has finished processing
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        console.log("Camera tracks stopped.");
    }
    livePreview.srcObject = null; // Clear preview

    // Update UI immediately
    startRecordBtn.disabled = false;
    stopRecordBtn.disabled = true;
    recordingStatus.textContent = '';
    videoInput.style.display = 'block'; // Ensure file input is visible

    if (recordedChunks.length === 0) {
        console.warn("No data was recorded.");
        alert("Recording produced no data. Please try again.");
        checkEnableAnalyzeButton(); // Re-check analyze button state
        return;
    }

    // Create Blob and URL
    const blob = new Blob(recordedChunks, {
        type: recordedChunks[0]?.type || 'video/webm' // Use first chunk's type or default
    });
    const videoURL = URL.createObjectURL(blob);

    // --- Load the recorded video into the main player ---
    // Revoke previous blob URL if it exists
    if (videoPlayer.src.startsWith('blob:')) {
        URL.revokeObjectURL(videoPlayer.src);
    }
    videoPlayer.src = videoURL;
    videoFile = blob; // Store blob as if it were an uploaded file

    // Reset analysis state for the new video
    resetAnalysis();
    clearROIs(false); // Clear ROIs visually but don't redraw yet
    reactionROI = null;
    backgroundROI = null;
    reactionCoordsSpan.textContent = "No definida";
    backgroundCoordsSpan.textContent = "No definida";

    // Setup video player listeners for the new source
    videoPlayer.onloadedmetadata = () => {
        videoDuration = videoPlayer.duration;
        const videoWidth = videoPlayer.videoWidth;
        const videoHeight = videoPlayer.videoHeight;
        const displayWidth = videoPlayer.clientWidth;
        // Adjust ROI canvas display size
        roiCanvas.width = displayWidth;
        roiCanvas.height = (videoHeight / videoWidth) * displayWidth;
        // Set processing canvas to actual video dimensions
        processCanvas.width = videoWidth;
        processCanvas.height = videoHeight;

        console.log(`RECORDED video loaded: Duration ${videoDuration.toFixed(2)}s, Dimensions ${videoWidth}x${videoHeight}`);
        enableRoiButtons(true); // Enable ROI selection for the loaded video
        checkEnableAnalyzeButton();
        clearROIs(true); // Now clear and redraw canvas
    };

     videoPlayer.onerror = (e) => {
        console.error("Error loading recorded video into player:", e);
        alert("Error trying to load the recorded video for analysis.");
         enableRoiButtons(false); // Disable ROI buttons on error
         checkEnableAnalyzeButton();
    };

     videoPlayer.onseeked = () => {
        if (reactionROI || backgroundROI) {
            redrawROIs();
        }
    };

    console.log("Recorded video ready for analysis in player. URL:", videoURL);

    // Clean up chunks
    recordedChunks = [];
}

// --- Video Upload Function ---
function handleVideoUpload(event) {
    // Stop any active recording/preview if user uploads a file
    stopRecording();

    videoFile = event.target.files[0];
    if (!videoFile) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        // Revoke previous blob URL if exists
        if (videoPlayer.src.startsWith('blob:')) {
            URL.revokeObjectURL(videoPlayer.src);
        }
        videoPlayer.src = e.target.result;
    }
    reader.readAsDataURL(videoFile);

    // Reset state for the new video
    resetAnalysis();
    clearROIs(false);
    reactionROI = null;
    backgroundROI = null;
    reactionCoordsSpan.textContent = "No definida";
    backgroundCoordsSpan.textContent = "No definida";

    videoPlayer.onloadedmetadata = () => { // Same handler as in handleStop
        videoDuration = videoPlayer.duration;
        const videoWidth = videoPlayer.videoWidth;
        const videoHeight = videoPlayer.videoHeight;
        const displayWidth = videoPlayer.clientWidth;
        roiCanvas.width = displayWidth;
        roiCanvas.height = (videoHeight / videoWidth) * displayWidth;
        processCanvas.width = videoWidth;
        processCanvas.height = videoHeight;

        console.log(`UPLOADED video loaded: Duration ${videoDuration.toFixed(2)}s, Dimensions ${videoWidth}x${videoHeight}`);
        enableRoiButtons(true);
        checkEnableAnalyzeButton();
        clearROIs(true); // Clear and redraw canvas
    };

     videoPlayer.onerror = (e) => {
        console.error("Error loading uploaded video into player:", e);
        alert("Error trying to load the uploaded video for analysis.");
        enableRoiButtons(false);
        checkEnableAnalyzeButton();
    };

    videoPlayer.onseeked = () => {
        if (reactionROI || backgroundROI) {
            redrawROIs();
        }
    };
}


// --- ROI Selection Functions ---

function enableRoiButtons(enabled) {
    selectReactionBtn.disabled = !enabled;
    selectBackgroundBtn.disabled = !enabled;
    clearRoisBtn.disabled = !enabled;
     // Ensure ROI canvas cursor is default if buttons are disabled
     if (!enabled) {
         roiCanvas.style.cursor = 'default';
     }
}

function startSelectingROI(type) {
    // Prevent selection if buttons should be disabled (e.g., during analysis/recording)
    if (selectReactionBtn.disabled) return;

    roiBeingSelected = type;
    selectReactionBtn.classList.toggle('active', type === 'reaction');
    selectBackgroundBtn.classList.toggle('active', type === 'background');
    console.log(`Selecting ROI: ${type}`);
    roiCanvas.style.cursor = 'crosshair';
}

function stopSelectingROI() {
    roiBeingSelected = null;
    selectReactionBtn.classList.remove('active');
    selectBackgroundBtn.classList.remove('active');
    roiCanvas.style.cursor = 'default';
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
    redrawROIs(true); // Pass true to indicate drawing in progress
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

    if (width > 5 && height > 5) { // Minimum ROI size
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
         console.log("ROI too small, ignored.");
    }

    redrawROIs(); // Redraw final state
    stopSelectingROI();
}

function handleMouseOut(event) {
    if (drawing) { // Treat leaving canvas while drawing as mouse up
        handleMouseUp(event);
    }
}

function redrawROIs(isDrawingSelection = false) {
    roiCtx.clearRect(0, 0, roiCanvas.width, roiCanvas.height);
    roiCtx.lineWidth = 2;

    if (reactionROI) {
        roiCtx.strokeStyle = 'rgba(255, 0, 0, 0.8)'; // Red
        const absCoords = getAbsoluteCoords(reactionROI);
        roiCtx.strokeRect(absCoords.x, absCoords.y, absCoords.width, absCoords.height);
    }

    if (backgroundROI) {
        roiCtx.strokeStyle = 'rgba(0, 0, 255, 0.8)'; // Blue
        const absCoords = getAbsoluteCoords(backgroundROI);
        roiCtx.strokeRect(absCoords.x, absCoords.y, absCoords.width, absCoords.height);
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
    checkEnableAnalyzeButton(); // Re-evaluate if analysis can be started
    console.log("ROIs cleared.");
}


// --- Analysis Functions ---

function checkEnableAnalyzeButton() {
    // Enable only if OpenCV ready, video loaded/recorded, both ROIs defined, and not currently recording
    const canAnalyze = cvReady && videoFile && reactionROI && backgroundROI && (!mediaRecorder || mediaRecorder.state === 'inactive');
    analyzeBtn.disabled = !canAnalyze;
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
    // analysisActive = false; // Add a flag if needed elsewhere
}

async function startAnalysis() {
    if (analyzeBtn.disabled) { // Double check condition
        alert("Cannot start analysis. Check if OpenCV is loaded, a video is present, and both ROIs are defined.");
        return;
    }

    console.log("Starting analysis...");
    resetAnalysis(); // Clear previous results first
    analyzeBtn.disabled = true;
    enableRoiButtons(false); // Disable ROI buttons during analysis
    // Disable recording buttons during analysis
    startRecordBtn.disabled = true;
    stopRecordBtn.disabled = true;

    analysisProgress.style.display = 'block';
    analysisStatus.textContent = 'Analyzing...';

    const intervalSeconds = 0.5; // Process every 0.5 seconds
    let currentTime = 0;
    // Use a small offset to avoid issues at exact time 0 or duration
    const analysisEndTime = videoDuration - 0.01;
    const totalFramesToProcess = Math.ceil(analysisEndTime / intervalSeconds);
    let framesProcessed = 0;

    // Pause video player if playing
    if (!videoPlayer.paused) {
        videoPlayer.pause();
    }

    async function processNextFrame() {
        if (currentTime > analysisEndTime) {
            analysisFinished();
            return;
        }

        // Ensure player is ready before seeking
        if (videoPlayer.readyState < videoPlayer.HAVE_FUTURE_DATA) {
             console.log(`Waiting for video data at ${currentTime.toFixed(2)}s...`);
             await new Promise(resolve => setTimeout(resolve, 100)); // Wait briefly
             scheduleNext(); // Try again
             return;
        }

        videoPlayer.currentTime = currentTime;

        await new Promise((resolve, reject) => {
            const seekedListener = () => {
                videoPlayer.removeEventListener('seeked', seekedListener);
                 videoPlayer.removeEventListener('error', errorListener);
                // Add a small delay AFTER seeked, sometimes needed for canvas drawImage
                 setTimeout(resolve, 50); // 50ms delay
            };
             const errorListener = (e) => {
                 videoPlayer.removeEventListener('seeked', seekedListener);
                 videoPlayer.removeEventListener('error', errorListener);
                 console.error("Error during video seek:", e);
                 reject(new Error("Video seek error"));
             };
            videoPlayer.addEventListener('seeked', seekedListener, { once: true });
            videoPlayer.addEventListener('error', errorListener, { once: true });
        }).catch(error => {
            console.error("Stopping analysis due to seek error:", error);
            analysisStatus.textContent = `Error en el análisis: ${error.message}`;
            analysisStatus.style.color = 'red';
            analysisFinished(true); // Indicate error finish
            return; // Stop processing chain
        });

        // If error occurred above, this won't run
        if (analysisStatus.style.color === 'red') return;


        // Draw frame to hidden canvas for OpenCV
        processCtx.drawImage(videoPlayer, 0, 0, processCanvas.width, processCanvas.height);

        try {
            let frameMat = cv.imread(processCanvas);
            if (frameMat.empty()) {
                console.warn(`Empty frame read at time ${currentTime.toFixed(2)}s`);
                frameMat.delete();
                scheduleNext(); // Skip and continue
                return;
            }

            let rgbFrameMat = new cv.Mat();
            cv.cvtColor(frameMat, rgbFrameMat, cv.COLOR_RGBA2RGB); // Convert for HSV

            // Process Reaction ROI
            const reactionAbs = getAbsoluteCoordsForProcessing(reactionROI);
            let reactionRect = new cv.Rect(reactionAbs.x, reactionAbs.y, reactionAbs.width, reactionAbs.height);
            let reactionRoiMat = rgbFrameMat.roi(reactionRect);
            let reactionHsvMat = new cv.Mat();
            cv.cvtColor(reactionRoiMat, reactionHsvMat, cv.COLOR_RGB2HSV);
            let reactionMean = cv.mean(reactionHsvMat);
            const avgHueReaction = reactionMean[0];

            // Process Background ROI
            const backgroundAbs = getAbsoluteCoordsForProcessing(backgroundROI);
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

            // --- OpenCV Mat Cleanup ---
            reactionRoiMat.delete(); reactionHsvMat.delete();
            backgroundRoiMat.delete(); backgroundHsvMat.delete();
            rgbFrameMat.delete(); frameMat.delete();

        } catch (error) {
            console.error(`Error processing frame at ${currentTime.toFixed(2)}s:`, error);
            analysisStatus.textContent = `Error during analysis: ${error.message || error}`;
            analysisStatus.style.color = 'red';
            analysisFinished(true); // Indicate error finish
            return; // Stop analysis
        }

        framesProcessed++;
        analysisProgress.value = Math.min(100, (framesProcessed / totalFramesToProcess) * 100);

        scheduleNext();
    }

    function scheduleNext() {
        currentTime += intervalSeconds;
        // Use setTimeout to yield to browser, preventing freeze
        setTimeout(processNextFrame, 0);
    }

    // Start the first frame
    processNextFrame();
}

// Helper for OpenCV processing coordinates (uses processCanvas dimensions)
function getAbsoluteCoordsForProcessing(relativeROI) {
    if (!relativeROI) return null;
    const x = Math.max(0, Math.round(relativeROI.x * processCanvas.width));
    const y = Math.max(0, Math.round(relativeROI.y * processCanvas.height));
    const w = Math.max(1, Math.round(relativeROI.width * processCanvas.width));
    const h = Math.max(1, Math.round(relativeROI.height * processCanvas.height));
     // Clamp ROI to be within the canvas boundaries
     const clampedW = Math.min(w, processCanvas.width - x);
     const clampedH = Math.min(h, processCanvas.height - y);

    return { x: x, y: y, width: clampedW, height: clampedH };
}

function analysisFinished(errorOccurred = false) {
    console.log(`Analysis finished. ${errorOccurred ? 'With errors.' : 'Successfully.'}`);
    analysisProgress.style.display = 'none';
    // Re-enable buttons (except analyze if error occurred?)
    analyzeBtn.disabled = false; // Or keep disabled on error? User decision.
    enableRoiButtons(true);
    startRecordBtn.disabled = false; // Re-enable recording
    stopRecordBtn.disabled = true; // Stop button should be disabled now

    if (!errorOccurred && analysisData.length > 0) {
        analysisStatus.textContent = 'Analysis complete.';
        analysisStatus.style.color = 'green'; // Use green for success
        drawChart();
        downloadCsvBtn.disabled = false;
        chartContainer.style.display = 'block';
    } else if (!errorOccurred) {
        analysisStatus.textContent = 'Analysis complete, but no data generated.';
         analysisStatus.style.color = 'orange'; // Warning color
    } else {
        // Error message already set in the catch block
        chartContainer.style.display = 'none'; // Hide chart on error
         downloadCsvBtn.disabled = true;
    }
     checkEnableAnalyzeButton(); // Final check
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
                    title: { display: true, text: 'Tiempo (s)' }
                },
                y: {
                    title: { display: true, text: 'Hue Promedio (0-179)' }, // OpenCV HSV Hue range
                    min: 0,
                    max: 180
                }
            },
            responsive: true,
            maintainAspectRatio: false
        }
    });
}

function downloadCSV() {
    if (analysisData.length === 0) return;

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Tiempo(s),Hue_Reaccion,Hue_Fondo\n";
    analysisData.forEach(row => {
        csvContent += `${row.time},${row.hueReaction},${row.hueBackground}\n`;
    });

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
    enableRoiButtons(false); // Disable ROI buttons initially
    analyzeBtn.disabled = true;
    downloadCsvBtn.disabled = true;
    stopRecordBtn.disabled = true; // Stop recording initially disabled
    startRecordBtn.disabled = false; // Start recording initially enabled
    // Add any other initial state settings here
}

// Run initialization when the script loads
initializeApp();
