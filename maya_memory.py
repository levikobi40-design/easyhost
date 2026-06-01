from guest_memory import get_conversation, save_message

USE_AI = False  # תשאיר false עד שמוכן

def call_maya(conn, phone, user_message):
    try:
        history = get_conversation(conn, phone)

        context = ""
        for role, msg in history:
            context += f"{role}: {msg}\n"

        prompt = f"""
You are Maya, a smart hotel manager AI.

Be polite, short, and helpful.

Conversation:
{context}

Guest: {user_message}
Maya:
"""

        if not USE_AI:
            reply = "Hello! How can I assist you today?"

        else:
            # פה תחבר OpenAI בעתיד
            reply = "AI response"

        save_message(conn, phone, user_message, "user")
        save_message(conn, phone, reply, "assistant")

        return reply

    except Exception as e:
        print("❌ Maya Error:", str(e))
        return "System temporarily unavailable"
