/**
 * Interactive TUI for the resumable streaming demo.
 *
 * Each client (the initial producer and every resumer) becomes its own
 * panel and accumulates the streamed text in real time, so you can
 * watch every consumer stay in sync as chunks arrive.
 *
 * Hotkeys:
 *   s  start a new producer (initiates the upstream)
 *   r  add a resumer (joins the in-flight stream)
 *   x  broadcast a stop request to the producer
 *   q  quit
 */
import { useEffect, useState } from "react";
import { render, Box, Text, useInput, useApp, useStdout } from "ink";
import { readUIMessageStream, type UIMessage } from "ai";
import { convertAsyncIterableToStream } from "ai-stream-utils/utils";
import { trpcClient } from "./trpc";

type ClientKind = "producer" | "resumer";
type ClientStatus = "connecting" | "streaming" | "done" | "error";
type StreamStatus = "initial" | "streaming" | "aborted" | "finished";

type Client = {
  id: string;
  kind: ClientKind;
  label: string;
  joinedAt: number;
  status: ClientStatus;
  text: string;
  chunkCount: number;
  /** Set to true if this client was still running when the user aborted. */
  aborted: boolean;
};

const KIND_COLOR: Record<ClientKind, string> = {
  producer: "magenta",
  resumer: "cyan",
};

const STATUS_GLYPH: Record<ClientStatus, { glyph: string; color: string }> = {
  connecting: { glyph: "○", color: "yellow" },
  streaming: { glyph: "●", color: "cyan" },
  done: { glyph: "✓", color: "green" },
  error: { glyph: "✗", color: "red" },
};

/** Pull the accumulated text from a streamed UIMessage. */
function getText(msg: UIMessage): string {
  const part = msg.parts.find((p) => p.type === "text");
  return part && "text" in part ? part.text : "";
}

/** Monotonic counters so each client gets a stable, human-friendly label. */
let nextProducer = 1;
let nextResumer = 1;

/** 5-character chat id used as the server-side stream id for the session. */
function generateChatId(): string {
  return Math.random().toString(36).slice(2, 7).padEnd(5, "0");
}

