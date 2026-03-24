import { useRef, useCallback } from 'react';
import { getSocket } from '../../../services/socket';

// ─── ICE CONFIG ───────────────────────────────────────────────
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
    { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
    // TURN (Metered free tier) — replace with your own credentials
    ...(import.meta.env.VITE_TURN_URL
      ? [{
          urls: import.meta.env.VITE_TURN_URL,
          username: import.meta.env.VITE_TURN_USER || '',
          credential: import.meta.env.VITE_TURN_PASS || '',
        }]
      : []),
  ],
  iceCandidatePoolSize: 5,
  bundlePolicy: 'max-bundle' as RTCBundlePolicy,
  rtcpMuxPolicy: 'require' as RTCRtcpMuxPolicy,
};

const ICE_RESTART_MAX = 3;
const CONNECTION_TIMEOUT_MS = 30_000;
const ICE_FAILED_WAIT_MS = 10_000;

const log = (msg: string, ...a: any[]) => console.log(`[xaxamax:webrtc] ${msg}`, ...a);
const logErr = (msg: string, ...a: any[]) => console.error(`[xaxamax:webrtc] ${msg}`, ...a);

// ─── PEER STATE ───────────────────────────────────────────────
export interface PeerState {
  pc: RTCPeerConnection;
  peerId: string;
  isCaller: boolean;
  iceCandidateQueue: RTCIceCandidateInit[];
  makingOffer: boolean;
  isNegotiating: boolean;
  queuedNegotiation: boolean;
  firstNegotiation: boolean;
  iceRestartCount: number;
  connTimeout: ReturnType<typeof setTimeout> | null;
  iceFailedTimeout: ReturnType<typeof setTimeout> | null;
  remoteStream: MediaStream | null;
}

export interface UseWebRTCCallbacks {
  onRemoteStream: (peerId: string, stream: MediaStream) => void;
  onPeerConnected: (peerId: string) => void;
  onPeerDisconnected: (peerId: string) => void;
  onPeerFailed: (peerId: string) => void;
  getCallId: () => string | null;
}

// Helper: check if a peer's PC is still open
const pcRef = (peer: PeerState): boolean => {
  try {
    // Accessing connectionState on a closed PC throws in some browsers
    return peer.pc.connectionState !== 'closed';
  } catch {
    return false;
  }
};

