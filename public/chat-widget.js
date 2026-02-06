/**
 * SCWS Live Chat Widget
 * Embed on any page with:
 * <script src="https://scws-jobs.vercel.app/chat-widget.js"></script>
 */
(function() {
  const API_URL = 'https://scws-jobs.vercel.app/api/chat';
  const WIDGET_COLOR = '#166534'; // green-800
  
  // Generate or retrieve session ID
  function getSessionId() {
    let sessionId = localStorage.getItem('scws_chat_session');
    if (!sessionId) {
      sessionId = 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('scws_chat_session', sessionId);
    }
    return sessionId;
  }

  // Create widget HTML
  function createWidget() {
    const container = document.createElement('div');
    container.id = 'scws-chat-widget';
    container.innerHTML = `
      <style>
        #scws-chat-widget {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 99999;
        }
        #scws-chat-button {
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: ${WIDGET_COLOR};
          border: none;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        #scws-chat-button:hover {
          transform: scale(1.05);
          box-shadow: 0 6px 16px rgba(0,0,0,0.2);
        }
        #scws-chat-button svg {
          width: 28px;
          height: 28px;
          fill: white;
        }
        #scws-chat-window {
          display: none;
          position: absolute;
          bottom: 70px;
          right: 0;
          width: 350px;
          height: 500px;
          background: white;
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.15);
          flex-direction: column;
          overflow: hidden;
        }
        #scws-chat-window.open {
          display: flex;
        }
        #scws-chat-header {
          background: ${WIDGET_COLOR};
          color: white;
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        #scws-chat-header img {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: white;
        }
        #scws-chat-header-text h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
        }
        #scws-chat-header-text p {
          margin: 2px 0 0;
          font-size: 12px;
          opacity: 0.9;
        }
        #scws-chat-close {
          margin-left: auto;
          background: none;
          border: none;
          color: white;
          cursor: pointer;
          padding: 4px;
          opacity: 0.8;
        }
        #scws-chat-close:hover {
          opacity: 1;
        }
        #scws-chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .scws-message {
          max-width: 80%;
          padding: 10px 14px;
          border-radius: 16px;
          font-size: 14px;
          line-height: 1.4;
        }
        .scws-message.user {
          background: ${WIDGET_COLOR};
          color: white;
          align-self: flex-end;
          border-bottom-right-radius: 4px;
        }
        .scws-message.assistant {
          background: #f3f4f6;
          color: #1f2937;
          align-self: flex-start;
          border-bottom-left-radius: 4px;
        }
        .scws-message.typing {
          background: #f3f4f6;
          color: #6b7280;
        }
        #scws-chat-input-container {
          padding: 12px;
          border-top: 1px solid #e5e7eb;
          display: flex;
          gap: 8px;
        }
        #scws-chat-input {
          flex: 1;
          padding: 10px 14px;
          border: 1px solid #d1d5db;
          border-radius: 20px;
          font-size: 14px;
          outline: none;
        }
        #scws-chat-input:focus {
          border-color: ${WIDGET_COLOR};
        }
        #scws-chat-send {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: ${WIDGET_COLOR};
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        #scws-chat-send:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        #scws-chat-send svg {
          width: 18px;
          height: 18px;
          fill: white;
        }
        @media (max-width: 400px) {
          #scws-chat-window {
            width: calc(100vw - 40px);
            height: calc(100vh - 100px);
            bottom: 70px;
            right: 0;
          }
        }
      </style>
      
      <div id="scws-chat-window">
        <div id="scws-chat-header">
          <div style="width:40px;height:40px;background:white;border-radius:50%;display:flex;align-items:center;justify-content:center;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="${WIDGET_COLOR}"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
          </div>
          <div id="scws-chat-header-text">
            <h3>SCWS Support</h3>
            <p>We typically reply instantly</p>
          </div>
          <button id="scws-chat-close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
        <div id="scws-chat-messages">
          <div class="scws-message assistant">
            Hi! 👋 I'm Sarah from Southern California Well Service. How can I help you today?
          </div>
        </div>
        <div id="scws-chat-input-container">
          <input type="text" id="scws-chat-input" placeholder="Type a message..." />
          <button id="scws-chat-send">
            <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
      </div>
      
      <button id="scws-chat-button">
        <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
      </button>
    `;
    document.body.appendChild(container);
    return container;
  }

  // Initialize widget
  function init() {
    const widget = createWidget();
    const button = document.getElementById('scws-chat-button');
    const window = document.getElementById('scws-chat-window');
    const closeBtn = document.getElementById('scws-chat-close');
    const input = document.getElementById('scws-chat-input');
    const sendBtn = document.getElementById('scws-chat-send');
    const messages = document.getElementById('scws-chat-messages');
    
    const sessionId = getSessionId();
    let isOpen = false;
    let isSending = false;

    // Toggle chat window
    button.addEventListener('click', () => {
      isOpen = !isOpen;
      window.classList.toggle('open', isOpen);
      if (isOpen) input.focus();
    });

    closeBtn.addEventListener('click', () => {
      isOpen = false;
      window.classList.remove('open');
    });

    // Send message
    async function sendMessage() {
      const text = input.value.trim();
      if (!text || isSending) return;

      isSending = true;
      sendBtn.disabled = true;
      input.value = '';

      // Add user message
      const userMsg = document.createElement('div');
      userMsg.className = 'scws-message user';
      userMsg.textContent = text;
      messages.appendChild(userMsg);

      // Add typing indicator
      const typing = document.createElement('div');
      typing.className = 'scws-message assistant typing';
      typing.textContent = 'Typing...';
      messages.appendChild(typing);
      messages.scrollTop = messages.scrollHeight;

      try {
        const response = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            sessionId,
            visitorInfo: {
              pageUrl: window.location.href,
            },
          }),
        });

        const data = await response.json();
        
        // Remove typing indicator
        typing.remove();

        // Add AI response
        const aiMsg = document.createElement('div');
        aiMsg.className = 'scws-message assistant';
        aiMsg.textContent = data.response;
        messages.appendChild(aiMsg);
      } catch (error) {
        typing.remove();
        const errorMsg = document.createElement('div');
        errorMsg.className = 'scws-message assistant';
        errorMsg.textContent = "Sorry, I'm having trouble connecting. Please call us at (760) 440-8520.";
        messages.appendChild(errorMsg);
      }

      messages.scrollTop = messages.scrollHeight;
      isSending = false;
      sendBtn.disabled = false;
    }

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