function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [clients, setClients] = useState<Array<Client>>([]);
  const [producerId, setProducerId] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string>(() => generateChatId());
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [aborted, setAborted] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [pressed, setPressed] = useState<string | null>(null);
  const [size, setSize] = useState({
    cols: stdout.columns ?? 80,
    rows: stdout.rows ?? 24,
  });

  /**
   * Tick the elapsed clock while a stream is in flight. Once the
   * producer has finished, freezing `endedAt` stops the tick so the
   * footer holds its final value instead of advancing past the stream.
   */
  useEffect(() => {
    if (startedAt === null || endedAt !== null) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [startedAt, endedAt]);

  /** Re-layout when the terminal is resized. */
  useEffect(() => {
    const onResize = () =>
      setSize({ cols: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
    stdout.on("resize", onResize);
    return () => { stdout.off("resize", onResize); };
  }, [stdout]);

  /** Briefly flash the pressed hotkey chip, then clear it. */
  useEffect(() => {
    if (pressed === null) return;
    const t = setTimeout(() => setPressed(null), 600);
    return () => clearTimeout(t);
  }, [pressed]);

  const addClient = (kind: ClientKind): string => {
    const number = kind === "producer" ? nextProducer++ : nextResumer++;
    const id = `${kind}-${number}`;
    const label = `${kind} #${number}`;
    setClients((prev) => [
      ...prev,
      {
        id,
        kind,
        label,
        joinedAt: Date.now(),
        status: "connecting",
        text: "",
        chunkCount: 0,
        aborted: false,
      },
    ]);
    return id;
  };

  const patch = (id: string, fn: (c: Client) => Client) => {
    setClients((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));
  };

  /**
   * Drive a tRPC streaming mutation into a client panel: open the
   * iterable, mark the client as streaming once the connection is up,
   * then update the panel for every accumulated UIMessage we read.
   */
  const runStream = async (
    id: string,
    mutation: "startStream" | "resumeStream",
    chatIdArg: string,
  ) => {
    try {
      const iter = await trpcClient[mutation].mutate({ chatId: chatIdArg });
      patch(id, (c) => ({ ...c, status: "streaming" }));

      const stream = convertAsyncIterableToStream(iter);
      for await (const msg of readUIMessageStream<UIMessage>({ stream })) {
        patch(id, (c) => ({
          ...c,
          text: getText(msg),
          chunkCount: c.chunkCount + 1,
        }));
      }
      patch(id, (c) => ({ ...c, status: "done" }));
    } catch {
      patch(id, (c) => ({ ...c, status: "error" }));
    } finally {
      /** When the producer ends, freeze the elapsed clock for the session. */
      if (mutation === "startStream") setEndedAt(Date.now());
    }
  };

  const producer = producerId
    ? clients.find((c) => c.id === producerId) ?? null
    : null;
  const isActive =
    !!producer &&
    (producer.status === "streaming" || producer.status === "connecting");

  useInput((input) => {
    if (input === "s" || input === "r" || input === "a" || input === "q") {
      setPressed(input);
    }
    if (input === "s") {
      /** One producer at a time — ignore until the current one ends. */
      if (isActive) return;
      /** Fresh session: clear panels, reset counters, mint a new chat id. */
      const newChatId = generateChatId();
      setChatId(newChatId);
      setClients([]);
      setAborted(false);
      setStartedAt(Date.now());
      setEndedAt(null);
      nextProducer = 1;
      nextResumer = 1;
      const id = addClient("producer");
      setProducerId(id);
      runStream(id, "startStream", newChatId);
    } else if (input === "r") {
      const id = addClient("resumer");
      if (!startedAt) setStartedAt(Date.now());
      runStream(id, "resumeStream", chatId);
    } else if (input === "a") {
      if (!isActive) return;
      setAborted(true);
      /** Mark every still-running client so its final glyph turns into ✗. */
      setClients((prev) =>
        prev.map((c) =>
          c.status === "streaming" || c.status === "connecting"
            ? { ...c, aborted: true }
            : c,
        ),
      );
      trpcClient.stopStream.mutate({ chatId }).catch(() => { /** swallow: nothing useful to show */ });
    } else if (input === "q") {
      exit();
    }
  });

  const producerChunks = producer?.chunkCount ?? 0;
  const elapsed = startedAt
    ? (((endedAt ?? now) - startedAt) / 1_000).toFixed(1)
    : "0.0";

  /**
   * Single stream-lifecycle status derived from internal flags.
   *   initial   — no producer has been started yet this session
   *   streaming — producer is currently running
   *   aborted   — the running stream was stopped via the `a` hotkey
   *   finished  — the stream ran to completion on its own
   */
  const streamStatus: StreamStatus =
    startedAt === null
      ? "initial"
      : isActive
        ? "streaming"
        : aborted
          ? "aborted"
          : "finished";

  return (
    <Box width={size.cols} height={size.rows} flexDirection="column">
      <Header cols={size.cols} isActive={isActive} pressed={pressed} />
      <Box flexGrow={1} flexDirection="column" paddingX={1} paddingY={1}>
        {clients.length === 0 ? (
          <Box flexDirection="column">
            <Text dimColor>No clients yet.</Text>
            <Box marginTop={1} flexDirection="column">
              <Text dimColor>
                Press <Text color="yellow" bold>s</Text> to start a stream.
              </Text>
              <Text dimColor>
                Press <Text color="yellow" bold>r</Text> to resume a running stream.
              </Text>
              <Text dimColor>
                Press <Text color="yellow" bold>a</Text> to abort a running stream.
              </Text>
            </Box>
          </Box>
        ) : (
          <Box flexDirection="row" flexWrap="wrap">
            {clients.map((c) => (
              <ClientPanel key={c.id} client={c} startedAt={startedAt} />
            ))}
          </Box>
        )}
      </Box>
      <Footer
        cols={size.cols}
        chatId={chatId}
        elapsed={elapsed}
        chunks={producerChunks}
        clientCount={clients.length}
        status={streamStatus}
      />
    </Box>
  );
}

/** Shared bar background — soft dark gray so header/footer feel unified. */
const BAR_BG = "#3a3a3a";

/**
 * Single hotkey chip rendered inside a bar.
 *
 * `enabled` controls the resting style — bright with a yellow letter when
 * the action is available, dimmed otherwise. `pressed` overrides both with
 * an inverted-yellow flash so the user can see which key the TUI just
 * registered, even when the underlying action was a no-op.
 */
function HotKey({
  letter,
  label,
  enabled,
  pressed,
}: {
  letter: string;
  label: string;
  enabled: boolean;
  pressed: boolean;
}) {
  if (pressed) {
    return (
      <Text backgroundColor="yellow" color="black" bold>
        {letter} {label}
      </Text>
    );
  }
  if (enabled) {
    return (
      <Text backgroundColor={BAR_BG} color="white">
        <Text color="yellow" bold>{letter}</Text>
        {" "}
        {label}
      </Text>
    );
  }
  return (
    <Text backgroundColor={BAR_BG} dimColor>
      {letter} {label}
    </Text>
  );
}

/**
 * Title bar — solid background spanning the terminal width, with the app
 * label on the left and the hotkey reference on the right. The middle
 * spacer is plain spaces with the same background colour so the row reads
 * as one continuous strip, and the bar gets one row of vertical padding
 * above and below.
 */
function Header({
  cols,
  isActive,
  pressed,
}: {
  cols: number;
  isActive: boolean;
  pressed: string | null;
}) {
  const label = " Resumable streaming ";
  /** Visible-character version of the hotkey strip, used to size the spacer. */
  const hotkeysVisible = " s start  r resume  a abort  q quit ";
  const gap = Math.max(0, cols - label.length - hotkeysVisible.length);
  const padRow = " ".repeat(cols);

  return (
    <Box width={cols} flexDirection="column">
      <Text backgroundColor={BAR_BG}>{padRow}</Text>
      <Box width={cols} flexDirection="row">
        <Text backgroundColor={BAR_BG} color="white" bold>{label}</Text>
        <Text backgroundColor={BAR_BG}>{" ".repeat(gap)}</Text>
        <Text backgroundColor={BAR_BG}>
          {" "}
          <HotKey letter="s" label="start"  enabled={!isActive} pressed={pressed === "s"} />
          {"  "}
          <HotKey letter="r" label="resume" enabled={true}      pressed={pressed === "r"} />
          {"  "}
          <HotKey letter="a" label="abort"  enabled={isActive}  pressed={pressed === "a"} />
          {"  "}
          <HotKey letter="q" label="quit"   enabled={true}      pressed={pressed === "q"} />
          {" "}
        </Text>
      </Box>
      <Text backgroundColor={BAR_BG}>{padRow}</Text>
    </Box>
  );
}

/**
 * Status bar — solid background spanning the terminal width with one row
 * of vertical padding above and below.
 *
 *  - chat:    5-character chat id passed to the server as the stream id
 *  - elapsed: time the producer stream has been running (frozen on end)
 *  - chunks:  chunk count from the original producer stream
 *  - clients: total panels ever spawned this session
 *  - status:  lifecycle of the current stream — initial / streaming /
 *             aborted / finished. Colour-coded to make abort vs. clean
 *             completion easy to tell apart at a glance.
 */
const STREAM_STATUS_COLOR: Record<StreamStatus, string> = {
  initial: "gray",
  streaming: "cyan",
  aborted: "red",
  finished: "green",
};

function Footer({
  cols,
  chatId,
  elapsed,
  chunks,
  clientCount,
  status,
}: {
  cols: number;
  chatId: string;
  elapsed: string;
  chunks: number;
  clientCount: number;
  status: StreamStatus;
}) {
  /** Plain-text version to measure visible width for the trailing spacer. */
  const visible = ` chat: ${chatId}  ·  elapsed: ${elapsed}s  ·  chunks: ${chunks}  ·  clients: ${clientCount}  ·  status: ${status} `;
  const gap = Math.max(0, cols - visible.length);
  const padRow = " ".repeat(cols);

  return (
    <Box width={cols} flexDirection="column">
      <Text backgroundColor={BAR_BG}>{padRow}</Text>
      <Box width={cols} flexDirection="row">
        <Text backgroundColor={BAR_BG} color="white">
          {" chat: "}
          <Text bold>{chatId}</Text>
          {"  ·  elapsed: "}
          <Text bold>{elapsed}s</Text>
          {"  ·  chunks: "}
          <Text bold>{chunks}</Text>
          {"  ·  clients: "}
          <Text bold>{clientCount}</Text>
          {"  ·  status: "}
          <Text bold color={STREAM_STATUS_COLOR[status]}>{status}</Text>
          {" "}
        </Text>
        <Text backgroundColor={BAR_BG}>{" ".repeat(gap)}</Text>
      </Box>
      <Text backgroundColor={BAR_BG}>{padRow}</Text>
    </Box>
  );
}

function ClientPanel({
  client,
  startedAt,
}: {
  client: Client;
  startedAt: number | null;
}) {
  /**
   * Once a stream has finished, an abort flag flips the green ✓ into a
   * red ✗ to make it visually clear that the end was forced rather than
   * natural. While the stream is still in flight we keep the live glyph
   * (●/○) so the abort animation isn't lost.
   */
  const status =
    client.status === "done" && client.aborted
      ? { glyph: "✗", color: "red" }
      : STATUS_GLYPH[client.status];
  const joinedRel = startedAt
    ? `+${((client.joinedAt - startedAt) / 1_000).toFixed(1)}s`
    : "+0.0s";

  return (
    <Box
      width={30}
      flexDirection="column"
      borderStyle="round"
      paddingX={1}
      marginRight={1}
      marginBottom={1}
    >
      <Box justifyContent="space-between">
        <Text color={KIND_COLOR[client.kind]} bold>
          {client.label}
        </Text>
        <Text color={status.color}>{status.glyph}</Text>
      </Box>
      <Text dimColor>
        joined {joinedRel} · {client.chunkCount} chunks
      </Text>
      <Box marginTop={1}>
        <Text>{client.text || " "}</Text>
      </Box>
    </Box>
  );
}

/**
 * Switch to the terminal's alternate screen buffer so the TUI takes over
 * the whole window without disturbing the user's scrollback. The matching
 * leave-sequence restores the original screen contents on quit.
 *
 *   \x1b[?1049h  enter alternate screen
 *   \x1b[H       move cursor to top-left
 *   \x1b[2J      clear the screen
 *   \x1b[?1049l  leave alternate screen (restores prior contents)
 */
process.stdout.write("\x1b[?1049h\x1b[H\x1b[2J");

let restored = false;
const restoreScreen = () => {
  if (restored) return;
  restored = true;
  process.stdout.write("\x1b[?1049l");
};

const app = render(<App />);
app.waitUntilExit().finally(restoreScreen);

/** Belt-and-braces: restore on any process exit path. */
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => {
    restoreScreen();
    process.exit(0);
  });
}
process.on("exit", restoreScreen);
