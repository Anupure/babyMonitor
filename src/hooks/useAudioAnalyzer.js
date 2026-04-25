import { useState, useEffect, useRef } from 'react';

export function useAudioAnalyzer(stream, mode, cryThreshold, onCryStateChange) {
  const [isCrying, setIsCrying] = useState(false);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const audioLoopRef = useRef(null);
  const cryDurationRef = useRef(0);
  const silenceDurationRef = useRef(0);

  useEffect(() => {
    if (mode !== 'camera' || !stream) return;

    // Setup audio context
    const setupAudio = async () => {
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);

        audioContextRef.current = audioCtx;
        analyserRef.current = analyser;
        sourceRef.current = source;

        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }
      } catch (err) {
        console.error('AudioContext setup failed', err);
      }
    };

    setupAudio();

    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      analyserRef.current = null;
      sourceRef.current = null;
    };
  }, [stream, mode]);

  useEffect(() => {
    if (mode !== 'camera' || !analyserRef.current) return;

    if (audioLoopRef.current) clearInterval(audioLoopRef.current);

    const dataArray = new Uint8Array(analyserRef.current.fftSize);
    let lastTime = Date.now();

    const checkAudio = () => {
      if (!analyserRef.current) return;

      const time = Date.now();
      const dt = time - lastTime;
      lastTime = time;

      analyserRef.current.getByteTimeDomainData(dataArray);
      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const normalized = (dataArray[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / dataArray.length);

      const volume = Math.min(100, rms * 300);

      if (volume >= cryThreshold) {
        cryDurationRef.current += dt;
        silenceDurationRef.current = 0;
        if (cryDurationRef.current > 1500) {
          setIsCrying(prev => {
            if (!prev && onCryStateChange) onCryStateChange(true);
            return true;
          });
        }
      } else {
        silenceDurationRef.current += dt;
        if (silenceDurationRef.current > 2000) {
          cryDurationRef.current = 0;
          setIsCrying(prev => {
            if (prev && onCryStateChange) onCryStateChange(false);
            return false;
          });
        }
      }
    };

    audioLoopRef.current = setInterval(checkAudio, 100);

    return () => {
      if (audioLoopRef.current) clearInterval(audioLoopRef.current);
    };
  }, [mode, cryThreshold, onCryStateChange]);

  const cleanupAudio = () => {
    if (audioLoopRef.current) clearInterval(audioLoopRef.current);
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    sourceRef.current = null;
    cryDurationRef.current = 0;
    silenceDurationRef.current = 0;
    setIsCrying(false);
  };

  return { isCrying, cleanupAudio };
}
