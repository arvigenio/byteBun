import { Icon } from './ui/Icon.jsx';

// Decorative chat preview. role="img" + aria-label gives screen readers one summary and
// makes the inner text presentational.
export function ChatMock({ chat }) {
  return (
    <div role="img" aria-label={chat.ariaLabel} className="mx-auto w-full max-w-[420px] rounded-chat border border-line bg-lavender-mist p-5">
      <div className="mb-3.5 flex items-center gap-2 text-[13px] font-semibold">
        <span className="size-[9px] rounded-full bg-circuit-teal" />
        {chat.header}
        <small className="ml-auto text-[13px] font-normal text-muted">{chat.badge}</small>
      </div>
      {chat.messages.map((m, i) =>
        m.from === 'user' ? (
          <div key={i} className="mb-[9px] max-w-[86%] rounded-[14px] rounded-bl-[4px] bg-cream-dough px-3.5 py-2.5 text-[13px]">
            {m.text}
          </div>
        ) : (
          <div key={i} className="mb-[9px] ml-auto max-w-[86%] rounded-[14px] rounded-br-[4px] bg-byte-purple px-3.5 py-2.5 text-[13px] text-cream-dough">
            {m.text}
          </div>
        ),
      )}
      <div className="flex items-center gap-2 rounded-btn bg-cream-dough px-3 py-[9px] text-[13px] font-semibold">
        <Icon name="calendar" className="size-[18px] flex-none" strokeWidth={2} />
        {chat.confirmation}
      </div>
    </div>
  );
}
