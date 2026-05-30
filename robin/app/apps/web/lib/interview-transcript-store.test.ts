import { describe, expect, it } from 'vitest';
import { InterviewTranscriptStore } from './interview-transcript-store';

// These tests exercise only the in-memory frame ingestion (turnCount), never
// touching disk — flush()/close() are not called.

function frame(obj: Record<string, unknown>): string {
  return JSON.stringify(obj);
}

describe('InterviewTranscriptStore barge-in buffer handling', () => {
  it('flushes the in-flight assistant buffer when a response is cancelled without a transcript .done', () => {
    const store = new InterviewTranscriptStore('test-brief');
    // Assistant starts speaking; deltas accumulate but no .done arrives.
    store.ingestFrame(frame({ type: 'response.audio_transcript.delta', delta: 'The first ' }), 'upstream');
    store.ingestFrame(frame({ type: 'response.audio_transcript.delta', delta: 'half.' }), 'upstream');
    expect(store.turnCount).toBe(0);
    // Barge-in: the response is cancelled before any content part finalizes.
    store.ingestFrame(frame({ type: 'response.cancelled' }), 'upstream');
    expect(store.turnCount).toBe(1);

    // The NEXT assistant turn must NOT concatenate onto the cancelled partial.
    store.ingestFrame(frame({ type: 'response.audio_transcript.delta', delta: 'A fresh question?' }), 'upstream');
    store.ingestFrame(
      frame({ type: 'response.audio_transcript.done', transcript: 'A fresh question?' }),
      'upstream',
    );
    expect(store.turnCount).toBe(2);
  });

  it('does not double-count when a transcript .done already cleared the buffer before response.done', () => {
    const store = new InterviewTranscriptStore('test-brief');
    store.ingestFrame(frame({ type: 'response.audio_transcript.delta', delta: 'Complete turn.' }), 'upstream');
    store.ingestFrame(
      frame({ type: 'response.audio_transcript.done', transcript: 'Complete turn.' }),
      'upstream',
    );
    expect(store.turnCount).toBe(1);
    // Aggregate response.done arrives after .done already flushed → no extra turn.
    store.ingestFrame(frame({ type: 'response.done' }), 'upstream');
    expect(store.turnCount).toBe(1);
  });
});
