# ai_chatbot.py
from flask import Flask, request, jsonify
from llama_cpp import Llama

MODEL_PATH = "openhermes-2.5-mistral-7b.Q4_K_M.gguf"
llm = Llama(model_path=MODEL_PATH, n_ctx=4096, n_threads=4)

SYSTEM_PROMPT = "You are Juned's custom AI assistant. Answer clearly, helpfully, and respectfully."

app = Flask(__name__)

@app.route('/chat', methods=['POST'])
def chat():
    data = request.get_json()
    user_input = data.get("message", "")
    prompt = f"[INST] <<SYS>> {SYSTEM_PROMPT} <</SYS>> {user_input} [/INST]"
    result = llm(prompt, max_tokens=300, temperature=0.7)
    reply = result["choices"][0]["text"].strip()
    return jsonify({"reply": reply})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)

