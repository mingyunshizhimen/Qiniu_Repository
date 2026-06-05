declare const sampleRate: number;

interface AudioWorkletProcessor {
  readonly port: MessagePort;
}

declare const AudioWorkletProcessor: {
  new (options?: AudioWorkletNodeOptions): AudioWorkletProcessor;
};

declare function registerProcessor(
  name: string,
  processorConstructor: new (
    options?: AudioWorkletNodeOptions,
  ) => AudioWorkletProcessor,
): void;
