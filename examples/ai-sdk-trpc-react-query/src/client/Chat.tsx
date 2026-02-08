import { useState, type FormEvent } from "react";
import { Message } from "./Message";
import { useChat } from "./hooks/useChat";
import { generateId, getUrlParam, setUrlParam } from "../../../shared/utils";

export function Chat() {
  const [chatId, setChatId] = useState(() => getUrlParam(`chatId`) || setUrlParam(`chatId`, generateId(`chat`)));
  const [input, setInput] = useState(``);

  const { messages, sendMessage, status, stopStream } = useChat({
    chatId,
    autoResume: true,
    onError: (err) => {
      console.error(`[Chat] onError:`, err);
    },
    onChunk: (chunk) => {
      console.log(`[Chat] onChunk:`, chunk);
    },
    onData: (chunk) => {
      console.log(`[Chat] onData:`, chunk);
    },
    onStart: (chunk) => {
      console.log(`[Chat] onStart:`, chunk);
    },
    onFinish: (chunk) => {
      console.log(`[Chat] onFinish:`, chunk);
    },
    onResume: () => {
      console.log(`[Chat] onResume called`);
    },
    onStop: () => {
      console.log(`[Chat] onStop called`);
    },
  });

  const isSending = status === `streaming`;

  const handleNewChat = () => {
    const newId = generateId(`chat`);
    setUrlParam(`chatId`, newId);
    setChatId(newId);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isSending) return;

    const message = input;
    setInput(``);
    sendMessage(message);
  };

  if (status === `loading`) {
    return (
      <div style={{ maxWidth: `600px`, margin: `0 auto`, padding: `20px` }}>
        <h1>AI SDK + tRPC + React Query</h1>
        <div style={{ color: `#666`, textAlign: `center`, marginTop: `100px` }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: `600px`, margin: `0 auto`, padding: `20px` }}>
      <h1>AI SDK + tRPC + React Query</h1>

      <div style={{ marginBottom: `16px`, fontSize: `14px`, color: `#666` }}>
        <p style={{ margin: 0 }}>
          Send a message, then refresh the page (F5) while streaming to test auto-resume.
        </p>
      </div>

      <div
        style={{
          marginBottom: `16px`,
          display: `flex`,
          justifyContent: `space-between`,
          alignItems: `flex-start`,
        }}
      >
        <div>
          <small>Chat ID: {chatId}</small>
          <br />
          <small>Status: {status}</small>
        </div>
        <button
          type="button"
          onClick={handleNewChat}
          disabled={isSending}
          style={{
            padding: `8px 16px`,
            borderRadius: `4px`,
            border: `none`,
            backgroundColor: `#007bff`,
            color: `white`,
            cursor: isSending ? `not-allowed` : `pointer`,
            opacity: isSending ? 0.5 : 1,
          }}
        >
          New Chat
        </button>
      </div>

      <div
        style={{
          border: `1px solid #ccc`,
          borderRadius: `8px`,
          padding: `16px`,
          minHeight: `300px`,
          maxHeight: `500px`,
          overflowY: `auto`,
          marginBottom: `16px`,
        }}
      >
        {messages.length === 0 ? (
          <div style={{ color: `#666`, textAlign: `center` }}>
            No messages yet. Start a conversation!
          </div>
        ) : (
          messages.map((msg) => <Message key={msg.id} message={msg} />)
        )}
      </div>

      <form onSubmit={handleSubmit} style={{ display: `flex`, gap: `8px` }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message..."
          disabled={isSending}
          style={{
            flex: 1,
            padding: `8px 12px`,
            borderRadius: `4px`,
            border: `1px solid #ccc`,
          }}
        />
        {isSending ? (
          <button
            type="button"
            onClick={stopStream}
            style={{
              padding: `8px 16px`,
              borderRadius: `4px`,
              border: `none`,
              backgroundColor: `#dc3545`,
              color: `white`,
              cursor: `pointer`,
            }}
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            style={{
              padding: `8px 16px`,
              borderRadius: `4px`,
              border: `none`,
              backgroundColor: `#007bff`,
              color: `white`,
              cursor: !input.trim() ? `not-allowed` : `pointer`,
              opacity: !input.trim() ? 0.5 : 1,
            }}
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}
