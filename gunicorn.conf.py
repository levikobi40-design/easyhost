# Gunicorn config for Railway / production — eventlet + Socket.IO friendly.
# Usage: gunicorn -c gunicorn.conf.py app:app
#
# Critical: -w 1 with eventlet. Long Gemini calls must not block the hub
# (see _eventlet_run_blocking / tpool in app.py).

import os

bind = f"0.0.0.0:{os.getenv('PORT', '8080')}"
worker_class = "eventlet"
workers = 1
# Worker silent for this many seconds → kill/restart (covers stuck LLM/DB).
timeout = int(os.getenv("GUNICORN_TIMEOUT", "120"))
graceful_timeout = int(os.getenv("GUNICORN_GRACEFUL_TIMEOUT", "30"))
keepalive = int(os.getenv("GUNICORN_KEEPALIVE", "5"))
# Avoid request buffering issues with SSE / Socket.IO long-lived connections.
worker_connections = int(os.getenv("GUNICORN_WORKER_CONNECTIONS", "1000"))
preload_app = False
capture_output = True
enable_stdio_inheritance = True
loglevel = os.getenv("GUNICORN_LOGLEVEL", "info")
