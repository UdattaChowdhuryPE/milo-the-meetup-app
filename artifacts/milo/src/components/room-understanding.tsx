import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import '../understanding.css';

type Insight = {
  id: string;
  kind: string;
  value: string;
  scope: 'group' | 'participant';
  participantId: string | null;
  strength: 'hard_constraint' | 'strong_preference' | 'preference';
  confidence: 'high' | 'medium' | 'low';
  status: 'active' | 'superseded' | 'conflicting' | 'uncertain';
  sourceMessageIds: string[];
  supersedesInsightId: string | null;
};

type Participant = { id: string; name: string };
type SourceMessage = { id: string; senderName: string; content: string };

type RoomUnderstandingProps = {
  focusInsightId?: string | null;
  insights: Insight[];
  participants: Participant[];
  messages: SourceMessage[] | undefined;
  analysisStatus: 'idle' | 'pending' | 'processing' | 'failed';
  updatedAt: string | null;
  isLoading: boolean;
  loadError: boolean;
  onRetry: () => void;
  isRetrying: boolean;
};

function readableKind(kind: string) {
  return kind.replace(/[_-]+/g, ' ').trim() || 'A note from the group';
}

function updatedLabel(updatedAt: string | null) {
  if (!updatedAt) return null;
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return null;
  return `Updated ${new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date)}`;
}