export function useWebRTC(callbacks: UseWebRTCCallbacks) {
  const peersRef = useRef<Map<string, PeerState>>(new Map());
  const endedRef = useRef(false);

  // ─── CREATE PEER CONNECTION ─────────────────────────────────
  const createPeer = useCallback((
    peerId: string,
    isCaller: boolean,
    localStream: MediaStream | null,
  ): PeerState => {
    // Close existing peer if any
    const existing = peersRef.current.get(peerId);
    if (existing) {
      closePeerInternal(existing);
    }

    const pc = new RTCPeerConnection(RTC_CONFIG);
    const socket = getSocket();

    const peer: PeerState = {
      pc,
      peerId,
      isCaller,
      iceCandidateQueue: [],
      makingOffer: false,
      isNegotiating: false,
      queuedNegotiation: false,
      firstNegotiation: true,
      iceRestartCount: 0,
      connTimeout: null,
      iceFailedTimeout: null,
      remoteStream: null,
    };

    // ── ICE CANDIDATE ──
    pc.onicecandidate = (e) => {
      if (!e.candidate?.candidate) return;
      socket?.emit('webrtc:ice-candidate', {
        callId: callbacks.getCallId(),
        targetUserId: peerId,
        candidate: e.candidate.toJSON(),
      });
    };

    (pc as any).onicecandidateerror = (e: any) => {
      log('ICE candidate error:', e?.url, e?.errorText);
    };

    // ── TRACK HANDLER ──
    pc.ontrack = (e) => {
      if (endedRef.current) return;
      const stream = e.streams[0];
      if (!stream) return;
      log(`ontrack from ${peerId}:`, e.track.kind, 'label:', e.track.label);
      peer.remoteStream = stream;
      callbacks.onRemoteStream(peerId, stream);
    };

    // ── NEGOTIATION NEEDED ── (batched, simple-peer pattern)
    pc.onnegotiationneeded = () => {
      if (endedRef.current) return;

      // Callee: skip first negotiation (caller sends first offer)
      if (!isCaller && peer.firstNegotiation) {
        peer.firstNegotiation = false;
        log(`onnegotiationneeded — ${peerId} callee skipping first`);
        return;
      }
      peer.firstNegotiation = false;

      if (peer.isNegotiating) {
        peer.queuedNegotiation = true;
        return;
      }

      peer.isNegotiating = true;
      peer.makingOffer = true;

      // setTimeout(0) batches multiple addTrack into one offer
      setTimeout(async () => {
        try {
          if (endedRef.current || !pcRef(peer)) return;
          const offer = await pc.createOffer();
          if (endedRef.current || !pcRef(peer)) return;
          if (pc.signalingState !== 'stable') {
            peer.queuedNegotiation = true;
            return;
          }
          await pc.setLocalDescription(offer);
          log(`Sending offer to ${peerId}`);
          socket?.emit('webrtc:offer', {
            callId: callbacks.getCallId(),
            targetUserId: peerId,
            offer: pc.localDescription,
          });
        } catch (err) {
          logErr('onnegotiationneeded error:', err);
        } finally {
          peer.makingOffer = false;
        }
      }, 0);
    };

    // ── CONNECTION STATE ──
    const markConnected = () => {
      peer.iceRestartCount = 0;
      if (peer.connTimeout) { clearTimeout(peer.connTimeout); peer.connTimeout = null; }
      if (peer.iceFailedTimeout) { clearTimeout(peer.iceFailedTimeout); peer.iceFailedTimeout = null; }
      callbacks.onPeerConnected(peerId);
    };

    pc.onconnectionstatechange = () => {
      if (endedRef.current) return;
      log(`connectionState[${peerId}]:`, pc.connectionState);
      if (pc.connectionState === 'connected') markConnected();
      if (pc.connectionState === 'failed') {
        if (isCaller && peer.iceRestartCount < ICE_RESTART_MAX) {
          peer.iceRestartCount++;
          pc.restartIce();
        }
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (endedRef.current) return;
      log(`iceConnectionState[${peerId}]:`, pc.iceConnectionState);

      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        markConnected();
      }
      if (pc.iceConnectionState === 'closed') {
        callbacks.onPeerDisconnected(peerId);
      }
      if (pc.iceConnectionState === 'failed') {
        if (isCaller) {
          if (peer.iceRestartCount < ICE_RESTART_MAX) {
            peer.iceRestartCount++;
            log(`ICE failed → restart ${peer.iceRestartCount}/${ICE_RESTART_MAX} for ${peerId}`);
            pc.restartIce();
          } else {
            callbacks.onPeerFailed(peerId);
          }
        } else {
          // Callee waits for caller restart
          if (!peer.iceFailedTimeout) {
            peer.iceFailedTimeout = setTimeout(() => {
              if (pc.iceConnectionState === 'failed') {
                callbacks.onPeerFailed(peerId);
              }
            }, ICE_FAILED_WAIT_MS);
          }
        }
      }
    };

    // ── SIGNALING STATE ── flush queued negotiations
    pc.onsignalingstatechange = () => {
      if (endedRef.current) return;
      log(`signalingState[${peerId}]:`, pc.signalingState);
      if (pc.signalingState === 'stable') {
        peer.isNegotiating = false;
        if (peer.queuedNegotiation) {
          peer.queuedNegotiation = false;
          pc.onnegotiationneeded?.(new Event('negotiationneeded'));
        }
      }
    };

    // ── ADD LOCAL TRACKS ──
    if (localStream) {
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    }

    // ── CONNECTION TIMEOUT (caller only) ──
    if (isCaller) {
      peer.connTimeout = setTimeout(() => {
        const p = peersRef.current.get(peerId);
        if (p && pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed') {
          log(`Connection timeout for ${peerId}`);
          callbacks.onPeerFailed(peerId);
        }
      }, CONNECTION_TIMEOUT_MS);

      // Fallback: if onnegotiationneeded didn't fire, create offer manually
      setTimeout(async () => {
        if (endedRef.current || !pcRef(peer)) return;
        if (pc.signalingState === 'stable' && !pc.localDescription) {
          log(`Fallback offer to ${peerId}`);
          try {
            const offer = await pc.createOffer();
            if (endedRef.current || !pcRef(peer)) return;
            await pc.setLocalDescription(offer);
            socket?.emit('webrtc:offer', {
              callId: callbacks.getCallId(),
              targetUserId: peerId,
              offer: pc.localDescription,
            });
          } catch (err) {
            logErr('Fallback offer error:', err);
          }
        }
      }, 1000);
    }

    peersRef.current.set(peerId, peer);
    return peer;
  }, [callbacks]);

  // ─── HANDLE INCOMING OFFER (perfect negotiation) ────────────
  const handleOffer = useCallback(async (
    peerId: string,
    offer: RTCSessionDescriptionInit,
  ) => {
    const peer = peersRef.current.get(peerId);
    if (!peer || endedRef.current) return;
    const { pc } = peer;
    const socket = getSocket();

    try {
      log(`Received offer from ${peerId}, signalingState:`, pc.signalingState);

      // Perfect negotiation: handle glare
      const offerCollision = peer.makingOffer || pc.signalingState !== 'stable';
      const isPolite = !peer.isCaller; // callee is polite

      if (offerCollision && !isPolite) {
        log('Ignoring offer — collision, impolite');
        return;
      }
      if (offerCollision && isPolite) {
        log('Offer collision — polite rollback');
        await pc.setLocalDescription({ type: 'rollback' } as any);
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      if (endedRef.current) return;

      const answer = await pc.createAnswer();
      if (endedRef.current) return;
      await pc.setLocalDescription(answer);

      log(`Sending answer to ${peerId}`);
      socket?.emit('webrtc:answer', {
        callId: callbacks.getCallId(),
        targetUserId: peerId,
        answer: pc.localDescription,
      });

      // Flush queued ICE candidates
      await flushIceCandidates(peer);
    } catch (err) {
      logErr(`handleOffer error for ${peerId}:`, err);
    }
  }, [callbacks]);

  // ─── HANDLE INCOMING ANSWER ─────────────────────────────────
  const handleAnswer = useCallback(async (
    peerId: string,
    answer: RTCSessionDescriptionInit,
  ) => {
    const peer = peersRef.current.get(peerId);
    if (!peer || endedRef.current) return;
    const { pc } = peer;

    try {
      if (pc.signalingState !== 'have-local-offer') {
        log(`Ignoring answer from ${peerId}, state:`, pc.signalingState);
        return;
      }
      log(`Received answer from ${peerId}`);
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      if (endedRef.current) return;
      await flushIceCandidates(peer);
      peer.isNegotiating = false;
    } catch (err) {
      logErr(`handleAnswer error for ${peerId}:`, err);
    }
  }, []);

  // ─── HANDLE ICE CANDIDATE ──────────────────────────────────
  const handleIceCandidate = useCallback(async (
    peerId: string,
    candidate: RTCIceCandidateInit,
  ) => {
    if (!candidate?.candidate) return;
    const peer = peersRef.current.get(peerId);
    if (!peer) return;

    if (!peer.pc.remoteDescription) {
      peer.iceCandidateQueue.push(candidate);
      return;
    }
    try {
      await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      logErr(`addIceCandidate error for ${peerId}:`, err);
    }
  }, []);

  // ─── FLUSH ICE QUEUE ───────────────────────────────────────
  const flushIceCandidates = async (peer: PeerState) => {
    if (!peer.pc.remoteDescription) return;
    const queued = [...peer.iceCandidateQueue];
    peer.iceCandidateQueue = [];
    for (const c of queued) {
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {
        logErr('flush ICE error:', err);
      }
    }
  };

  // ─── REPLACE TRACK ON ALL PEERS ────────────────────────────
  const replaceTrackOnAll = useCallback(async (
    oldTrack: MediaStreamTrack | null,
    newTrack: MediaStreamTrack,
  ) => {
    for (const [, peer] of peersRef.current) {
      const sender = peer.pc.getSenders().find((s) =>
        s.track?.kind === newTrack.kind && (oldTrack ? s.track?.id === oldTrack.id : true)
      );
      if (sender) {
        try {
          await sender.replaceTrack(newTrack);
        } catch (err) {
          logErr(`replaceTrack error for ${peer.peerId}:`, err);
        }
      }
    }
  }, []);

  // ─── ADD TRACK TO ALL PEERS ────────────────────────────────
  const addTrackToAll = useCallback((track: MediaStreamTrack, stream: MediaStream) => {
    for (const [, peer] of peersRef.current) {
      try {
        peer.pc.addTrack(track, stream);
      } catch (err) {
        logErr(`addTrack error for ${peer.peerId}:`, err);
      }
    }
  }, []);

  // ─── CLOSE SINGLE PEER ────────────────────────────────────
  const closePeerInternal = (peer: PeerState) => {
    if (peer.connTimeout) clearTimeout(peer.connTimeout);
    if (peer.iceFailedTimeout) clearTimeout(peer.iceFailedTimeout);
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.oniceconnectionstatechange = null;
    peer.pc.onnegotiationneeded = null;
    peer.pc.onsignalingstatechange = null;
    (peer.pc as any).onicecandidateerror = null;
    try { peer.pc.close(); } catch (_) {}
  };

  const closePeer = useCallback((peerId: string) => {
    const peer = peersRef.current.get(peerId);
    if (peer) {
      closePeerInternal(peer);
      peersRef.current.delete(peerId);
    }
  }, []);

  // ─── CLOSE ALL PEERS ──────────────────────────────────────
  const closeAll = useCallback(() => {
    endedRef.current = true;
    for (const [, peer] of peersRef.current) {
      closePeerInternal(peer);
    }
    peersRef.current.clear();
  }, []);

  // ─── RESET ENDED FLAG ─────────────────────────────────────
  const resetEnded = useCallback(() => {
    endedRef.current = false;
  }, []);

  // ─── GET PEER ─────────────────────────────────────────────
  const getPeer = useCallback((peerId: string) => {
    return peersRef.current.get(peerId) || null;
  }, []);

  const getAllPeers = useCallback(() => {
    return peersRef.current;
  }, []);

  return {
    createPeer,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    replaceTrackOnAll,
    addTrackToAll,
    closePeer,
    closeAll,
    resetEnded,
    getPeer,
    getAllPeers,
  };
}
