const recordBtn = document.getElementById('record-btn');
const messagesDiv = document.getElementById('messages');
const statusPill = document.getElementById('status-pill');
const statusText = document.getElementById('status-text');
const visualizer = document.getElementById('visualizer');
const bars = document.querySelectorAll('.bar');

let socket;
let mediaRecorder;
let audioContext;
let audioQueue = [];
let isPlaying = false;
let isRecording = false;

// Sync State
let currentBotBubble = null;
let currentSentenceWords = [];
let nextAudioStartTime = 0; // The timestamp in AudioContext to schedule the next chunk

// Initialize WebSocket
function connectWebSocket() {
    socket = new WebSocket(`ws://${location.host}/ws`);

    socket.onopen = () => {
        statusPill.classList.add('connected');
        statusText.textContent = "Connected";
        console.log("WebSocket Connected");
    };

    socket.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);

            if (data.type === "transcription") {
                addMessage(data.text, "user");
            } else if (data.type === "sentence_start") {
                handleSentenceStart(data.text);
            } else if (data.type === "audio_chunk") {
                handleAudioChunk(data.data);
            } else if (data.type === "sentence_end") {
                console.log("Sentence audio buffered");
            } else if (data.type === "done") {
                console.log("Full response complete");
                // Don't null currentBotBubble immediately, the playback might still be going
            } else if (data.type === "error") {
                console.error(data.message);
                alert("Error: " + data.message);
            }
        } catch (e) {
            console.warn("Received non-JSON message:", event.data);
        }
    };

    socket.onclose = () => {
        statusPill.classList.remove('connected');
        statusText.textContent = "Disconnected";
        setTimeout(connectWebSocket, 3000);
    };
}

function handleSentenceStart(text) {
    if (!currentBotBubble) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message bot`;
        msgDiv.innerHTML = `
            <div class="avatar">🤖</div>
            <div class="bubble"></div>
        `;
        messagesDiv.appendChild(msgDiv);
        currentBotBubble = msgDiv.querySelector('.bubble');
    }

    // Add words to the queue
    const words = text.split(/\s+/).filter(w => w.length > 0);
    currentSentenceWords.push(...words);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Ensure AudioContext is active
async function initAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 32000 });
        nextAudioStartTime = 0;
    }
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }
}

// Play Gapless Audio with Word Reveal
async function handleAudioChunk(base64Data) {
    await initAudioContext();

    const binaryString = atob(base64Data);
    const len = binaryString.length;
    const bytes = new Int16Array(len / 2);
    for (let i = 0; i < len; i += 2) {
        bytes[i / 2] = (binaryString.charCodeAt(i + 1) << 8) | binaryString.charCodeAt(i);
    }

    const float32 = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
        float32[i] = bytes[i] / 32768.0;
    }

    const audioBuffer = audioContext.createBuffer(1, float32.length, 32000);
    audioBuffer.getChannelData(0).set(float32);

    scheduleAudio(audioBuffer);
}

function scheduleAudio(buffer) {
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);

    // Gapless scheduling logic
    const duration = buffer.duration;

    // Determine the start time for this buffer
    // If nextAudioStartTime is in the past, reset to currentTime + small buffer
    if (nextAudioStartTime < audioContext.currentTime) {
        nextAudioStartTime = audioContext.currentTime + 0.1;
    }

    const startTime = nextAudioStartTime;
    nextAudioStartTime += duration;

    source.start(startTime);
    animateVisualizer(true);

    // Timing for word reveal (scheduled based on the same start time)
    if (currentSentenceWords.length > 0) {
        const wordsToReveal = Math.max(1, Math.round(duration / 0.25));
        revealWordsTimed(wordsToReveal, startTime, duration);
    }

    source.onended = () => {
        // If everything is done playing
        if (nextAudioStartTime <= audioContext.currentTime + 0.05) {
            animateVisualizer(false);
            currentBotBubble = null; // Finally clear the bubble tracking 
        }
    };
}

function revealWordsTimed(count, startTime, duration) {
    // Reveal words using setTimeout delayed by the difference between now and the audio start time
    const now = audioContext.currentTime;
    const delayMs = (startTime - now) * 1000;
    const intervalMs = (duration * 1000) / count;

    setTimeout(() => {
        let revealed = 0;
        const interval = setInterval(() => {
            if (currentBotBubble && currentSentenceWords.length > 0 && revealed < count) {
                const word = currentSentenceWords.shift();
                currentBotBubble.textContent += (currentBotBubble.textContent ? ' ' : '') + word;
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
                revealed++;
            } else {
                clearInterval(interval);
            }
        }, intervalMs);
    }, Math.max(0, delayMs));
}

// Recording Logic
recordBtn.addEventListener('click', async () => {
    if (!isRecording) {
        await startRecording();
    } else {
        stopRecording();
    }
});

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);

        socket.send("audio_start");

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0 && socket.readyState === WebSocket.OPEN) {
                socket.send(e.data);
            }
        };

        mediaRecorder.onstop = () => {
            socket.send("audio_end");
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start(100);
        isRecording = true;
        recordBtn.classList.add('recording');
        recordBtn.querySelector('.label').textContent = "Stop Recording";
        recordBtn.querySelector('.icon').textContent = "⏹️";

    } catch (err) {
        console.error("Mic Error:", err);
        alert("Microphone access denied.");
    }
}

function stopRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        recordBtn.classList.remove('recording');
        recordBtn.querySelector('.label').textContent = "Start Recording";
        recordBtn.querySelector('.icon').textContent = "🎙️";
    }
}

// UI Helpers
function addMessage(text, sender) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${sender}`;
    msgDiv.innerHTML = `
        <div class="avatar">${sender === 'user' ? '🧑' : '🤖'}</div>
        <div class="bubble">${text}</div>
    `;
    messagesDiv.appendChild(msgDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Visualizer
function animateVisualizer(active) {
    if (active) {
        visualizer.classList.add('active');
        bars.forEach(bar => {
            bar.style.height = Math.random() * 20 + 4 + 'px';
        });
        if (nextAudioStartTime > audioContext.currentTime) {
            requestAnimationFrame(() => animateVisualizer(true));
        }
    } else {
        visualizer.classList.remove('active');
        bars.forEach(bar => bar.style.height = '4px');
    }
}

connectWebSocket();