function RoomUnderstanding({
  focusInsightId,
  insights,
  participants,
  messages,
  analysisStatus,
  updatedAt,
  isLoading,
  loadError,
  onRetry,
  isRetrying,
}: RoomUnderstandingProps) {
  const [openInsightId, setOpenInsightId] = useState<string | null>(null);
  useEffect(() => {
    if (!focusInsightId) return;
    setOpenInsightId(focusInsightId);
    requestAnimationFrame(() => document.getElementById(`understanding-insight-${focusInsightId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, [focusInsightId]);
  // Superseded notes have been replaced; showing them as current would misrepresent the group.
  const currentInsights = insights.filter((insight) => insight.status !== 'superseded');
  const hasInsights = currentInsights.length > 0;
  const loadingWithoutInsights = isLoading && !hasInsights && !loadError;
  const analyzing = analysisStatus === 'pending' || analysisStatus === 'processing';
  const hasError = loadError || analysisStatus === 'failed';
  const lastUpdated = updatedLabel(updatedAt);

  return (
    <section
      className={`workspace-panel workspace-panel-understanding${hasInsights ? ' has-insights' : ''}`}
      aria-labelledby="understanding-heading"
      data-testid="section-understanding"
    >
      <div className="workspace-panel-top">
        <span className="workspace-panel-label">02 / MILO’S UNDERSTANDING</span>
        {hasInsights && <span className="workspace-understanding-top-note" data-testid="text-understanding-count">{currentInsights.length} {currentInsights.length === 1 ? 'note' : 'notes'}</span>}
      </div>

      <div className="workspace-panel-body workspace-understanding-body">
        <div className="workspace-understanding-intro" key={hasInsights ? 'heard' : 'waiting'}>
          <h2 id="understanding-heading">{hasInsights ? 'Here’s what I’m hearing.' : 'A clearer picture, in time.'}</h2>
          {!hasInsights && !loadingWithoutInsights && (
            <p>
              {hasError
                ? 'Milo couldn’t check the conversation just now. Nothing has been added or guessed.'
                : analyzing
                  ? 'Milo is listening for what matters to everyone. Notes will appear here when there’s something useful to reflect.'
                  : 'As the conversation grows, Milo will keep track of what matters to everyone here.'}
            </p>
          )}
          {hasInsights && <p>From the conversation so far. Tap a note to see the words behind it.</p>}
        </div>

        {loadingWithoutInsights && (
          <div className="workspace-understanding-skeleton" role="status" aria-label="Loading understanding" data-testid="status-understanding-loading">
            <span /><span /><span />
          </div>
        )}

        {hasInsights && (
          <ul className="workspace-understanding-list" data-testid="list-understanding-insights">
            {currentInsights.map((insight, index) => {
              const isOpen = openInsightId === insight.id;
              const personName = insight.scope === 'group'
                ? 'Everyone'
                : participants.find((person) => person.id === insight.participantId)?.name ?? 'Participant';
              const sources = insight.sourceMessageIds.map((id) => messages?.find((message) => message.id === id));
              const availableSources = sources.filter((source): source is SourceMessage => source !== undefined);
              const unavailableCount = insight.sourceMessageIds.length - availableSources.length;
              const regionId = `understanding-sources-${index}`;
               const tentativeLabel = insight.status === 'conflicting'
                 ? 'Different views in the group'
                : insight.status === 'uncertain' || insight.confidence === 'low'
                  ? 'Still taking shape'
                   : insight.confidence === 'medium' ? 'Taking shape' : null;
               const strengthLabel = insight.strength === 'hard_constraint'
                 ? 'Must have'
                 : insight.strength === 'strong_preference' ? 'Strong preference' : 'Preference';
               const previous = insights.find((item) => item.id === insight.supersedesInsightId);

              return (
                <li
                   id={`understanding-insight-${insight.id}`}
                  className="workspace-understanding-item"
                  key={`${insight.id}:${insight.value}:${insight.status}:${insight.scope}:${insight.participantId}`}
                  data-testid={`item-understanding-${insight.id}`}
                >
                  <div className="workspace-understanding-item-head">
                    <span className="workspace-understanding-kind">{readableKind(insight.kind)}</span>
                    <span className="workspace-understanding-person" data-testid={`text-understanding-person-${insight.id}`}>{personName}</span>
                  </div>
                  <p className="workspace-understanding-value" data-testid={`text-understanding-value-${insight.id}`}>{insight.value}</p>
                   {strengthLabel && <span className="workspace-understanding-strength">{strengthLabel}</span>}
                  {tentativeLabel && <span className="workspace-understanding-status" data-testid={`text-understanding-status-${insight.id}`}>{tentativeLabel}</span>}
                   {previous && <span className="workspace-understanding-previous">Previously: {previous.value}</span>}
                  <div>
                    <button
                      className="workspace-understanding-source-toggle"
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={regionId}
                      onClick={() => setOpenInsightId(isOpen ? null : insight.id)}
                      data-testid={`button-understanding-sources-${insight.id}`}
                    >
                      {isOpen ? 'Hide original words' : 'See original words'}
                      <ChevronDown size={14} aria-hidden="true" />
                    </button>
                  </div>
                  {isOpen && (
                    <div className="workspace-understanding-sources" id={regionId} data-testid={`detail-understanding-sources-${insight.id}`}>
                       <span className="workspace-understanding-based-on">Based on:</span>
                      {availableSources.map((source) => (
                        <figure className="workspace-understanding-quote" key={source.id} data-testid={`quote-understanding-${insight.id}-${source.id}`}>
                          <blockquote>“{source.content}”</blockquote>
                          <figcaption>— {source.senderName}</figcaption>
                        </figure>
                      ))}
                      {unavailableCount > 0 && (
                        <p className="workspace-understanding-source-unavailable" data-testid={`text-understanding-unavailable-${insight.id}`}>
                          {messages === undefined
                            ? 'Original messages are still loading.'
                            : unavailableCount === 1
                              ? 'One original message isn’t available here yet.'
                              : `${unavailableCount} original messages aren’t available here yet.`}
                        </p>
                      )}
                      {insight.sourceMessageIds.length === 0 && (
                        <p className="workspace-understanding-source-unavailable" data-testid={`text-understanding-unavailable-${insight.id}`}>
                          No original message was linked to this note.
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {hasError && (
          <div className="workspace-understanding-notice is-error" role="alert" data-testid="status-understanding-error">
            {hasInsights && <p>Couldn’t check for newer notes. These are the last ones Milo heard.</p>}
            <button className="workspace-understanding-retry" type="button" onClick={onRetry} disabled={isRetrying} data-testid="button-retry-understanding">
              {isRetrying ? 'Trying again…' : 'Try again'}
            </button>
          </div>
        )}
        {!hasError && analyzing && hasInsights && (
          <div className="workspace-understanding-notice" role="status" data-testid="status-understanding-pending">
            <p>Milo is checking the latest conversation. These notes may change.</p>
          </div>
        )}
      </div>

      <div className="workspace-panel-bottom workspace-footnote workspace-understanding-bottom" data-testid="text-understanding-footer">
        {hasError
          ? 'Couldn’t update just now'
          : loadingWithoutInsights
            ? 'Opening the conversation'
            : analyzing
              ? 'Listening to the conversation'
              : hasInsights
                ? lastUpdated ?? 'Drawn from the conversation'
                : 'Nothing to understand yet'}
      </div>
    </section>
  );
}

export default RoomUnderstanding;