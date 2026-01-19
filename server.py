import os

from fastapi.responses import FileResponse
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

import asyncio
import base64
import io
import re
import numpy as np
import soundfile as sf
import torch
import librosa
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
from google import genai
from soprano import SopranoTTS
from dotenv import load_dotenv

load_dotenv()

# ─── CONFIG ─────────────────────────────────────────────────────────
DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY not found in .env")

client = genai.Client(api_key=GEMINI_API_KEY)

# ─── MODELS ─────────────────────────────────────────────────────────
print(f"🚀 Loading models on {DEVICE}...")

# Whisper
whisper_model = WhisperModel(
    "medium",
    device=DEVICE,
    compute_type="float16" if DEVICE == "cuda" else "int8",
)

# Soprano TTS
tts_model = SopranoTTS(
    backend="lmdeploy",
    device=DEVICE,
    decoder_batch_size=6
)

print("✅ Models loaded!")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static frontend
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def read_index():
    return FileResponse("static/index.html")


# ─── HELPER FUNCTIONS ───────────────────────────────────────────────
def transcribe(audio_np):
    segments, _ = whisper_model.transcribe(
        audio_np,
        language="en",
        vad_filter=True,
    )
    return " ".join([seg.text.strip() for seg in segments]).strip()

def get_gemini_stream(text):
    return client.models.generate_content_stream(
        model="gemini-2.0-flash",
        contents=[
            "You are a helpful assistant. Reply concisely and to the point.",
            text
        ],
    )

# ─── WEBSOCKET ENDPOINT ─────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("🔌 Client connected")
    
    try:
        while True:
            # Wait for "audio_start" message
            message = await websocket.receive()
            if "text" not in message or message["text"] != "audio_start":
                continue
                
            print("🎤 Receiving audio...")
            audio_buffer = io.BytesIO()
            
            # Receive chunks until "audio_end"
            while True:
                message = await websocket.receive()
                if "bytes" in message:
                    audio_buffer.write(message["bytes"])
                elif "text" in message and message["text"] == "audio_end":
                    break
            
            # Process Audio
            # librosa.load with BytesIO often fails for WebM/ffmpeg formats.
            # We write to a temp file instead.
            try:
                with open("temp_audio.webm", "wb") as f:
                    f.write(audio_buffer.getvalue())
                
                audio_np, sr = librosa.load("temp_audio.webm", sr=16000)
            except Exception as e:
                print(f"❌ Error reading audio: {e}")
                await websocket.send_json({"type": "error", "message": "Invalid audio format. Please check ffmpeg installation."})
                continue

            if audio_np.ndim > 1:
                audio_np = np.mean(audio_np, axis=1)
            
            if sr != 16000:
                audio_np = librosa.resample(audio_np, orig_sr=sr, target_sr=16000)

            # Transcribe
            print("📝 Transcribing...")
            user_text = await asyncio.to_thread(transcribe, audio_np)
            print(f"🗣️ User: {user_text}")
            
            await websocket.send_json({"type": "transcription", "text": user_text})

            if not user_text:
                await websocket.send_json({"type": "done"})
                continue

            # Gemini + TTS streaming
            sentence_queue = asyncio.Queue()
            
            async def tts_worker():
                while True:
                    sentence = await sentence_queue.get()
                    if sentence is None:
                        break
                    
                    # Notify frontend that a new sentence is starting with its text
                    await websocket.send_json({"type": "sentence_start", "text": sentence})
                    
                    try:
                        audio_gen = tts_model.infer_stream(
                            sentence, 
                            chunk_size=2, 
                            temperature=0.35, 
                            top_p=0.92
                        )
                        
                        for chunk in audio_gen:
                            if isinstance(chunk, torch.Tensor):
                                chunk_np = chunk.cpu().numpy()
                            else:
                                chunk_np = chunk
                            
                            # Use a fixed scale for consistency across chunks
                            # Soprano output is usually within a reasonable range, 
                            # self-normalized chunks cause "pops" at boundaries.
                            chunk_np = chunk_np * 0.95 
                            
                            # Clip to avoid overflow
                            chunk_np = np.clip(chunk_np, -1.0, 1.0)
                            
                            audio_bytes = (chunk_np * 32767).astype(np.int16).tobytes()
                            b64_audio = base64.b64encode(audio_bytes).decode('utf-8')
                            
                            await websocket.send_json({
                                "type": "audio_chunk",
                                "data": b64_audio
                            })
                            await asyncio.sleep(0.001)
                            
                        # Notify end of sentence audio
                        await websocket.send_json({"type": "sentence_end"})

                    except Exception as e:
                        print(f"❌ TTS Error: {e}")
                    
                    sentence_queue.task_done()

            consumer_task = asyncio.create_task(tts_worker())

            pattern = re.compile(r'(?<=[.!?])\s+')
            buffer = ""
            
            try:
                gemini_stream = get_gemini_stream(user_text)
                
                for chunk in gemini_stream:
                    if chunk.text:
                        text_chunk = chunk.text
                        # We no longer send text_delta immediately to sync with audio
                        # await websocket.send_json({"type": "text_delta", "text": text_chunk})
                        
                        buffer += text_chunk
                        parts = pattern.split(buffer)
                        if len(parts) > 1:
                            for i in range(len(parts) - 1):
                                await sentence_queue.put(parts[i].strip())
                            buffer = parts[-1]
                            
                if buffer.strip():
                    await sentence_queue.put(buffer.strip())
                    
            except Exception as e:
                print(f"❌ Gemini Error: {e}")
                await websocket.send_json({"type": "error", "message": str(e)})

            # Finish
            await sentence_queue.put(None)
            await consumer_task
            await websocket.send_json({"type": "done"})

    except WebSocketDisconnect:
        print("🔌 Client disconnected")

if __name__ == "__main__":
    import uvicorn
    # Clean up old port if needed manually
    uvicorn.run(app, host="0.0.0.0", port=8000)
