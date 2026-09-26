import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetRoomQueryKey, getGetRoomSuggestionsQueryKey,
  useGetRoomSuggestions, useSearchRoomSuggestions, useUpdateParticipantLocation,
  type Participant, type Room, type RoomSuggestions, type UnderstandingInsight,
} from '@workspace/api-client-react';

type Props = {
  roomId: string;
  participant?: Participant;
  browserIdentity?: string;
  insights: UnderstandingInsight[];
  onShowInsight: (id: string) => void;
};

function LocationEditor({ roomId, participant, browserIdentity, suggested }: {
  roomId: string;
  participant: Participant;
  browserIdentity: string;
  suggested?: UnderstandingInsight;
}) {
  const queryClient = useQueryClient();
  const updateLocation = useUpdateParticipantLocation({
    request: { headers: { 'X-Milo-Browser-Identity': browserIdentity } },
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(participant.originLabel ?? suggested?.value ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(participant.originLabel ?? suggested?.value ?? '');
  }, [participant.originLabel, suggested?.id, suggested?.value, editing]);

  function save(originLabel: string | null, sourceInsightId: string | null) {
    if (updateLocation.isPending) return;
    setError(null);
    setSaved(false);
    updateLocation.mutate({ id: roomId, participantId: participant.id, data: { originLabel, sourceInsightId } }, {
      onSuccess: (updated) => {
        queryClient.setQueryData<Room>(getGetRoomQueryKey(roomId), (room) =>
          room ? { ...room, participants: room.participants.map((person) => person.id === updated.id ? updated : person) } : room);
        setEditing(false);
        setSaved(true);
        void queryClient.invalidateQueries({ queryKey: getGetRoomQueryKey(roomId) });
        void queryClient.invalidateQueries({ queryKey: getGetRoomSuggestionsQueryKey(roomId) });
      },
      onError: () => setError('Couldn’t save your area. Check it and try again.'),
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const area = draft.trim();
    if (!area || area.length > 100) {
      setError('Enter an approximate area of 100 characters or fewer, or use Clear.');
      return;
    }
    save(area, suggested && area === suggested.value.trim() ? suggested.id : null);
  }

  return (
    <div className="workspace-location" data-testid="section-own-location">
      <div className="workspace-location-heading">
        <h3>Your starting area</h3><span className="workspace-footnote">Only you can edit</span>
      </div>
      <p>Only an approximate area is shown to this room. Milo never asks for GPS or your exact address.</p>
      {participant.originLabel ? (
        <div className="workspace-location-suggestion">
          <span className="workspace-footnote">Shared with the room</span>
          <p data-testid="text-own-location">{participant.originLabel}</p>
        </div>
      ) : suggested ? (
        <div className="workspace-location-suggestion">
          <span className="workspace-footnote">Heard in the conversation · not shared as your area yet</span>
          <p data-testid="text-suggested-location">{suggested.value}</p>
        </div>
      ) : <p>No starting area confirmed yet. You can add one whenever you’re ready.</p>}
      {editing ? (
        <form className="workspace-location-form" onSubmit={submit} noValidate data-testid="form-own-location">
          <label htmlFor="own-area">Approximate neighbourhood or area</label>
          <input id="own-area" className="workspace-input" value={draft} maxLength={100}
            onChange={(event) => { setDraft(event.target.value); setError(null); }}
            placeholder="e.g. North side" autoComplete="off" data-testid="input-own-location" />
          <div className="workspace-location-actions">
            <button type="submit" className="workspace-suggestions-button" disabled={updateLocation.isPending} data-testid="button-save-location">
              {updateLocation.isPending ? 'Saving…' : 'Save area'}
            </button>
            <button type="button" className="workspace-suggestions-text-button" onClick={() => { setEditing(false); setError(null); }} data-testid="button-cancel-location">Cancel</button>
          </div>
        </form>
      ) : (
        <div className="workspace-location-actions">
          {!participant.originLabel && suggested && (
            <button type="button" className="workspace-suggestions-button" disabled={updateLocation.isPending}
              onClick={() => save(suggested.value.trim(), suggested.id)} data-testid="button-confirm-location">
              {updateLocation.isPending ? 'Saving…' : 'Confirm this area'} <ArrowRight size={14} aria-hidden="true" />
            </button>
          )}
          <button type="button" className="workspace-suggestions-text-button"
            onClick={() => { setDraft(participant.originLabel ?? suggested?.value ?? ''); setEditing(true); setSaved(false); }}
            disabled={updateLocation.isPending} data-testid="button-edit-location">
            {participant.originLabel ? 'Edit area' : suggested ? 'Use a different area' : 'Add an area'}
          </button>
          {participant.originLabel && <button type="button" className="workspace-suggestions-text-button"
            onClick={() => save(null, null)} disabled={updateLocation.isPending} data-testid="button-clear-location">Clear area</button>}
        </div>
      )}
      {error && <p className="workspace-error-text" role="alert" data-testid="error-own-location">{error}</p>}
      {saved && <p role="status" data-testid="status-own-location-saved">Your area has been updated.</p>}
    </div>
  );
}

const verdictLabels = {
  met: 'Works',
  failed: 'Does not meet this',
  unknown: 'Not verified',
  not_applicable: 'Not applicable',
} as const;

function RoomSuggestions({ roomId, participant, browserIdentity, insights, onShowInsight }: Props) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useGetRoomSuggestions(roomId, {
    request: { headers: { 'X-Milo-Browser-Identity': browserIdentity ?? '' } },
    query: {
      enabled: !!roomId && !!participant && !!browserIdentity,
      queryKey: getGetRoomSuggestionsQueryKey(roomId),
      retry: false,
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === 'pending' || status === 'processing' ? 2500 : false;
      },
    },
  });
  const search = useSearchRoomSuggestions({
    request: { headers: { 'X-Milo-Browser-Identity': browserIdentity ?? '' } },
  });
  const [searchError, setSearchError] = useState<string | null>(null);
  const suggested = insights.find((insight) => insight.kind === 'starting_location'
    && insight.scope === 'participant' && insight.participantId === participant?.id && insight.status === 'active');
  const working = search.isPending || data?.status === 'pending' || data?.status === 'processing';
  const providerUnavailable = data?.providerAvailable === false;
  const canRequest = !!participant && !!browserIdentity && data?.canSearch && !providerUnavailable && !working;

  function requestSearch() {
    if (!canRequest || !participant) return;
    setSearchError(null);
    search.mutate({ id: roomId, data: { participantId: participant.id } }, {
      onSuccess: (accepted) => {
        queryClient.setQueryData<RoomSuggestions>(getGetRoomSuggestionsQueryKey(roomId), (current) =>
          current ? { ...current, status: accepted.status, runId: accepted.runId } : current);
        void queryClient.invalidateQueries({ queryKey: getGetRoomSuggestionsQueryKey(roomId) });
      },
      onError: () => {
        setSearchError('Couldn’t start the search. Please try again.');
        void queryClient.invalidateQueries({ queryKey: getGetRoomSuggestionsQueryKey(roomId) });
      },
    });
  }

  return (
    <section className="workspace-panel workspace-panel-suggestions" aria-labelledby="suggestions-heading" data-testid="section-suggestions">
      <div className="workspace-panel-top"><span className="workspace-panel-label">03 / SUGGESTIONS</span></div>
      <div className="workspace-panel-body">
        <h2 id="suggestions-heading">Find a place together.</h2>
        <p className="workspace-suggestions-lede">When the group is ready, ask Milo to look for restaurants that take everyone into account. Nothing is searched until someone asks.</p>

        {!participant && <div className="workspace-suggestions-note"><p>Join the room to see restaurant options. Everyone in the room can see the same results.</p></div>}
        {participant && isLoading && <div className="workspace-suggestions-skeleton" role="status" aria-label="Loading suggestions" data-testid="status-suggestions-loading"><span /><span /><span /></div>}
        {isError && <div className="workspace-suggestions-note is-error" role="alert" data-testid="error-suggestions-load">
          <p>Couldn’t load the latest options.</p>
          <button type="button" className="workspace-suggestions-text-button" onClick={() => { void refetch(); }} data-testid="button-retry-suggestions-load">Try again</button>
        </div>}

        {participant && browserIdentity && data && <>
          {providerUnavailable && <div className="workspace-suggestions-note" role="status" data-testid="status-provider-unavailable"><p>Restaurant search isn’t available here right now. The places provider hasn’t been connected.</p></div>}
          {!providerUnavailable && !data.canSearch && data.readinessMessage && <div className="workspace-suggestions-note" data-testid="status-suggestions-readiness"><p>{data.readinessMessage}</p></div>}
          {!providerUnavailable && data.missingParticipantNames.length > 0 && <div className="workspace-suggestions-note" data-testid="status-suggestions-missing-areas"><p>Still waiting for an approximate starting area from {data.missingParticipantNames.join(', ')}. Each person confirms their own area.</p></div>}
           {data.stale && <div className="workspace-suggestions-note" role="status" data-testid="status-suggestions-stale"><p>Your group changed something. Refresh options to reflect the latest conversation and starting areas.</p></div>}
          {working && <div className="workspace-suggestions-note" role="status" data-testid="status-suggestions-working">
            <p>{data.status === 'processing' ? 'Milo is checking restaurant options for the group.' : 'Your search is in line. Milo will check for options shortly.'}</p>
            <div className="workspace-suggestions-skeleton" aria-hidden="true"><span /><span /><span /></div>
          </div>}
          {data.status === 'failed' && <div className="workspace-suggestions-note is-error" role="alert" data-testid="status-suggestions-failed">
            <p>The restaurant search didn’t finish{data.errorCode ? ` (${data.errorCode.replace(/[_-]/g, ' ').toLowerCase()})` : ''}. No new options were added. You can try again.</p>
          </div>}
           {data.errorCode === 'details_limit_reached' && <div className="workspace-suggestions-note is-error" role="status"><p>This search has reached its restaurant-detail viewing limit. Ask Milo to refresh options when the group is ready.</p></div>}
           {!working && data.status === 'ready' && !data.stale && !data.errorCode && data.suggestions.length === 0 && <div className="workspace-suggestions-note" role="status" data-testid="status-suggestions-empty"><p>Nothing matched what Milo knows so far. Keep talking or confirm another area, then try again.</p></div>}
          {data.status === 'idle' && !data.readinessMessage && <div className="workspace-suggestions-note" data-testid="status-suggestions-idle"><p>No options yet. Confirm your starting areas, then ask Milo to look.</p></div>}
          <div className="workspace-suggestions-actions">
            <button type="button" className="workspace-suggestions-button" onClick={requestSearch}
              disabled={!canRequest} data-testid="button-search-suggestions">
              {working ? 'Finding options…' : data.status === 'ready' ? 'Refresh options' : data.status === 'failed' ? 'Try search again' : 'Find restaurant options'}
              {!working && <ArrowRight size={15} aria-hidden="true" />}
            </button>
          </div>
          {searchError && <p className="workspace-error-text" role="alert" data-testid="error-suggestions-search">{searchError}</p>}
          {data.suggestions.length > 0 && <ol className="workspace-suggestion-list" data-testid="list-restaurant-suggestions">
            {data.suggestions.map((option, index) => {
              const hardFailures = option.reasons.some((reason) => reason.strength === 'hard_constraint' && reason.verdict === 'failed');
              const fitLabel = hardFailures ? 'Hard requirement not met' : option.fit === 'verified' ? 'Verified fit' : option.fit === 'tradeoff' ? 'Tradeoff' : 'Partly verified';
              return <li className="workspace-suggestion-item" key={option.id} data-testid={`item-suggestion-${option.id}`}>
                <span className="workspace-suggestion-index">OPTION {String(index + 1).padStart(2, '0')}</span>
                <div className="workspace-suggestion-title-row"><h3>{option.name}</h3><span className={`workspace-suggestion-fit${hardFailures || option.fit === 'tradeoff' ? ' is-tradeoff' : ''}`}>{fitLabel}</span></div>
                {option.address && <p data-testid={`text-suggestion-address-${option.id}`}>{option.address}</p>}
                <div className="workspace-suggestion-facts">
                   {option.category && <span>{option.category.replaceAll('_', ' ')}</span>}
                   {option.priceLevel && <span>Price tier · {option.priceLevel.replace('PRICE_LEVEL_', '').replaceAll('_', ' ').toLowerCase()}</span>}
                  {option.rating != null && <span>Google rating {option.rating.toFixed(1)} / 5</span>}
                  {option.openingLabel && <span>{option.openingLabel}</span>}
                </div>
                {option.reasons.length > 0 && <div className="workspace-suggestion-reasons" aria-label={`Why ${option.name} was suggested`}>
                  {option.reasons.map((reason, reasonIndex) => <div className="workspace-suggestion-reason" key={`${reason.insightId ?? 'unlinked'}-${reasonIndex}`}>
                    <span>{reason.label}{reason.insightId && insights.some((item) => item.id === reason.insightId) && <> · <button type="button" className="workspace-suggestions-text-button" onClick={() => onShowInsight(reason.insightId!)} data-testid={`button-source-insight-${option.id}-${reasonIndex}`}>See source</button></>}</span>
                    <span className={`workspace-suggestion-reason-label is-${reason.verdict}`}>{reason.strength === 'hard_constraint' ? 'Must have · ' : ''}{verdictLabels[reason.verdict]}</span>
                  </div>)}
                </div>}
                <div className="workspace-suggestion-travel">
                   {option.travel.map((travel) => <span key={travel.participantId}>{travel.participantName}: {travel.minutes == null ? 'travel time unavailable' : `about ${travel.minutes} min drive`}</span>)}
                  <span className="workspace-suggestion-travel-label">{option.travelCoverage}</span>
                </div>
                <div className="workspace-suggestion-footer">
                  {option.mapsUrl && /^https?:\/\//i.test(option.mapsUrl) && <a className="workspace-suggestions-link" href={option.mapsUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-suggestion-maps-${option.id}`}>View on Google Maps <ExternalLink size={13} aria-hidden="true" /></a>}
                </div>
                 {option.attributions.map((attribution, attributionIndex) => (
                   <p className="workspace-suggestion-attribution" key={`${attribution.provider}-${attributionIndex}`}>
                     Credit: {attribution.providerUri && /^https?:\/\//i.test(attribution.providerUri)
                       ? <a href={attribution.providerUri} target="_blank" rel="noopener noreferrer">{attribution.provider}</a>
                       : attribution.provider}
                   </p>
                 ))}
              </li>;
            })}
          </ol>}
           {data.suggestions.length > 0 && <p className="workspace-suggestions-attribution" aria-label="Google Maps attribution">Restaurant details and ratings from <strong>Google Maps</strong>. Check details with the restaurant before you go.</p>}
        </>}
        {participant && browserIdentity && <LocationEditor key={`${participant.id}-${participant.originUpdatedAt ?? ''}`} roomId={roomId} participant={participant} browserIdentity={browserIdentity} suggested={suggested} />}
      </div>
      <div className="workspace-panel-bottom workspace-footnote">{data?.status === 'ready' ? `${data.suggestions.length} restaurant ${data.suggestions.length === 1 ? 'option' : 'options'}` : working ? 'Looking for the group' : 'Search only when you ask'}</div>
    </section>
  );
}

export default RoomSuggestions;