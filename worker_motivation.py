def generate_motivation(worker_name, score, response_time):
    if response_time < 2:
        return f"⚡ {worker_name}, תגובה מהירה! אתה בעניינים 🔥"

    elif response_time < 5:
        return f"💪 {worker_name}, עבודה טובה! ממשיכים בקצב"

    else:
        return f"😎 {worker_name}, גם בעומס אתה שומר על יציבות 👏"
