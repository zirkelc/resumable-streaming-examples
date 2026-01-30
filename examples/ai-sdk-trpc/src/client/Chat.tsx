import { useChat } from "@ai-sdk/react";
import { useState, useEffect, type FormEvent } from "react";
import type { UIMessage } from "ai";
import { Message } from "./Message";
import { TrpcChatTransport } from "./trpc-transport";
import { trpcClient } from "./trpc";
import { generateId, getUrlParam, setUrlParam } from "../../../shared/utils";
import type { MyUIMessage } from "../server/router";

const transport = new TrpcChatTransport();

export function Chat() {
  const [chatId, setChatId] = useState(() => getUrlParam(`chatId`) || setUrlParam(`chatId`, generateId(`chat`)));
  const [input, setInput] = useState(``);
  const [isLoading, setLoading] = useState(true);

  const { messages, setMessages, sendMessage, status, error, resumeStream } = useChat<MyUIMessage>({
    id: chatId,
    transport,
    generateId: () => generateId(`msg`),
    onError: (err) => {
      console.error(`[Chat] Error:`, err);
    },
  });

  const isSending = status === `streaming` || status === `submitted`;

  useEffect(() => {
    setLoading(true);
    trpcClient.listMessages
      .query({ chatId })
      .then(({ messages }) => {
        setMessages(messages as any);
        setLoading(false);

        const lastMessage = messages.at(-1);
        if (lastMessage?.role === `user`) {
          console.log(`[Chat] Last message is from user, resuming stream`);
          resumeStream();
        }
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, [chatId, setMessages, resumeStream]);

  const handleNewChat = () => {
    const newId = generateId(`chat`);
    setUrlParam(`chatId`, newId);
    setChatId(newId);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isSending) return;

    const userInput = input;
    setInput(``);

    await sendMessage({
      role: `user`,
      parts: [{ type: `text`, text: userInput }],
    });
  };

  if (isLoading) {
    return (
      <div style={{ maxWidth: `600px`, margin: `0 auto`, padding: `20px` }}>
        <h1>AI SDK + tRPC + Resumable Streams</h1>
        <div style={{ color: `#666`, textAlign: `center`, marginTop: `100px` }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: `600px`, margin: `0 auto`, padding: `20px` }}>
      <h1>AI SDK + tRPC + Resumable Streams</h1>

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
          {/* {error && <div style={{ color: `red`, marginTop: `8px` }}>Error: {error.message}</div>} */}
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
        <button
          type="submit"
          disabled={!input.trim() || isSending}
          style={{
            padding: `8px 16px`,
            borderRadius: `4px`,
            border: `none`,
            backgroundColor: `#007bff`,
            color: `white`,
            cursor: !input.trim() || isSending ? `not-allowed` : `pointer`,
            opacity: !input.trim() || isSending ? 0.5 : 1,
          }}
        >
          {isSending ? `Sending...` : `Send`}
        </button>
      </form>
    </div>
  );
}
