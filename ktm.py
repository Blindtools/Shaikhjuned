from flask import Blueprint, jsonify, request
from datetime import datetime
import random

ktm_bp = Blueprint('ktm', __name__)

# KTM Assistant responses for different types of queries
KTM_RESPONSES = {
    'greeting': [
        "Hello! I'm KTM Assistant, developed by the KTM Team. How can I help you today?",
        "Hi there! Welcome to KTM Assistant. What would you like to know?",
        "Greetings! I'm here to assist you. What can I do for you?"
    ],
    'about': [
        "I'm KTM Assistant R1.0, created by the KTM Team under the leadership of founder Sandeep Ghimeere. I was launched on May 11, 2025, and I support multi-language communication, voice mode, file attachments, online search, and real-time customization.",
        "KTM Assistant is an AI-powered assistant developed by the KTM Team. I offer comprehensive support with advanced features like voice interaction and file processing capabilities."
    ],
    'features': [
        "I offer several key features: Multi-language support for global communication, Voice mode for hands-free interaction, File attachment functionality for document processing, Online search integration for real-time information, and Real-time customization to adapt to your needs.",
        "My core capabilities include voice interaction, multi-language support, file processing, web search integration, and personalized responses based on your preferences."
    ],
    'help': [
        "I can assist you with various tasks including answering questions, providing information, helping with research, and offering guidance on different topics. Feel free to ask me anything!",
        "I'm here to help with information, research, problem-solving, and general assistance. What specific topic would you like help with?"
    ],
    'default': [
        "Thank you for your question. As KTM Assistant, I'm here to provide helpful information and assistance. Could you please provide more details about what you'd like to know?",
        "I understand you're looking for information. As your KTM Assistant, I'm ready to help. Could you elaborate on your query?",
        "I'm processing your request. As KTM Assistant, I aim to provide accurate and helpful responses. How can I better assist you with this?"
    ]
}

def get_response_type(message):
    """Determine the type of response based on the user's message"""
    message_lower = message.lower()
    
    if any(word in message_lower for word in ['hello', 'hi', 'hey', 'greetings', 'good morning', 'good afternoon', 'good evening']):
        return 'greeting'
    elif any(word in message_lower for word in ['about', 'who are you', 'what are you', 'tell me about yourself']):
        return 'about'
    elif any(word in message_lower for word in ['features', 'capabilities', 'what can you do', 'functions']):
        return 'features'
    elif any(word in message_lower for word in ['help', 'assist', 'support', 'how to']):
        return 'help'
    else:
        return 'default'

@ktm_bp.route('/ktm/chat', methods=['POST'])
def chat():
    """
    KTM Assistant Chat Endpoint
    
    Accepts POST requests with JSON payload containing a 'message' field
    Returns JSON response with assistant's reply
    """
    try:
        # Get the request data
        data = request.get_json()
        
        if not data or 'message' not in data:
            return jsonify({
                'error': 'Invalid request format. Please provide a message field.',
                'status': 'error'
            }), 400
        
        user_message = data['message'].strip()
        
        if not user_message:
            return jsonify({
                'error': 'Message cannot be empty.',
                'status': 'error'
            }), 400
        
        # Determine response type and get appropriate response
        response_type = get_response_type(user_message)
        responses = KTM_RESPONSES[response_type]
        assistant_response = random.choice(responses)
        
        # Prepare the response
        response_data = {
            'response': assistant_response,
            'status': 'success',
            'timestamp': datetime.now().isoformat(),
            'version': 'R1.0',
            'assistant': 'KTM Assistant',
            'developer': 'KTM Team',
            'founder': 'Sandeep Ghimeere'
        }
        
        return jsonify(response_data), 200
        
    except Exception as e:
        return jsonify({
            'error': f'Internal server error: {str(e)}',
            'status': 'error'
        }), 500

@ktm_bp.route('/ktm/info', methods=['GET'])
def info():
    """
    KTM Assistant Information Endpoint
    
    Returns basic information about the KTM Assistant API
    """
    return jsonify({
        'name': 'KTM Assistant API',
        'version': 'R1.0',
        'developer': 'KTM Team',
        'founder': 'Sandeep Ghimeere',
        'launch_date': 'May 11, 2025',
        'features': [
            'Multi-language support',
            'Voice mode capability',
            'File attachment functionality',
            'Online search integration',
            'Real-time customization'
        ],
        'endpoints': {
            'chat': '/api/ktm/chat (POST)',
            'info': '/api/ktm/info (GET)'
        },
        'status': 'active'
    }), 200

@ktm_bp.route('/ktm/health', methods=['GET'])
def health():
    """
    Health check endpoint
    """
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'version': 'R1.0'
    }), 200

