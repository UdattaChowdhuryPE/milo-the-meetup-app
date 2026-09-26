import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy, Link2 } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { getGetRoomQueryKey, useGetRoom } from '@workspace/api-client-react';
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
    query: { enabled: valid, queryKey: getGetRoomQueryKey(id), retry: false },
  });
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied' | 'manual'>('idle');
  const urlInputRef = useRef<HTMLInputElement>(null);
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const shareUrl = typeof window === 'undefined' ? '' : `${window.location.origin}${base}/room/${encodeURIComponent(id)}`;

  useEffect(() => {
    setRoomMeta(room ? `${room.name} — Milo` : 'Room — Milo', room
      ? `A space for ${room.name} on Milo. Make room for everyone.`
      : 'Open a room on Milo, a space to make plans with your friends.');
  }, [room?.name]);

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
        <div className="workspace-room-rule">
          <div className="workspace-participants" aria-label="Room participants" data-testid="list-room-participants">
            <span className="workspace-index">In this room / {room.participants.length}</span>
            {room.participants.map((person) => (
              <div className="workspace-person" key={person.id} data-testid={`participant-${person.id}`}>
                <span className="workspace-avatar" aria-hidden="true">{person.name.trim().charAt(0).toUpperCase()}</span>
                <span data-testid={`text-participant-name-${person.id}`}>{person.name}</span>
                <span className="workspace-person-role">{person.role}</span>
              </div>
            ))}
          </div>
          <span className="workspace-footnote" data-testid="text-participants-hint">Just the creator for now · Share the room link with friends</span>
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
          <section className="workspace-panel workspace-panel-conversation" aria-labelledby="conversation-heading" data-testid="section-conversation">
            <div className="workspace-panel-top"><span className="workspace-panel-label">01 / CONVERSATION</span><span className="workspace-index">The starting point</span></div>
            <div className="workspace-panel-ornament" aria-hidden="true" />
            <div className="workspace-panel-body">
              <span className="workspace-panel-symbol" aria-hidden="true" />
              <h2 id="conversation-heading">The conversation starts here.</h2>
              <p>There’s nothing to read yet. A space for the group’s conversation will live here when it’s available.</p>
            </div>
            <div className="workspace-panel-bottom workspace-footnote">No messages yet</div>
          </section>
          <div className="workspace-side">
            <section className="workspace-panel workspace-panel-understanding" aria-labelledby="understanding-heading" data-testid="section-understanding">
              <div className="workspace-panel-top"><span className="workspace-panel-label">02 / MILO’S UNDERSTANDING</span></div>
              <div className="workspace-panel-body">
                <h2 id="understanding-heading">A clearer picture, in time.</h2>
                <p>Milo doesn’t know what the group wants yet. This space will eventually bring everyone’s wants into focus.</p>
              </div>
              <div className="workspace-panel-bottom workspace-footnote">Nothing to understand yet</div>
            </section>
            <section className="workspace-panel workspace-panel-suggestions" aria-labelledby="suggestions-heading" data-testid="section-suggestions">
              <div className="workspace-panel-top"><span className="workspace-panel-label">03 / SUGGESTIONS</span></div>
              <div className="workspace-panel-body">
                <h2 id="suggestions-heading">The good options come later.</h2>
                <p>No suggestions yet. When this part of Milo is ready, options that consider everyone will appear here.</p>
              </div>
              <div className="workspace-panel-bottom workspace-footnote">No options yet</div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

export default RoomPage;