from flask import Flask, request, jsonify
from llama_cpp import Llama
import os

# Path to your local model file
MODEL_PATH = "openhermes-2.5-mistral-7b.Q4_K_M.gguf"

# Load the model (adjust threads as per your server)
try:
    llm = Llama(model_path=MODEL_PATH, n_ctx=4096, n_threads=4)
except Exception as e:
    llm = None
    print(f"Error loading model: {e}")

SYSTEM_PROMPT = "You are Juned's custom AI assistant. Answer clearly, helpfully, and respectfully."

app = Flask(__name__)

@app.route("/")
def home():
    return "✅ Juned's AI API is running! Use POST /chat to interact."

@app.route("/chat", methods=["POST"])
def chat():
    if llm is None:
        return jsonify({"error": "AI model not loaded properly."}), 500
    
    data = request.get_json()
    if not data or "message" not in data:
        return jsonify({"error": "Missing 'message' in request body."}), 400
    
    user_input = data["message"].strip()
    if not user_input:
        return jsonify({"error": "Empty message provided."}), 400
    
    prompt = f"[INST] <<SYS>> {SYSTEM_PROMPT} <</SYS>> {user_input} [/INST]"
    
    try:
        result = llm(prompt, max_tokens=300, temperature=0.7)
        reply = result["choices"][0]["text"].strip()
        return jsonify({"reply": reply})
    except Exception as e:
        return jsonify({"error": f"Failed to generate response: {str(e)}"}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)

