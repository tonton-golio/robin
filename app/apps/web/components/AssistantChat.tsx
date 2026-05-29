'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui';

// Client-safe owner label. NEXT_PUBLIC_* is inlined at build time; do NOT import
// the server-only lib/config here.
const OWNER_LABEL = process.env.NEXT_PUBLIC_ROBIN_OWNER || 'You';

type Role = 'user' | 'assistant';

interface Turn {
  id: string;
  role: Role;
  text: string;
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'ok'; url: string }
  | { kind: 'err'; message: string };

function appendText(turns: Turn[], text: string): Turn[] {
  const last = turns[turns.length - 1];
  if (last?.role === 'assistant') {
    return [...turns.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...turns, { id: crypto.randomUUID(), role: 'assistant', text }];
}

export function AssistantChat() {
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [resetNext, setResetNext] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Stop the mic + recorder if the user navigates away mid-recording (/chat
  // unmounts on navigation). Stop tracks directly rather than via .stop(),
  // whose async onstop handler would setState after unmount.
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        if (recorder.state !== 'inactive') recorder.stop();
        recorder.stream?.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
      }
    };
  }, []);

  const canSend = input.trim().length > 0 && !isStreaming;
  const canSave = turns.length > 0 && saveState.kind !== 'saving';

  const title = useMemo(() => {
    const firstUser = turns.find((turn) => turn.role === 'user')?.text.trim();
    return firstUser ? firstUser.slice(0, 72) : 'Assistant Session';
  }, [turns]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput('');
    setError(null);
    setSaveState({ kind: 'idle' });
    setStatus('Thinking');
    setIsStreaming(true);

    setTurns((current) => [
      ...current,
      { id: crypto.randomUUID(), role: 'user', text },
      { id: crypto.randomUUID(), role: 'assistant', text: '' },
    ]);

    try {
      const response = await fetch('/api/assistant/message', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, reset: resetNext }),
      });

      setResetNext(false);

      if (!response.ok || !response.body) {
        const body = await response.text();
        throw new Error(body || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          const line = chunk.split('\n').find((part) => part.startsWith('data: '));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as {
            type?: string;
            text?: string;
            message?: string;
            name?: string;
          };

          if (event.type === 'thinking') {
            setStatus('Thinking');
          } else if (event.type === 'tool_use') {
            setStatus(event.name ? `Using ${event.name}` : 'Using tool');
          } else if (event.type === 'tool_result') {
            setStatus('Reading tool result');
          } else if (event.type === 'text' && event.text) {
            setStatus('Writing');
            setTurns((current) => appendText(current, event.text ?? ''));
          } else if (event.type === 'error') {
            throw new Error(event.message ?? 'Assistant failed');
          } else if (event.type === 'done') {
            setStatus('Ready');
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStatus('Error');
      setTurns((current) => appendText(current, `\n\n${message}`));
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, resetNext]);

  const handleSave = useCallback(async () => {
    setSaveState({ kind: 'saving' });
    try {
      const response = await fetch('/api/assistant/transcript', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ turns, title }),
      });
      const body = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || body.error) {
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      setSaveState({ kind: 'ok', url: body.url ?? '/' });
    } catch (err) {
      setSaveState({ kind: 'err', message: err instanceof Error ? err.message : String(err) });
    }
  }, [turns, title]);

  const handleVoice = useCallback(async () => {
    if (isRecording) {
      recorderRef.current?.stop();
      return;
    }

    setError(null);
    setStatus('Listening');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('Error');
      return;
    }
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = async () => {
      setIsRecording(false);
      stream.getTracks().forEach((track) => track.stop());
      setStatus('Transcribing');

      try {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const form = new FormData();
        form.append('audio', blob, 'assistant-prompt.webm');
        const upload = await fetch('/api/meeting/upload', { method: 'POST', body: form });
        const uploadBody = (await upload.json()) as { audioPath?: string; error?: string };
        if (!upload.ok || !uploadBody.audioPath) {
          throw new Error(uploadBody.error ?? `Upload failed: HTTP ${upload.status}`);
        }

        const transcribe = await fetch('/api/meeting/transcribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ audioPath: uploadBody.audioPath }),
        });
        const transcribeBody = (await transcribe.json()) as {
          transcript?: string;
          error?: string;
          detail?: string;
        };
        if (!transcribe.ok || !transcribeBody.transcript) {
          throw new Error(transcribeBody.detail ?? transcribeBody.error ?? `Transcribe failed: HTTP ${transcribe.status}`);
        }

        setInput(transcribeBody.transcript);
        setStatus('Ready');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus('Error');
      }
    };

    recorder.start();
    setIsRecording(true);
  }, [isRecording]);

  return (
    <div className="flex flex-col" style={{ background: 'var(--bg-0)', height: 'calc(100vh - 48px)' }}>
      <div className="flex flex-shrink-0 items-center gap-3 px-6 py-3" style={{ borderBottom: '1px solid var(--border-0)' }}>
        <span className="text-xs uppercase tracking-[0.08em]" style={{ color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>Chat</span>
        <span className="text-xs" style={{ color: 'var(--text-1)' }}>{status}</span>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground select-none">
          <input
            type="checkbox"
            suppressHydrationWarning
            checked={resetNext}
            disabled={isStreaming}
            onChange={(event) => setResetNext(event.target.checked)}
          />
          New session
        </label>
        <Button variant="outline" size="xs" onClick={handleSave} disabled={!canSave}>
          Save
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {turns.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Ask Robin for a briefing, search, decision check, or next action.
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {turns.map((turn) => (
              <div
                key={turn.id}
                className={turn.role === 'user' ? 'self-end max-w-[80%]' : 'self-start max-w-[88%]'}
              >
                <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                  {turn.role === 'user' ? OWNER_LABEL : 'Assistant'}
                </div>
                <div
                  className="whitespace-pre-wrap px-4 py-3 text-sm"
                  style={
                    turn.role === 'user'
                      ? { borderRadius: '14px 14px 4px 14px', background: 'var(--bg-2)', color: 'var(--text-0)' }
                      : { borderLeft: '2px solid var(--robin-amber)', paddingLeft: 18, color: 'var(--text-0)', lineHeight: 1.6 }
                  }
                >
                  {turn.text || (isStreaming ? '...' : '')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 px-5 py-4" style={{ borderTop: '1px solid var(--border-0)', background: 'var(--bg-1)' }}>
        {error && <p className="mb-2 text-xs text-[var(--warning-rust)]">{error}</p>}
        {saveState.kind === 'ok' && (
          <a className="mb-2 block text-xs text-[var(--signal-cyan)] hover:underline" href={saveState.url}>
            Saved transcript
          </a>
        )}
        {saveState.kind === 'err' && (
          <p className="mb-2 text-xs text-[var(--warning-rust)]">{saveState.message}</p>
        )}
        <div className="mx-auto flex max-w-3xl gap-2">
          <Button
            variant={isRecording ? 'destructive' : 'outline'}
            onClick={() => void handleVoice()}
            disabled={isStreaming}
            className="w-24"
          >
            {isRecording ? 'Stop' : 'Voice'}
          </Button>
          <textarea
            value={input}
            suppressHydrationWarning
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Ask Robin..."
            rows={2}
            className="min-h-11 flex-1 resize-none rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <Button onClick={handleSend} disabled={!canSend} className="w-24">
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
