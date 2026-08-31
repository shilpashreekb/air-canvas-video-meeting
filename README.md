# Air Canvas for Video Meetings using Hand Gestures

[![Live Demo](https://img.shields.io/badge/Demo-Live-blue)](https://air-canvas-meeting.pages.dev)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.9+-blue)](https://python.org)
[![VTU](https://img.shields.io/badge/VTU-Project-orange)](https://vtu.ac.in)

---

## 📖 About

Real-time video conferencing with **gesture-controlled Air Canvas**. Draw, erase, clear using hand gestures (1 finger=draw, 2=erase, fist=clear). Built with MediaPipe, KNN, WebRTC. Canvas syncs across participants.

---

## 🖐️ Gestures

| Gesture | Action |
|---------|--------|
| ☝️ One Finger | **Draw** |
| ✌️ Two Fingers | **Erase** |
| ✊ Fist | **Clear** |

---

## ✨ Features

- Real-time video/audio (WebRTC)
- Hand gesture recognition (MediaPipe + KNN)
- Multi-user canvas sync
- Host-controlled permissions
- Meeting rooms with authentication

---

## 🛠️ Tech Stack

**Frontend:** HTML, CSS, JS, MediaPipe, WebRTC  
**Backend:** FastAPI, Python, WebSockets, SQLite  
**ML:** KNN, Scikit-learn, Joblib  
**Deployment:** Cloudflare Pages + Tunnel

---

## 🚀 Quick Start

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend (Live Server or)
cd frontend
python -m http.server 5501
# Open http://127.0.0.1:5501/pages/index.html

📁 Structure
text
backend/          # FastAPI + WebSocket + ML
frontend/         # HTML + CSS + JS
models/           # Trained KNN model
dataset/          # Gesture data

📄 License
MIT License

Made with ❤️ for Final Year BE Project - VTU
