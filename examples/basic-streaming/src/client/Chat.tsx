import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageBubble } from "./Message";
import { trpc, trpcClient, type Message } from "./trpc";
import { generateId } from "../../../shared/utils";

export function Chat() {
  const [input, setInput] = useState(``);
  const queryClientHook = useQueryClient();

  const messagesQuery = useQuery(trpc.listMessages.queryOptions());

  const sendMessageMutation = useMutation({
    mutationKey: trpc.sendMessage.mutationKey(),
    mutationFn: async (content: string) => {
      console.log(`[sendMessage] Starting mutation`);

      const userMessage: Message = {
        id: generateId(`user`),
        content,
        role: `user`,
        createdAt: Date.now(),
        status: `done`,
      };

      queryClientHook.setQueryData<Array<Message>>(trpc.listMessages.queryKey(), (old = []) => [
        ...old,
        userMessage,
      ]);

      const stream = await trpcClient.sendMessage.mutate(userMessage);

      const assistantMessage: Message = {
        id: ``,
        content: ``,
        role: `assistant`,
        createdAt: Date.now(),
        status: `streaming`,
      };

      for await (const chunk of stream) {
        const { messageId, status, text } = chunk;

        assistantMessage.id = messageId;
        assistantMessage.status = status;
        if (text) {
          assistantMessage.content += (assistantMessage.content ? ` ` : ``) + text;
        }

        console.log(
          `[sendMessage] Received chunk: "${text}", total content: "${assistantMessage.content}"`,
        );

        queryClientHook.setQueryData<Array<Message>>(trpc.listMessages.queryKey(), (old = []) => {
          const updated = [...old];
          const existingIndex = updated.findIndex((m) => m.id === messageId);

          if (existingIndex >= 0) {
            updated.splice(existingIndex, 1, { ...assistantMessage });
          } else {
            updated.push({ ...assistantMessage });
          }

          return updated;
        });
      }

      console.log(
        `[sendMessage] Mutation complete, returning assistantMessage with content: "${assistantMessage.content}"`,
      );
      return assistantMessage;
    },
    onSuccess: (data) => {
      console.log(`[sendMessage] onSuccess called, message content: "${data.content}"`);
      queryClientHook.invalidateQueries({ queryKey: trpc.listMessages.queryKey() });
    },
  });

  const clearMessagesMutation = useMutation({
    mutationKey: trpc.clearMessages.mutationKey(),
    mutationFn: () => trpcClient.clearMessages.mutate(),
    onSuccess: () => {
      queryClientHook.setQueryData<Array<Message>>(trpc.listMessages.queryKey(), []);
    },
  });

  const submitMessage = () => {
    if (!input.trim() || sendMessageMutation.isPending) return;
    sendMessageMutation.mutate(input, {});
    setInput(``);
  };

  const clearMessages = () => {
    clearMessagesMutation.mutate();
  };

  const messages = messagesQuery.data ?? [];
  const isStreaming = sendMessageMutation.isPending;

  return (
    <div>
      <h1>tRPC + TanStack Query Streaming Chat</h1>

      <div>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === `Enter`) submitMessage();
          }}
          placeholder="Type your message..."
          disabled={isStreaming}
        />
        <button onClick={submitMessage} disabled={!input.trim() || isStreaming}>
          {sendMessageMutation.isPending ? `Sending...` : `Send`}
        </button>
        <button onClick={clearMessages} disabled={messages.length === 0 || isStreaming}>
          Clear
        </button>
      </div>

      <div>
        {messages.map((msg) => (
          <MessageBubble key={msg.id} content={msg.content} role={msg.role} status={msg.status} />
        ))}
      </div>
    </div>
  );
}
