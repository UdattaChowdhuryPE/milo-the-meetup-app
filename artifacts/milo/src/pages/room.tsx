import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy, Link2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'wouter';
import {
  getGetRoomMessagesQueryKey, getGetRoomQueryKey, getGetRoomSuggestionsQueryKey, getGetRoomUnderstandingQueryKey,
  useGetRoom, useGetRoomMessages, useGetRoomUnderstanding, useJoinRoom, useRetryRoomUnderstanding,
  type Room,
} from '@workspace/api-client-react';
import { readRoomMembership, saveRoomMembership } from '@/lib/room-membership';
import RoomConversation from '@/components/room-conversation';
import RoomUnderstanding from '@/components/room-understanding';
import RoomSuggestions from '@/components/room-suggestions';
import '../rooms.css';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function setRoomMeta(title: string, description: string) {
  document.title = title;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'description';
    document.head.appendChild(meta);
  }
  meta.content = description;
}

function RoomHeader() {
  return (
    <header className="workspace-topbar">
      <Link href="/" className="workspace-brand" aria-label="Milo home" data-testid="link-room-milo-home">
        <span className="workspace-brand-mark" aria-hidden="true">m</span>Milo
      </Link>
      <span className="workspace-top-note">A space for your group</span>
      <Link href="/create-room" className="workspace-back" data-testid="link-room-create-another"><ArrowLeft size={15} aria-hidden="true" /> New room</Link>
    </header>
  );
}

function RoomState({ kind, retry }: { kind: 'invalid' | 'missing' | 'error' | 'loading'; retry?: () => void }) {
  const content = {
    invalid: { label: 'NOT QUITE RIGHT', title: 'That link looks incomplete.', body: 'Check the room link and try again. A room link includes a unique ID.' },
    missing: { label: 'ROOM NOT FOUND', title: 'No room at this address.', body: 'The link may have changed or the room may no longer be available. Check with the person who sent it.' },
    error: { label: 'COULDN’T LOAD', title: 'We lost the thread.', body: 'Something went wrong while opening this room. Your link is still here; try loading it again.' },
    loading: { label: 'OPENING ROOM', title: 'Making space.', body: '' },
  }[kind];
  return (
    <main className="milo-workspace" data-testid={`page-room-${kind}`}>
      <RoomHeader />
      <section className="workspace-state" aria-live="polite">
        <div className="workspace-index">{content.label}</div>
        {kind === 'loading' ? (
          <div role="status" aria-label="Loading room" data-testid="status-room-loading">
            <div className="workspace-skeleton wide" /><div className="workspace-skeleton medium" /><div className="workspace-skeleton short" />
          </div>
        ) : (
          <>
            <h1 data-testid="text-room-state-title">{content.title}</h1>
            <p data-testid="text-room-state-message">{content.body}</p>
            {kind === 'error' && <button className="workspace-action" onClick={retry} type="button" data-testid="button-retry-room">Try again <ArrowRight size={16} aria-hidden="true" /></button>}
            {kind !== 'error' && <Link href="/create-room" className="workspace-action" data-testid="link-state-create-room">Create a room <ArrowRight size={16} aria-hidden="true" /></Link>}
          </>
        )}
      </section>
    </main>
  );
}

