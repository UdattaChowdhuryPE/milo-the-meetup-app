import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import {
  getGetRoomMessagesQueryKey,
  useGetRoomMessages,
  useSendRoomMessage,
  type Message,
  type Room,
} from '@workspace/api-client-react';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';

type ConversationProps = {
  roomId: string;
  participant: Room['participants'][number] | undefined;
  browserIdentity: string | undefined;
  onJoinAgain: () => void;
};

const MAX_LENGTH = 2000;

function RoomConversation({ roomId, participant, browserIdentity, onJoinAgain }: ConversationProps) {
  const queryClient = useQueryClient();
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [sendError, setSendError] = useState<string | null>(null);
  const form = useForm<{ content: string }>({ defaultValues: { content: '' } });
  const draft = form.watch('content');
  const canSend = Boolean(participant && browserIdentity);
  const { data: messages, isLoading, isError, refetch } = useGetRoomMessages(roomId, {
    query: {
      queryKey: getGetRoomMessagesQueryKey(roomId),
      refetchInterval: 4000,
      refetchOnWindowFocus: true,
      retry: false,
    },
  });
  const sendMessage = useSendRoomMessage({
    request: { headers: { 'X-Milo-Browser-Identity': browserIdentity ?? '' } },
  });

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight;
  }, [messages?.length, roomId]);

  function send({ content }: { content: string }) {
    if (sendMessage.isPending || !participant || !browserIdentity) return;
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > MAX_LENGTH) {
      setSendError(trimmed ? `Keep your message under ${MAX_LENGTH} characters.` : 'Write a message before sending.');
      return;
    }
    setSendError(null);
    sendMessage.mutate({ id: roomId, data: { participantId: participant.id, content: trimmed } }, {
      onSuccess: (sent) => {
        stickToBottom.current = true;
        queryClient.setQueryData<Message[]>(getGetRoomMessagesQueryKey(roomId), (existing) => {
          if (!existing) return [sent];
          if (existing.some((message) => message.id === sent.id)) return existing;
          return [...existing, sent].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
        });
        form.reset({ content: '' });
        void queryClient.invalidateQueries({ queryKey: getGetRoomMessagesQueryKey(roomId) });
      },
      onError: (error) => {
        const status = (error as { status?: number }).status;
        setSendError(status === 403
          ? 'This browser can’t send as that participant. Your message was not sent.'
          : status === 404
            ? 'This room or participant is no longer available. Your message was not sent.'
            : 'Your message was not sent. Please try again.');
      },
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!sendMessage.isPending) void form.handleSubmit(send)();
    }
  }

  return (
    <section className="workspace-panel workspace-panel-conversation" aria-labelledby="conversation-heading" data-testid="section-conversation">
      <div className="workspace-panel-top">
        <span className="workspace-panel-label" id="conversation-heading">01 / CONVERSATION</span>
        <span className="workspace-index">{messages?.length ? `${messages.length} message${messages.length === 1 ? '' : 's'}` : 'The starting point'}</span>
      </div>
      <div className="workspace-panel-ornament" aria-hidden="true" />
      <div className="workspace-conversation-scroll" ref={listRef} onScroll={(event) => {
        const list = event.currentTarget;
        stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 90;
      }} role="log" aria-label="Room conversation" aria-live="polite" data-testid="list-room-messages">
        {isLoading && !messages && <p className="workspace-chat-status" role="status" data-testid="status-messages-loading">Opening the conversation…</p>}
        {isError && !messages && (
          <div className="workspace-chat-status" role="alert" data-testid="error-messages">
            <p>We couldn’t load the conversation.</p>
            <button type="button" onClick={() => { void refetch(); }} data-testid="button-retry-messages">Try again</button>
          </div>
        )}
        {messages?.length === 0 && (
          <div className="workspace-chat-empty" data-testid="status-messages-empty">
            <span className="workspace-panel-symbol" aria-hidden="true" />
            <h2>The conversation starts here.</h2>
            <p>No messages yet. {canSend ? 'What’s on your mind?' : 'Join the room to get the group talking.'}</p>
          </div>
        )}
        {messages?.map((message) => {
          const own = message.participantId === participant?.id;
          const sentAt = new Date(message.createdAt);
          return (
            <article className={`workspace-chat-message${own ? ' is-own' : ''}`} key={message.id} data-testid={`message-${message.id}`}>
              <div className="workspace-chat-meta">
                <span className="workspace-chat-name" data-testid={`text-sender-${message.id}`}>{message.senderName}{own && <span className="workspace-chat-you">YOU</span>}</span>
                <time dateTime={message.createdAt} title={sentAt.toLocaleString()} data-testid={`text-time-${message.id}`}>
                  {sentAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </time>
              </div>
              <p className="workspace-chat-content" data-testid={`text-message-${message.id}`}>{message.content}</p>
            </article>
          );
        })}
        {isError && messages && <p className="workspace-chat-refresh-error" role="status" data-testid="status-messages-refresh-error">Couldn’t refresh the conversation. We’ll keep trying.</p>}
      </div>
      <div className="workspace-chat-footer">
        {!canSend && (
          <div className="workspace-chat-permission" role="status" data-testid="status-message-identity">
            {participant ? (
              <>
                <p>This older membership can’t be verified for sending messages in this browser.</p>
                <button type="button" onClick={onJoinAgain} data-testid="button-rejoin-for-messages">Join as a new participant to chat</button>
              </>
            ) : <p>Join this room to send a message.</p>}
          </div>
        )}
        <Form {...form}>
          <form className="workspace-chat-composer" onSubmit={form.handleSubmit(send)} noValidate data-testid="form-send-message">
            <FormField control={form.control} name="content" rules={{
              validate: (value) => value.trim().length > 0 && value.trim().length <= MAX_LENGTH
                || (value.trim().length === 0 ? 'Write a message before sending.' : `Keep your message under ${MAX_LENGTH} characters.`),
            }} render={({ field }) => (
              <FormItem className="workspace-chat-field">
                <FormControl>
                  <textarea
                    {...field}
                    className="workspace-chat-input"
                    rows={2}
                    maxLength={MAX_LENGTH}
                    placeholder="What are you thinking?"
                    aria-label="Your message"
                    disabled={!canSend || sendMessage.isPending}
                    onKeyDown={handleKeyDown}
                    onChange={(event) => { field.onChange(event); setSendError(null); }}
                    data-testid="input-message"
                  />
                </FormControl>
                <FormMessage className="workspace-error-text" data-testid="error-message-validation" />
              </FormItem>
            )} />
            <button className="workspace-chat-send" type="submit" disabled={!canSend || sendMessage.isPending || !draft?.trim()} data-testid="button-send-message">
              {sendMessage.isPending ? 'Sending…' : 'Send'} {!sendMessage.isPending && <ArrowRight size={16} aria-hidden="true" />}
            </button>
          </form>
        </Form>
        {sendError && <p className="workspace-error-text workspace-chat-send-error" role="alert" data-testid="error-send-message">{sendError}</p>}
        <div className="workspace-chat-hint workspace-footnote">Enter to send · Shift + Enter for a new line</div>
      </div>
    </section>
  );
}

export default RoomConversation;