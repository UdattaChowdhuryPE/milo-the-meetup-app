import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useLocation, Link } from 'wouter';
import { useCreateRoom, type RoomInput } from '@workspace/api-client-react';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { saveRoomMembership } from '@/lib/room-membership';
import '../rooms.css';

type RoomFormValues = { name: string; description: string; creatorName: string };

function CreateRoom() {
  const [, setLocation] = useLocation();
  const createRoom = useCreateRoom();
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [pendingRoom, setPendingRoom] = useState<{ id: string; participantId?: string; browserIdentity: string } | null>(null);
  const form = useForm<RoomFormValues>({
    defaultValues: { name: '', description: '', creatorName: '' },
    mode: 'onSubmit',
  });

  useEffect(() => {
    document.title = 'Create a room — Milo';
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
    }
    meta.content = 'Start a room for your friends on Milo. Give your plan a name and make space for everyone.';
  }, []);

  function onSubmit(values: RoomFormValues) {
    if (pendingRoom) return;
    const browserIdentity = window.crypto?.randomUUID?.();
    if (!browserIdentity) {
      setIdentityError('Your browser could not create a room identity. Try a modern browser.');
      return;
    }
    setIdentityError(null);
    const data: RoomInput = {
      name: values.name.trim(),
      creatorName: values.creatorName.trim(),
      browserIdentity,
      ...(values.description.trim() ? { description: values.description.trim() } : {}),
    };
    createRoom.mutate({ data }, {
      onSuccess: (room) => {
        const creator = room.participants.find((person) => person.role === 'creator');
        if (!creator || !saveRoomMembership(room.id, { participantId: creator.id, browserIdentity })) {
          setPendingRoom({ id: room.id, participantId: creator?.id, browserIdentity });
          setIdentityError(creator
            ? 'Your room was created, but this browser could not save your membership. Enable browser storage, then retry below.'
            : 'Your room was created, but we could not identify its creator. You can still open its link and join as a participant.');
          return;
        }
        setLocation(`/room/${room.id}`);
      },
    });
  }

  return (
    <main className="milo-workspace" data-testid="page-create-room">
      <header className="workspace-topbar">
        <Link href="/" className="workspace-brand" aria-label="Milo home" data-testid="link-create-milo-home">
          <span className="workspace-brand-mark" aria-hidden="true">m</span>Milo
        </Link>
        <Link href="/" className="workspace-back" data-testid="link-create-back-home"><ArrowLeft size={15} aria-hidden="true" /> Back to Milo</Link>
      </header>
      <div className="workspace-create">
        <section className="workspace-create-intro" aria-labelledby="create-heading">
          <div>
            <div className="workspace-kicker">A place to begin</div>
            <h1 id="create-heading">Make room for <em>everyone.</em></h1>
            <p>Every good plan starts somewhere. Give your group a space of its own, then share it with the people you want around the table.</p>
          </div>
          <div className="workspace-intro-foot workspace-footnote"><span aria-hidden="true" /> A better way to get together</div>
        </section>
        <section className="workspace-form-wrap" aria-labelledby="form-heading">
          <div className="workspace-index">01 / THE FIRST STEP</div>
          <h2 id="form-heading">Start your room.</h2>
          <p className="workspace-form-lede">Just the essentials for now. You can share the room link once it’s ready.</p>
          <Form {...form}>
            <form className="workspace-form" onSubmit={form.handleSubmit(onSubmit)} noValidate data-testid="form-create-room">
              <FormField control={form.control} name="name" rules={{
                validate: (value) => value.trim().length > 0 && value.trim().length <= 80 || (value.trim().length === 0 ? 'Give your room a name.' : 'Use 80 characters or fewer.'),
              }} render={({ field }) => (
                <FormItem>
                  <FormLabel className="workspace-field-label">Room name <span aria-hidden="true">*</span></FormLabel>
                  <FormControl><input {...field} className="workspace-input" placeholder="e.g. Friday, finally" maxLength={80} autoComplete="off" required data-testid="input-room-name" /></FormControl>
                  <FormDescription className="workspace-field-hint">Something your friends will recognize.</FormDescription>
                  <FormMessage className="workspace-error-text" data-testid="error-room-name" />
                </FormItem>
              )} />
              <FormField control={form.control} name="description" rules={{
                validate: (value) => value.trim().length <= 240 || 'Use 240 characters or fewer.',
              }} render={({ field }) => (
                <FormItem>
                  <FormLabel className="workspace-field-label">A little context <span className="workspace-field-hint">(optional)</span></FormLabel>
                  <FormControl><textarea {...field} className="workspace-input workspace-textarea" placeholder="What are you getting together for?" maxLength={240} data-testid="input-room-description" /></FormControl>
                  <FormDescription className="workspace-field-hint">An occasion, an idea, or just a reason to meet.</FormDescription>
                  <FormMessage className="workspace-error-text" data-testid="error-room-description" />
                </FormItem>
              )} />
              <FormField control={form.control} name="creatorName" rules={{
                validate: (value) => value.trim().length > 0 && value.trim().length <= 40 || (value.trim().length === 0 ? 'Tell us your name.' : 'Use 40 characters or fewer.'),
              }} render={({ field }) => (
                <FormItem>
                  <FormLabel className="workspace-field-label">Your name <span aria-hidden="true">*</span></FormLabel>
                  <FormControl><input {...field} className="workspace-input" placeholder="What should we call you?" maxLength={40} autoComplete="name" required data-testid="input-creator-name" /></FormControl>
                  <FormDescription className="workspace-field-hint">You’ll appear as the room’s creator.</FormDescription>
                  <FormMessage className="workspace-error-text" data-testid="error-creator-name" />
                </FormItem>
              )} />
              {(createRoom.isError || identityError) && <p className="workspace-error-text" role="alert" data-testid="error-create-room">{identityError ?? 'We couldn’t create your room. Please try again.'}</p>}
              {pendingRoom && (
                <div className="workspace-create-recovery" data-testid="status-created-room-recovery">
                  {pendingRoom.participantId && (
                    <button className="workspace-back" type="button" onClick={() => {
                      if (saveRoomMembership(pendingRoom.id, { participantId: pendingRoom.participantId, browserIdentity: pendingRoom.browserIdentity })) {
                        setLocation(`/room/${pendingRoom.id}`);
                      } else {
                        setIdentityError('Browser storage is still unavailable. Your room was created, but your membership is not saved yet.');
                      }
                    }} data-testid="button-retry-creator-membership">Try saving membership again</button>
                  )}
                  <Link href={`/room/${pendingRoom.id}`} data-testid="link-created-room-recovery">Open the room link instead</Link>
                  <span className="workspace-field-hint">Opening without saved membership will ask you to join as a new participant.</span>
                </div>
              )}
              <button className="workspace-submit" type="submit" disabled={createRoom.isPending || !!pendingRoom} data-testid="button-submit-create-room">
                {createRoom.isPending ? 'Creating your room…' : 'Create room'} {!createRoom.isPending && <ArrowRight size={16} aria-hidden="true" />}
              </button>
            </form>
          </Form>
          <p className="workspace-form-small">Your room begins with just you. Share its link when you’re ready.</p>
        </section>
      </div>
    </main>
  );
}

export default CreateRoom;