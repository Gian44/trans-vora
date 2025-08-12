// src/utils/whisper.worker.js
import { pipeline, env } from '@xenova/transformers';
import { MessageTypes } from './presets';

// Remote-only: load from the Hub; never look locally
env.allowRemoteModels = true;
env.allowLocalModels = false;
env.localModelPath = '';
env.useBrowserCache = true;
env.useFS = true;

// Singleton pipeline (same as before)
class MyTranscriptionPipeline {
  static task = 'automatic-speech-recognition';
  static model = 'Xenova/whisper-tiny.en';
  static instance = null;

  static async getInstance(progress_callback = null) {
    if (this.instance === null) {
      this.instance = await pipeline(this.task, this.model, { progress_callback });
    }
    return this.instance;
  }
}

self.addEventListener('message', async (event) => {
  const { type, audio } = event.data;
  if (type === MessageTypes.INFERENCE_REQUEST) {
    await transcribe(audio);
  }
});

async function transcribe(audio) {
  sendLoadingMessage('loading');

  let asr;
  try {
    asr = await MyTranscriptionPipeline.getInstance(load_model_callback);
  } catch (err) {
    console.error(err);
    sendLoadingMessage('error');
    return;
  }

  sendLoadingMessage('success');

  // Modern ASR options: use *_s (seconds) keys and let the pipeline do timestamps.
  const chunk_length_s = 30;
  const stride_length_s = 5;

  // Run transcription (no private _decode_asr, no manual time math)
  const output = await asr(audio, {
    top_k: 0,
    do_sample: false,
    return_timestamps: true,     // returns { text, chunks: [...] }
    chunk_length_s,
    stride_length_s
    // If you later want live partials, wire a WhisperTextStreamer here.
  });

  // Normalize to your app’s expected shape
  const results = (output.chunks || []).map((c, i) => {
    const [start = 0, end] = c.timestamp || [0, undefined];
    return {
      index: i,
      text: (c.text || '').trim(),
      start: Math.round(start),
      end: Math.round(end ?? (start + 0.9 * stride_length_s))
    };
  });

  // Send once (your UI renders from RESULT, then waits for INFERENCE_DONE)
  createResultMessage(results, true, results.at(-1)?.end ?? 0);
  self.postMessage({ type: MessageTypes.INFERENCE_DONE });
}

function load_model_callback(data) {
  if (data?.status === 'progress') {
    const { file, progress, loaded, total } = data;
    self.postMessage({ type: MessageTypes.DOWNLOADING, file, progress, loaded, total });
  }
}

function sendLoadingMessage(status) {
  self.postMessage({ type: MessageTypes.LOADING, status });
}

function createResultMessage(results, isDone, completedUntilTimestamp) {
  self.postMessage({
    type: MessageTypes.RESULT,
    results,
    isDone,
    completedUntilTimestamp
  });
}
