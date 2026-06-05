class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const inputChannels = inputs[0];

    if (!inputChannels || inputChannels.length === 0) {
      return true;
    }

    const frameLength = inputChannels[0]?.length ?? 0;
    if (frameLength === 0) {
      return true;
    }

    const monoFrame = new Float32Array(frameLength);

    for (let channelIndex = 0; channelIndex < inputChannels.length; channelIndex += 1) {
      const channel = inputChannels[channelIndex];
      for (let sampleIndex = 0; sampleIndex < frameLength; sampleIndex += 1) {
        monoFrame[sampleIndex] += channel[sampleIndex] ?? 0;
      }
    }

    const channelCount = inputChannels.length || 1;
    for (let sampleIndex = 0; sampleIndex < monoFrame.length; sampleIndex += 1) {
      monoFrame[sampleIndex] /= channelCount;
    }

    this.port.postMessage(
      {
        type: "frame",
        sampleRate,
        samples: monoFrame,
      },
      [monoFrame.buffer],
    );

    return true;
  }
}

registerProcessor("lingoflow-pcm-capture", PcmCaptureProcessor);
