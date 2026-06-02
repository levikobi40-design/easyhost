import time

USE_AI = False  # תשאיר False עד שהמערכת יציבה

def call_maya(prompt, context=None):
    if not USE_AI:
        return {"message": "AI disabled", "fallback": True}

    try:
        # TODO: פה תחבר OpenAI או Gemini בעתיד
        return {
            "message": "Maya response placeholder",
            "fallback": False
        }

    except Exception as e:
        print("❌ Maya Error:", str(e))
        return {
            "message": "AI unavailable",
            "fallback": True
        }
