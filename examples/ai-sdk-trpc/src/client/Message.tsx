import type { MyUIMessage } from "../server/router";

type MessageProps = {
  message: MyUIMessage;
};

export function Message({ message }: MessageProps) {
  const isUser = message.role === `user`;

  return (
    <div
      style={{
        display: `flex`,
        justifyContent: isUser ? `flex-end` : `flex-start`,
        marginBottom: `8px`,
      }}
    >
      <div
        style={{
          maxWidth: `70%`,
          padding: `8px 12px`,
          borderRadius: `8px`,
          backgroundColor: isUser ? `#007bff` : `#e9ecef`,
          color: isUser ? `white` : `black`,
        }}
      >
        <div style={{ fontSize: `12px`, opacity: 0.7, marginBottom: `4px` }}>{message.role}</div>
        <div style={{ whiteSpace: `pre-wrap` }}>
          {message.parts?.map((part, index) => {
            if (part.type === `text`) {
              return <span key={index}>{part.text}</span>;
            }

            return null;
          })}
        </div>
      </div>
    </div>
  );
}
