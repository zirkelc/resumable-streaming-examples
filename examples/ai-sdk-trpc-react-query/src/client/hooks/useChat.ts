import { useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { InferUIMessageChunk, readUIMessageStream, UIMessage, type UIMessageChunk } from "ai";
import { convertAsyncIterableToStream } from "ai-stream-utils/utils";
import { trpc, trpcClient, type MyUIMessage } from "../trpc";
import { generateId } from "../../../../shared/utils";

type UseChatStatus = 'ready' | `loading` | 'streaming' | `error`;

type MyUIChunk = InferUIMessageChunk<MyUIMessage>;
type StartChunk = Extract<MyUIChunk, { type: "start" }>;
type FinishChunk = Extract<MyUIChunk, { type: "finish" }>;
type DataChunk = Extract<MyUIChunk, { type: `data-${string}` }>;

type UseChatOptions = {
  chatId: string;
  autoResume?: boolean;
  onChunk?: (chunk: MyUIChunk) => void;
  onData?: (chunk: DataChunk) => void;
  onStart?: (chunk: StartChunk) => void;
  onFinish?: (chunk: FinishChunk) => void;
  onError?: (error: Error) => void;
  onResume?: () => void;
};

type UseChatReturn = {
  messages: Array<MyUIMessage>;
  sendMessage: (input: string) => Promise<void>;
  status: UseChatStatus;
  resumeStream: () => void;
};

const convertToUIMessageStream = (iterable: AsyncIterable<MyUIChunk>, options?: {
  onChunk?: (chunk: MyUIChunk) => void;
  onData?: (chunk: DataChunk) => void;
  onStart?: (chunk: StartChunk) => void;
  onFinish?: (chunk: FinishChunk) => void;
}): ReadableStream<MyUIChunk> => {
  const stream = convertAsyncIterableToStream(iterable).pipeThrough(new TransformStream({
    transform(chunk, controller) {
      options?.onChunk?.(chunk);

      if (chunk.type === `start`) {
        options?.onStart?.(chunk);
      }

      if (chunk.type === `finish`) {
        options?.onFinish?.(chunk);
      }

      controller.enqueue(chunk);
    },
  }));

  return stream;
};

export function useChat2({ chatId }) {
  const queryClient = useQueryClient();
  const queryKey = trpc.listMessages.queryKey({ chatId });

  const upsertMessage = (message: UIMessage) => {
    queryClient.setQueryData(queryKey, (old) => {
      const messages = [...old?.messages ?? []];
      const index = messages.findIndex((m) => m.id === message.id);

      if (index >= 0) {
        messages[index] = message;
      } else {
        messages.push(message);
      }

      return { chatId, messages };
    });
  };

  const messagesQuery = useQuery({
    queryKey,
    queryFn: () => trpcClient.listMessages.query({ chatId }),
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (text: string) => {
      const userMessage: UIMessage = {
        id: generateId(`msg`),
        role: `user`,
        parts: [{ type: `text`, text }],
      };

      // Optimistically add user message                                      
        upsertMessage(userMessage);

      // Send message to server and stream response
      const iterable = await trpcClient.sendMessage.mutate({
        chatId, message: userMessage
      });

      // Convert async iterable to stream
      const stream = convertAsyncIterableToStream(iterable);

      // Loop through stream and update message for each chunk
      for await (const assistMessage of readUIMessageStream({ stream })) {
        upsertMessage(assistMessage);
      }
    },
    onSuccess: () => {
      // Sync with server after streaming completes                           
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    messages: messagesQuery.data?.messages ?? [],
    sendMessage: (text: string) => sendMessageMutation.mutateAsync(text),
  };
}  

export function useChat({
  chatId,
  autoResume,
  onChunk,
  onStart,
  onFinish,
  onError,
  onResume,
}: UseChatOptions): UseChatReturn {
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasAttemptedResumeRef = useRef(false);
  const queryClientHook = useQueryClient();

  const queryKey = trpc.listMessages.queryKey({ chatId });

  const upsertMessage = (message: MyUIMessage) => {
    queryClientHook.setQueryData<{ chatId: string; messages: Array<MyUIMessage> }>(
      queryKey,
      (old) => {
        const messages = old?.messages ?? [];
        const existingIndex = messages.findIndex((m) => m.id === message.id);

        if (existingIndex >= 0) {
          const updated = [...messages];
          updated[existingIndex] = message;
          return { chatId: old?.chatId ?? chatId, messages: updated };
        }

        return { chatId: old?.chatId ?? chatId, messages: [...messages, message] };
      },
    );  
  };

  const messagesQuery = useQuery({
    queryKey: queryKey,
    queryFn: () => trpcClient.listMessages.query({ chatId }),
  });

  /** Reset state when chatId changes */
  useEffect(() => {
    hasAttemptedResumeRef.current = false;
  }, [chatId]);

  const sendMessageMutation = useMutation({
    mutationKey: trpc.sendMessage.mutationKey(),
    mutationFn: async (userMessage: MyUIMessage) => {
      console.log(`[useChat.sendMessage] Starting mutation for chatId=${chatId}`);

      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      /** Optimistically add user message to cache */
      upsertMessage(userMessage);

      try {
        const asyncIterable = await trpcClient.sendMessage.mutate(
          { chatId, message: userMessage },
          { signal },
        );

        const stream = convertToUIMessageStream(
          // @ts-ignore
          asyncIterable as AsyncIterable<MyUIChunk>,
          {
            onChunk,
            onStart,
            onFinish,
          },
        );


        for await (const uiMessage of readUIMessageStream<MyUIMessage>({ stream })) {
          if (signal.aborted) {
            console.log(`[useChat.sendMessage] Signal aborted, breaking loop`);
            break;
          }

          console.log(`[useChat.sendMessage] Received message update:`, uiMessage.id);
          upsertMessage(uiMessage);
        }

      } catch (error) {
        if ((error as Error).name === `AbortError`) {
          console.log(`[useChat.sendMessage] AbortError caught`);
          return;
        }
        console.error(`[useChat.sendMessage] Error:`, error);
        onError?.(error as Error);
        throw error;
      } finally {
        abortControllerRef.current = null;
      }
    },
    onSuccess: () => {
      console.log(`[useChat.sendMessage] onSuccess`);
      queryClientHook.invalidateQueries({ queryKey });
    },
  });

  const resumeMessageMutation = useMutation({
    mutationKey: trpc.resumeMessage.mutationKey(),
    mutationFn: async (lastMessage?: MyUIMessage) => {
      console.log(`[useChat.resumeMessage] Starting mutation for chatId=${chatId}`);

      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;


      try {
        const asyncIterable = await trpcClient.resumeMessage.mutate({ chatId }, { signal });

        const stream = convertToUIMessageStream(
          asyncIterable as AsyncIterable<MyUIChunk>,
          {
            onChunk,
            onStart,
            onFinish,
          },
        );


        for await (const uiMessage of readUIMessageStream<MyUIMessage>({
          stream,
          message: lastMessage,
        })) {
          if (signal.aborted) {
            console.log(`[useChat.resumeMessage] Signal aborted, breaking loop`);
            break;
          }

          console.log(`[useChat.resumeMessage] Received message update:`, uiMessage.id);
          upsertMessage(uiMessage);
        }

      } catch (error) {
        if ((error as Error).name === `AbortError`) {
          console.log(`[useChat.resumeMessage] AbortError caught`);
          return;
        }
        console.error(`[useChat.resumeMessage] Error:`, error);
        onError?.(error as Error);
        throw error;
      } finally {
        abortControllerRef.current = null;
      }
    },
    onSuccess: () => {
      console.log(`[useChat.resumeMessage] onSuccess`);
      queryClientHook.invalidateQueries({ queryKey });
    },
  });

  const sendMessage = useCallback(
    async (input: string) => {
      if (!input.trim()) return;

      const userMessage: MyUIMessage = {
        id: generateId(`msg`),
        role: `user`,
        parts: [{ type: `text`, text: input }],
      };

      await sendMessageMutation.mutateAsync(userMessage);
    },
    [sendMessageMutation],
  );

  const resumeStream = useCallback(() => {
    console.log(`[useChat.resume] Resuming stream`);
    onResume?.();

    const msgs = (messagesQuery.data?.messages ?? []) as Array<MyUIMessage>;
    const lastMessage = msgs.at(-1);

    if (lastMessage?.role === `assistant`) {
      resumeMessageMutation.mutate(lastMessage);
    } else {
      resumeMessageMutation.mutate(undefined);
    }
  }, [messagesQuery.data?.messages, resumeMessageMutation, onResume]);

  /** Auto-resume on mount - server will return empty if no active stream */
  useEffect(() => {
    if (!autoResume) return;
    if (hasAttemptedResumeRef.current) return;
    if (messagesQuery.isLoading) return;
    if (sendMessageMutation.isPending) return;
    if (resumeMessageMutation.isPending) return;

    hasAttemptedResumeRef.current = true;
    console.log(`[useChat] Auto-resuming stream on mount`);
    resumeStream();
  }, [
    autoResume,
    messagesQuery.isLoading,
    sendMessageMutation.isPending,
    resumeMessageMutation.isPending,
    resumeStream,
  ]);

  const messages = (messagesQuery.data?.messages ?? []) as Array<MyUIMessage>;

  const error = messagesQuery.error || sendMessageMutation.error || resumeMessageMutation.error;
  const status = error ? `error` : messagesQuery.isLoading ? `loading` : sendMessageMutation.isPending ? 'streaming' : resumeMessageMutation.isPending ? 'streaming' : `ready`;

  return {
    messages,
    sendMessage,
    status,
    resumeStream,
  };
}
