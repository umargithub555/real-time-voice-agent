# Soprano TTS Real-Time Voice Agent

A high-performance, real-time voice chatbot featuring a modern web interface, low-latency speech recognition, and synchronized text-to-speech streaming.

The primary focus of this project is to test open source services for STT and TTS specially, and to later make a Custom Hotel Reservation Agent using langchain or langraph.

More improvements are needed for perfect real time streaming.

## 🚀 Features

- **Real-Time Voice Interaction**: Speak to the AI and get instant responses.
- **Microphone Streaming**: Uses `MediaRecorder` and WebSockets for low-latency audio capture.
- **Synchronized Text & Audio**: Word-by-word text streaming synced with the AI's voice.
- **Premium UI**: Modern dark-mode interface with glassmorphism and dynamic audio visualizations.
- **FastAPI Backend**: Robust Python server handling asynchronous model execution.

## 🛠️ Technical Stack

- **Frontend**: HTML5, Vanilla CSS, JavaScript (Web Audio API, WebSockets).
- **Backend**: [FastAPI](https://fastapi.tiangolo.com/), [Uvicorn](https://www.uvicorn.org/).
- **LLM**: [Google Gemini 2.0 Flash](https://ai.google.dev/). # we can use any LLM with streaming support
- **ASR (Speech-to-Text)**: [Faster-Whisper](https://github.com/SYSTRAN/faster-whisper).
- **TTS (Text-to-Speech)**: [Soprano TTS](https://github.com/ekwek/Soprano).
- **Audio Processing**: [Librosa](https://librosa.org/), [FFmpeg](https://ffmpeg.org/).

## 📋 Prerequisites

- **Python 3.9 - 3.11** (Recommended).
- **FFmpeg**: Required for audio decoding.
  - *Windows*: `winget install ffmpeg` or download from [ffmpeg.org](https://ffmpeg.org/).
- **CUDA/GPU** (Optional but recommended for low latency).

## ⚙️ Setup

1. **Clone the repository**:
   ```bash
   git clone <your-repo-url>
   cd real-time-agent
   ```

2. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure Environment Variables**:
   Create a `.env` file in the root directory:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

## 🚀 Running the Application

1. **Start the server**:
   ```bash
   python server.py
   ```
   *The models will download on the first run (Whisper and Soprano).*

2. **Open the browser**:
   Navigate to [http://localhost:8000](http://localhost:8000).

3. **Interact**:
   - Click **"Start Recording"** and speak.
   - Click **"Stop Recording"** to send your voice to the AI.

## 📁 Project Structure

```text
.
├── server.py              # FastAPI server & Model integration
├── requirements.txt       # Python dependencies
├── .env                   # API Keys (gitignored)
└── static/                # Frontend assets
    ├── index.html         # Main UI
    ├── style.css          # Styling
    └── script.js          # WebSocket & Audio logic
```

## 📄 License

This project is licensed under the MIT License.