function RoomPage() {
  const params = useParams<{ id: string }>();
  const id = params.id ?? '';
  const valid = UUID_PATTERN.test(id);
  const { data: room, isLoading, isError, error, refetch } = useGetRoom(id, {
    query: { enabled: valid, queryKey: getGetRoomQueryKey(id), retry: false, refetchInterval: 10000 },
  });
  const queryClient = useQueryClient();
  const joinRoom = useJoinRoom();
  const {
    data: understanding, isLoading: isUnderstandingLoading,
    isError: understandingLoadError,
  } = useGetRoomUnderstanding(id, {
    query: {
      enabled: valid,
      queryKey: getGetRoomUnderstandingQueryKey(id),
      retry: false,
      refetchInterval: (query) => {
        const status = query.state.data?.analysisStatus;
        return status === 'pending' || status === 'processing' ? 3000 : 10000;
      },
    },
  });
  const { data: sourceMessages } = useGetRoomMessages(id, {
    query: { enabled: valid, queryKey: getGetRoomMessagesQueryKey(id), retry: false },
  });
  const retryUnderstanding = useRetryRoomUnderstanding();
  const [membership, setMembership] = useState(() => ({ roomId: id, value: readRoomMembership(id) }));
  const [joinName, setJoinName] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied' | 'manual'>('idle');
  const [focusInsightId, setFocusInsightId] = useState<string | null>(null);
  const lastSuggestionsContext = useRef<string | null>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const shareUrl = typeof window === 'undefined' ? '' : `${window.location.origin}${base}/room/${encodeURIComponent(id)}`;

  useEffect(() => {
    setRoomMeta(room ? `${room.name} — Milo` : 'Room — Milo', room
      ? `A space for ${room.name} on Milo. Make room for everyone.`
      : 'Open a room on Milo, a space to make plans with your friends.');
  }, [room?.name]);

  useEffect(() => {
    setMembership({ roomId: id, value: readRoomMembership(id) });
    setJoinName('');
    setJoinError(null);
    lastSuggestionsContext.current = null;
  }, [id]);

  // Refresh readiness/staleness when the group or Milo's understanding changes,
  // without polling a completed restaurant search or requesting new provider details.
  const suggestionsContext = room
    ? `${id}|${understanding?.updatedAt ?? ''}|${room.participants.map((person) => `${person.id}:${person.originUpdatedAt ?? ''}`).join('|')}`
    : null;
  useEffect(() => {
    if (!suggestionsContext) return;
    if (lastSuggestionsContext.current && lastSuggestionsContext.current !== suggestionsContext) {
      void queryClient.invalidateQueries({ queryKey: getGetRoomSuggestionsQueryKey(id) });
    }
    lastSuggestionsContext.current = suggestionsContext;
  }, [suggestionsContext, id, queryClient]);

  async function shareRoom() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(shareUrl);
      setShareStatus('copied');
    } catch {
      setShareStatus('manual');
      requestAnimationFrame(() => { urlInputRef.current?.focus(); urlInputRef.current?.select(); });
    }
  }

  if (!valid) return <RoomState kind="invalid" />;
  if (isLoading) return <RoomState kind="loading" />;
  if (isError) {
    const status = (error as { status?: number; response?: { status?: number } } | null)?.status
      ?? (error as { response?: { status?: number } } | null)?.response?.status;
    return <RoomState kind={status === 404 ? 'missing' : 'error'} retry={() => { void refetch(); }} />;
  }
  if (!room) return <RoomState kind="missing" />;

  const activeMembership = membership.roomId === id ? membership.value : null;
  const currentParticipant = room.participants.find((person) => person.id === activeMembership?.participantId);

  function submitJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (joinRoom.isPending) return;
    const name = joinName.trim();
    if (!name || name.length > 40) {
      setJoinError(name ? 'Use 40 characters or fewer.' : 'Enter your name to join.');
      return;
    }

    const browserIdentity = activeMembership?.browserIdentity ?? window.crypto?.randomUUID?.();
    if (!browserIdentity) {
      setJoinError('Your browser could not create a room identity. Try a modern browser.');
      return;
    }
    if (!saveRoomMembership(id, { browserIdentity })) {
      setJoinError('Your browser could not save your membership. Enable browser storage and try again.');
      return;
    }

    setMembership({ roomId: id, value: { browserIdentity } });
    setJoinError(null);
    joinRoom.mutate({ id, data: { name, browserIdentity } }, {
      onSuccess: (participant) => {
        const nextMembership = { browserIdentity, participantId: participant.id };
        if (!saveRoomMembership(id, nextMembership)) {
          setJoinError('You joined, but your browser could not save your membership for a future visit.');
        }
        setMembership({ roomId: id, value: nextMembership });
        queryClient.setQueryData<Room>(getGetRoomQueryKey(id), (current) => {
          if (!current || current.participants.some((person) => person.id === participant.id)) return current;
          return { ...current, participants: [...current.participants, participant] };
        });
      },
      onError: (joinFailure) => {
        setJoinError((joinFailure as { status?: number }).status === 404
          ? 'This room is no longer available. Refresh the page to check the link.'
          : 'We couldn’t join this room. Please try again.');
      },
    });
  }

  return (
    <main className="milo-workspace" data-testid="page-room">
      <RoomHeader />
      <div className="workspace-room">
        <div className="workspace-room-heading">
          <div>
            <div className="workspace-kicker">Your gathering place</div>
            <h1 data-testid="text-room-name">{room.name}</h1>
            {room.description && <p className="workspace-room-description" data-testid="text-room-description">{room.description}</p>}
          </div>
          <button className="workspace-share" type="button" onClick={shareRoom} data-testid="button-share-room">
            {shareStatus === 'copied' ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
            {shareStatus === 'copied' ? 'Link copied' : 'Share room'}
          </button>
        </div>
        {membership.roomId === id && !currentParticipant && (
          <section className="workspace-join" aria-labelledby="join-heading" data-testid="section-join-room">
            <div>
              <div className="workspace-index">Join this room</div>
              <h2 id="join-heading">You’re invited.</h2>
              <p>Join the room and help figure out where everyone should go.</p>
            </div>
            <form className="workspace-join-form" onSubmit={submitJoin} noValidate data-testid="form-join-room">
              <label className="workspace-field-label" htmlFor="join-name">Your name <span aria-hidden="true">*</span></label>
              <input
                id="join-name"
                className="workspace-input"
                type="text"
                value={joinName}
                onChange={(event) => { setJoinName(event.target.value); setJoinError(null); }}
                placeholder="What should we call you?"
                autoComplete="name"
                maxLength={40}
                required
                aria-describedby={joinError ? 'join-error' : undefined}
                data-testid="input-join-name"
              />
              {joinError && <p id="join-error" className="workspace-error-text" role="alert" data-testid="error-join-room">{joinError}</p>}
              <button className="workspace-submit" type="submit" disabled={joinRoom.isPending} data-testid="button-join-room">
                {joinRoom.isPending ? 'Joining…' : 'Join the room'} {!joinRoom.isPending && <ArrowRight size={16} aria-hidden="true" />}
              </button>
            </form>
          </section>
        )}
        <div className="workspace-room-rule">
          <div className="workspace-participants" aria-label="Room participants" data-testid="list-room-participants">
            <span className="workspace-index">In this room / {room.participants.length}</span>
            {room.participants.map((person) => (
              <div className="workspace-person" key={person.id} data-testid={`participant-${person.id}`}>
                <span className="workspace-avatar" aria-hidden="true">{person.name.trim().charAt(0).toUpperCase()}</span>
                <span data-testid={`text-participant-name-${person.id}`}>{person.name}</span>
                {person.role === 'creator' && <span className="workspace-person-role">Creator</span>}
                 {person.originLabel && <span className="workspace-person-origin">· from {person.originLabel}</span>}
              </div>
            ))}
          </div>
          <span className="workspace-footnote" data-testid="text-participants-hint">
            {currentParticipant ? `You’re here as ${currentParticipant.name} · Share the link with friends` : 'Join to appear here · Share the link with friends'}
          </span>
        </div>
        <div aria-live="polite">
          {shareStatus === 'copied' && <p className="workspace-share-feedback" role="status" data-testid="status-share-room"><Link2 size={15} aria-hidden="true" /> Room link copied to clipboard.</p>}
          {shareStatus === 'manual' && (
            <div className="workspace-share-fallback" role="status" data-testid="status-share-manual">
              <p>Clipboard access isn’t available. Select and copy this link manually to share the room.</p>
              <input ref={urlInputRef} type="text" readOnly value={shareUrl} aria-label="Room link to copy manually" onFocus={(event) => event.currentTarget.select()} data-testid="input-share-url" />
            </div>
          )}
        </div>
        <div className="workspace-room-grid">
          <RoomConversation roomId={id} participant={currentParticipant} browserIdentity={activeMembership?.browserIdentity} onJoinAgain={() => {
            setMembership({ roomId: id, value: null });
            requestAnimationFrame(() => document.getElementById('join-name')?.focus());
          }} />
          <div className="workspace-side">
            <RoomUnderstanding
              focusInsightId={focusInsightId}
              insights={understanding?.insights ?? []}
              participants={room.participants}
              messages={sourceMessages}
              analysisStatus={understanding?.analysisStatus ?? 'idle'}
              updatedAt={understanding?.updatedAt ?? null}
              isLoading={isUnderstandingLoading}
              loadError={understandingLoadError}
              isRetrying={retryUnderstanding.isPending}
              onRetry={() => {
                retryUnderstanding.mutate({ id }, {
                  onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getGetRoomUnderstandingQueryKey(id) }); },
                });
              }}
            />
            <RoomSuggestions
              roomId={id}
              participant={currentParticipant}
              browserIdentity={activeMembership?.browserIdentity}
              insights={understanding?.insights ?? []}
              onShowInsight={(insightId) => {
                setFocusInsightId(null);
                requestAnimationFrame(() => setFocusInsightId(insightId));
              }}
            />
          </div>
        </div>
      </div>
    </main>
  );
}

export default RoomPage;